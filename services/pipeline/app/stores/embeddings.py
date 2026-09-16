"""Calls the self-hosted embeddings service.

Deliberately NOT routed through the LiteLLM gateway. The embedding call is the
highest-volume model call in the system - roughly 20 candidates on every field
request, against a handful of LLM calls only on a cache miss - so it runs against
the local text-embeddings-inference container with no gateway hop.

The model and the calibrated threshold are a matched pair: `0.955` was measured
on `intfloat/e5-base-v2`, and vectors from a different model make that number
meaningless. Changing the model means `reindex` plus re-calibration, together.
"""

from __future__ import annotations

import httpx

from app.config import EMBEDDINGS_URL

# The service batches internally and caps concurrency at 8; 32 per request keeps
# payloads small enough to stay well inside the read timeout.
BATCH = 32


class EmbeddingError(RuntimeError):
    pass


async def embed(client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    """Embeds in order. The returned list lines up with `texts` index for index."""
    if not texts:
        return []

    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH):
        chunk = texts[start : start + BATCH]
        try:
            resp = await client.post(
                f"{EMBEDDINGS_URL}/embed", json={"inputs": chunk}, timeout=120
            )
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"embeddings service unreachable: {exc}") from exc

        if resp.status_code != 200:
            raise EmbeddingError(f"embeddings {resp.status_code}: {resp.text[:200]}")

        try:
            batch = resp.json()
        except ValueError as exc:
            raise EmbeddingError("embeddings returned non-JSON") from exc

        if not isinstance(batch, list) or len(batch) != len(chunk):
            raise EmbeddingError(
                f"embeddings returned {len(batch) if isinstance(batch, list) else '?'} "
                f"vectors for {len(chunk)} inputs"
            )
        vectors.extend(batch)

    return vectors


async def embed_one(client: httpx.AsyncClient, text: str) -> list[float]:
    vectors = await embed(client, [text])
    if not vectors:
        raise EmbeddingError("embeddings returned nothing for a single input")
    return vectors[0]
