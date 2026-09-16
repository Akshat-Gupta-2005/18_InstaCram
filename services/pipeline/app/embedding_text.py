"""The one place the pipeline builds the text that represents a topic.

THIS IS A CROSS-SERVICE CONTRACT, and it is the dangerous kind: the serving
service builds the same string to LOOK UP a topic, and this service builds it to
WRITE the vector. If the two ever disagree by a single character, every lookup
silently misses, every topic regenerates as a duplicate, and nothing errors -
the cache simply stops working while reporting perfect health.

The authority is services/serving/src/topics/embeddingText.ts:

    const prefix = process.env.EMBEDDING_TEXT_PREFIX ?? "";
    return `${prefix}${name}: ${description}`;

Mirrored here rather than shared because the two services are different
languages; tests/test_embedding_text.py pins the exact format so a change on
either side fails rather than drifts. This project has now been bitten twice by
one contract with two implementations - two dotenv loaders resolving different
files (P25), and an output contract documented where the model never saw it
(P29). This is the same shape, with a worse failure mode, because a broken cache
looks exactly like a working one.

The prefix is EMPTY by default, and deliberately: e5's documented "query: "
prefix was measured and made reuse WORSE (53% vs 67%), so the convention was
tested rather than assumed and then not used.
"""

from __future__ import annotations

import os


def topic_embedding_text(name: str, description: str) -> str:
    prefix = os.environ.get("EMBEDDING_TEXT_PREFIX", "")
    return f"{prefix}{name}: {description}"
