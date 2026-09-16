"""Vector writes and searches against Qdrant.

Collection names and the distance metric are a CROSS-SERVICE CONTRACT with
services/serving/src/vectors/collections.ts, which creates them. This module
never creates a collection: creating one with the wrong vector size or metric
would be accepted silently and poison every later write, and a second creator is
a second chance to disagree. If a collection is missing, that is an error worth
surfacing, not something to paper over by making one.

Postgres is the source of truth and every vector is derived from it, so a wrong
vector is always recoverable by `reindex` - which is exactly why the write order
puts Postgres first (§4.6).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import QDRANT_URL

TOPIC_NAME_COLLECTION = "topic_names"
SCROLL_CONTENT_COLLECTION = "scroll_contents"


class QdrantError(RuntimeError):
    pass


async def _request(
    client: httpx.AsyncClient, method: str, path: str, **kwargs: Any
) -> httpx.Response:
    try:
        resp = await client.request(method, f"{QDRANT_URL}{path}", timeout=30, **kwargs)
    except httpx.HTTPError as exc:
        raise QdrantError(f"qdrant unreachable: {exc}") from exc
    return resp


async def upsert_point(
    client: httpx.AsyncClient,
    collection: str,
    *,
    point_id: str,
    vector: list[float],
    payload: dict[str, Any],
) -> None:
    """Writes one vector. Idempotent by point id, which is what makes an outbox
    retry safe: the same topic written twice produces one point, not two."""
    resp = await _request(
        client,
        "PUT",
        f"/collections/{collection}/points",
        params={"wait": "true"},
        json={"points": [{"id": point_id, "vector": vector, "payload": payload}]},
    )
    if resp.status_code != 200:
        raise QdrantError(
            f"qdrant {resp.status_code} upserting into {collection}: {resp.text[:200]}"
        )


async def search(
    client: httpx.AsyncClient,
    collection: str,
    *,
    vector: list[float],
    limit: int = 5,
) -> list[dict[str, Any]]:
    resp = await _request(
        client,
        "POST",
        f"/collections/{collection}/points/search",
        json={"vector": vector, "limit": limit, "with_payload": True},
    )
    if resp.status_code != 200:
        raise QdrantError(f"qdrant {resp.status_code} searching {collection}")
    return resp.json().get("result", [])


async def point_exists(client: httpx.AsyncClient, collection: str, point_id: str) -> bool:
    resp = await _request(client, "GET", f"/collections/{collection}/points/{point_id}")
    if resp.status_code == 404:
        return False
    if resp.status_code != 200:
        raise QdrantError(f"qdrant {resp.status_code} reading {collection}/{point_id}")
    return resp.json().get("result") is not None


async def all_point_ids(client: httpx.AsyncClient, collection: str) -> set[str]:
    """Every id in a collection, paged. Used by reconciliation to find vectors
    whose topic no longer exists - the direction the outbox cannot cover, because
    the outbox only ever knows about writes it was asked to make."""
    ids: set[str] = set()
    offset: Any = None
    while True:
        body: dict[str, Any] = {"limit": 1000, "with_payload": False, "with_vector": False}
        if offset is not None:
            body["offset"] = offset
        resp = await _request(
            client, "POST", f"/collections/{collection}/points/scroll", json=body
        )
        if resp.status_code != 200:
            raise QdrantError(f"qdrant {resp.status_code} scrolling {collection}")
        result = resp.json().get("result", {})
        ids.update(str(p["id"]) for p in result.get("points", []))
        offset = result.get("next_page_offset")
        if offset is None:
            return ids


async def delete_points(
    client: httpx.AsyncClient, collection: str, point_ids: list[str]
) -> None:
    if not point_ids:
        return
    resp = await _request(
        client,
        "POST",
        f"/collections/{collection}/points/delete",
        params={"wait": "true"},
        json={"points": point_ids},
    )
    if resp.status_code != 200:
        raise QdrantError(f"qdrant {resp.status_code} deleting from {collection}")
