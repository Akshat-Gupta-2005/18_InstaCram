"""Pipeline settings, read once from the environment.

The ONE .env lives at the repo root. Both services load it by explicit path
because each runs with its own service folder as the working directory, so a
bare load_dotenv() would look in the wrong place and silently find nothing -
leaving every value on its default with no error to notice. See P25.

Real environment variables always win: load_dotenv does not override what is
already set, so compose-provided values inside a container are never clobbered.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# app/config.py -> app -> pipeline -> services -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = REPO_ROOT / ".env"

load_dotenv(ENV_PATH)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env(
    "DATABASE_URL", "postgres://instacram:instacram@localhost:5432/instacram"
)
EMBEDDINGS_URL = _env("EMBEDDINGS_URL", "http://localhost:8081")
LLM_GATEWAY_URL = _env("LLM_GATEWAY_URL", "http://localhost:4000")

# Prompts are loaded from disk at runtime, never copied into Python, so the
# document explaining an instruction and the text that actually runs cannot
# disagree. For an LLM agent the prompt IS the behaviour. The image sets this to
# /app/prompts; the fallback resolves the repo's prompts/ when running from source.
PROMPTS_DIR = _env("PROMPTS_DIR") or str(REPO_ROOT / "prompts")

# Wikimedia answers clients that do not identify themselves with HTTP 403 and
# "Please respect our robot policy". There is deliberately NO default: a fake or
# absent contact would look compliant while being exactly what the policy exists
# to prevent, so the scraper refuses to run rather than guess. See P26.
SCRAPER_CONTACT = _env("SCRAPER_CONTACT")

USER_AGENT = f"InstaCram/0.1 (+{SCRAPER_CONTACT})" if SCRAPER_CONTACT else ""

# Below this, an extract is too thin to ground a card. Note what this CANNOT do:
# it says nothing about whether the text is about the right topic. A wrong
# article is just as long as a right one, which is how the spike scored 10/10
# while four topics shared one page. That is the relevance check's job, not this.
MIN_USABLE_CHARS = int(_env("SCRAPER_MIN_CHARS", "500"))

# How much of each source is sent to the card generator. Wikipedia articles run
# 22k-36k chars and a local 8B model pays for every one of them in latency and
# context. Taking the FRONT is not arbitrary: a Wikipedia lead section is the
# article's own summary and a Javadoc class description opens with the
# definition, so the start of both sources is the most card-shaped part.
SCRAPE_CHAR_BUDGET = int(_env("SCRAPE_CHAR_BUDGET", "6000"))
