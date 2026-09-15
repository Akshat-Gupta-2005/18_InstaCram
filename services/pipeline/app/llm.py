"""Calls the LiteLLM gateway - the only component that knows which model runs.

Nothing here names a provider. Swapping to a hosted model is an edit to
services/llm-gateway/config.yaml and nothing else, which is the entire reason the
gateway exists.

Two hard-won behaviours are carried over from the serving client rather than
rediscovered:

  P23 - an EMPTY reply is what a reasoning model returns when its thinking has
        consumed the whole token budget. It must raise, not return "", or the
        failure surfaces later as an unexplained parse error.

  P24 - asking for JSON in the prompt is a request, not a guarantee. A first
        calibration run lost 2 of 8 fields to "Bad control character in string
        literal" and "Expected ':' after property name". Decoding is constrained
        with response_format, AND parsing is forgiving about the wrapper.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.config import LLM_GATEWAY_URL

# Local inference is slow and the first call after a model loads is slower still;
# a cold qwen3:8b took ~160s in earlier measurements.
DEFAULT_TIMEOUT = 600.0


class LLMError(RuntimeError):
    """The gateway failed, or returned something unusable."""


async def complete(
    client: httpx.AsyncClient,
    prompt: str,
    *,
    max_tokens: int = 1200,
    model: str = "default",
    as_json: bool = False,
    timeout: float = DEFAULT_TIMEOUT,
) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }
    if as_json:
        payload["response_format"] = {"type": "json_object"}

    try:
        resp = await client.post(
            f"{LLM_GATEWAY_URL}/v1/chat/completions", json=payload, timeout=timeout
        )
    except httpx.HTTPError as exc:
        raise LLMError(f"llm gateway unreachable: {exc}") from exc

    if resp.status_code != 200:
        raise LLMError(f"llm gateway {resp.status_code}: {resp.text[:300]}")

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as exc:
        raise LLMError(f"llm gateway returned an unexpected body: {resp.text[:200]}") from exc

    if not isinstance(content, str) or not content.strip():
        raise LLMError("llm gateway returned no content (see P23: thinking ate the budget)")
    return content


def _escape_control_chars_in_strings(text: str) -> str:
    """Escapes raw control characters that appear INSIDE string literals.

    A literal newline inside a JSON string is invalid, and it is the single most
    common way a model's otherwise-fine JSON fails to parse. Text outside strings
    is untouched, so newlines used to format the document still work.
    """
    out: list[str] = []
    in_string = False
    escaped = False

    for ch in text:
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\" and in_string:
            out.append(ch)
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            out.append(ch)
            continue
        if in_string and ch < " ":
            out.append({"\n": "\\n", "\r": "\\r", "\t": "\\t"}.get(ch, ""))
            continue
        out.append(ch)

    return "".join(out)


def extract_json(raw: str) -> Any:
    """Forgiving about the wrapper, strict about the content.

    Models wrap JSON in prose or code fences however firmly the prompt asks them
    not to, so each repair is tried in turn and the first that parses wins.
    """
    fence_start = raw.find("```")
    candidate = raw
    if fence_start != -1:
        rest = raw[fence_start + 3 :].removeprefix("json")
        fence_end = rest.find("```")
        candidate = rest[:fence_end] if fence_end != -1 else rest
    candidate = candidate.strip()

    attempts = [candidate, _escape_control_chars_in_strings(candidate)]

    # The outermost braces, which survives a leading sentence of prose.
    first, last = candidate.find("{"), candidate.rfind("}")
    if first != -1 and last > first:
        attempts.append(_escape_control_chars_in_strings(candidate[first : last + 1]))

    for attempt in attempts:
        if not attempt:
            continue
        try:
            return json.loads(attempt)
        except ValueError:
            continue

    raise LLMError(f"model did not return usable JSON: {candidate[:200]}")


async def complete_json(
    client: httpx.AsyncClient,
    prompt: str,
    *,
    max_tokens: int = 1200,
    model: str = "default",
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Always asks the runtime for JSON mode; the prompt alone is not enough."""
    raw = await complete(
        client, prompt, max_tokens=max_tokens, model=model, as_json=True, timeout=timeout
    )
    return extract_json(raw)
