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


def _find_repo_root(start: Path) -> Path:
    """Walks up looking for the repo, instead of counting directory levels.

    Counting broke the container. On the host this file is
    services/pipeline/app/config.py - four levels below the root - but the image
    flattens it to /app/app/config.py, where `parents[3]` raises IndexError and
    the service cannot even import. It stayed hidden for several commits because
    the image was not rebuilt, so the container kept running older code: the same
    shape as P22, where a documented command had never actually been executed.

    Inside the container there is no repo and no .env; every value arrives from
    compose, so returning the parent is correct and the missing file is a no-op.
    """
    for candidate in (start, *start.parents):
        if (candidate / "docker-compose.yml").is_file():
            return candidate
    return start.parent


REPO_ROOT = _find_repo_root(Path(__file__).resolve().parent)
ENV_PATH = REPO_ROOT / ".env"

# A missing .env is NOT an error: in containers every value comes from compose,
# and in CI from the runner.
load_dotenv(ENV_PATH)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env(
    "DATABASE_URL", "postgres://instacram:instacram@localhost:5432/instacram"
)
EMBEDDINGS_URL = _env("EMBEDDINGS_URL", "http://localhost:8081")
QDRANT_URL = _env("QDRANT_URL", "http://localhost:6333")
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

# The fact-checker gets the WHOLE source rather than the generator's 6000-char
# front slice, because a claim it must verify may come from anywhere in the page.
# It is the one caller that cannot simply truncate, so it chunks instead. Two
# DIFFERENT numbers govern that, and conflating them costs accuracy either way.
#
# THE BACKGROUND, measured not assumed. Ollama 0.34.0 defaults num_ctx to 4096 and
# nothing in the stack ever set it, so a longer prompt is silently truncated FROM
# THE FRONT - and the front of the fact-check prompt is the card. On qwen3:8b a
# 16,143-char prompt evaluated 3,613 tokens and the model could still repeat a
# marker placed at the top; a 32,143-char prompt evaluated 2,050 and could not.
# The gate caught 4/4 planted errors on a 4.7k-char source and 0/3 on a 32k one,
# explaining that "the card does not contain any specific factual claims" - it was
# not being lenient, it could not see the card. See P33.

# (1) Up to this much source, ONE call carrying the whole thing. Measured: planted
# errors were caught 9/9 by single-pass prompts at 2k, 4k, 6k, 10k and 16k chars.
# 10,000 is the conservative end of that verified range, and single-pass is the
# better check where it fits - the model sees the whole source at once and may
# also weigh its own knowledge, which the chunk pass deliberately forbids.
FACT_CHECK_SINGLE_PASS_CHARS = int(_env("FACT_CHECK_SINGLE_PASS_CHARS", "10000"))

# (2) Beyond that, the size of each excerpt. NOT the same number, and smaller on
# purpose. At 10,000-char excerpts the checker called a card that INVERTED the
# source's own claim "supported" - it matched on subject rather than assertion,
# and tightening the prompt did not move it. The same cards at 4,000-char
# excerpts were caught 2/2 while both faithful controls still passed. Nothing
# about the context window forced this; the claims were always inside the
# excerpt. A larger excerpt simply dilutes attention across more text.
FACT_CHECK_CHUNK_CHARS = int(_env("FACT_CHECK_CHUNK_CHARS", "4000"))

# Chunks overlap so a claim spanning a boundary is whole in at least one of them.
# Without it, splitting mid-sentence would let a contradiction fall through the
# crack between two chunks and be reported by neither.
FACT_CHECK_CHUNK_OVERLAP = int(_env("FACT_CHECK_CHUNK_OVERLAP", "800"))

# Outbox retry. The POLICY was decided on 2026-09-11 - bounded retries, then
# dead-letter, with the reconciliation sweep re-enqueueing failed rows - so these
# are only its parameters.
#
# Five attempts on exponential backoff from 2s covers 2+4+8+16+32 = ~62s, which
# is comfortably longer than a Qdrant container restart, the overwhelmingly
# likely transient cause. Anything still failing after a minute is probably
# poisoned rather than unlucky - a malformed payload, or a dimension mismatch
# after a model change - and unbounded retry on a poisoned row spins forever
# while looking like a worker that never catches up. Reconciliation picks those
# up on its own schedule, so the topic is never lost either way.
OUTBOX_MAX_ATTEMPTS = int(_env("OUTBOX_MAX_ATTEMPTS", "5"))
OUTBOX_BASE_BACKOFF_SECONDS = int(_env("OUTBOX_BASE_BACKOFF_SECONDS", "2"))
