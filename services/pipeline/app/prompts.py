"""Loads agent prompts from prompts/*.md at runtime.

Copying the prompt text into Python would be less plumbing, and would let the
document that explains an instruction drift from the text that actually runs -
silently, because nothing fails when they disagree. For an LLM agent the prompt
IS the behaviour, so it is loaded from the same file a human reads.

This mirrors services/serving/src/topics/prompts.ts deliberately. Two loaders
that parse the same files differently would be a bug waiting for whichever
service is touched second.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import PROMPTS_DIR

_PROMPT_HEADING = re.compile(r"^##\s+Prompt\s*$", re.MULTILINE)
_FENCED = re.compile(r"```(.*?)```", re.DOTALL)
_IF_BLOCK = re.compile(r"\{\{#if (\w+)\}\}(.*?)\{\{/if\}\}", re.DOTALL)

_cache: dict[str, str] = {}


def load_prompt(file: str) -> str:
    """The first fenced block after the '## Prompt' heading.

    Everything else in the document is reasoning written for humans and must not
    reach the model - those sections explain WHY an instruction is phrased as it
    is, which would read as contradictory guidance if sent along with it.
    """
    if file in _cache:
        return _cache[file]

    text = Path(PROMPTS_DIR, file).read_text(encoding="utf-8")
    parts = _PROMPT_HEADING.split(text)
    if len(parts) < 2:
        raise ValueError(f'{file}: no "## Prompt" section')

    fenced = _FENCED.search(parts[1])
    if fenced is None:
        raise ValueError(f'{file}: no fenced prompt block after "## Prompt"')

    prompt = fenced.group(1).strip()
    _cache[file] = prompt
    return prompt


def render(template: str, **vars: str) -> str:
    """{{var}} substitution plus a single {{#if x}}...{{/if}} form.

    That is all the prompt files use. A template engine would be a dependency
    larger than the feature it serves.
    """

    def keep_if(match: re.Match[str]) -> str:
        return match.group(2) if vars.get(match.group(1)) else ""

    out = _IF_BLOCK.sub(keep_if, template)
    for name, value in vars.items():
        out = out.replace("{{" + name + "}}", str(value))
    return out.strip()
