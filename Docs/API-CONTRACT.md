# InstaCram — API Contract (v1)

The contract both clients build against. Behaviour and rationale live in [BUILD-PLAN.md](BUILD-PLAN.md) §4.3a–§4.3b; this document is the shape.

Base path `/v1`. All bodies are JSON. All authenticated routes take `Authorization: Bearer <firebase-id-token>`.

---

## 1. Client obligations

Two rules that are invisible until the data is already wrong. Both are the client's responsibility and neither can be enforced server-side.

**1. Log a view when a card is DISPLAYED, never when a page is fetched.** Prefetch means a client holds up to a page of cards it has not shown. The server does not infer impressions from what it sent. Fetching 10 and showing 4 must produce exactly 4 view events. Getting this wrong permanently corrupts the only dataset in the system that cannot be rebuilt (P12).

**2. Poll at the cadence the server gives you.** Use `retry_after_ms` from the response rather than a hardcoded interval. The server knows how many topics are still generating; the client does not.

---

## 2. `GET /health`

Unauthenticated. Used by Docker healthchecks and Kubernetes probes.

```json
{ "status": "ok", "service": "serving", "db": "ok", "version": "0.1.0" }
```

`200` when dependencies are reachable, `503` otherwise.

---

## 3. `POST /v1/feed`

The main endpoint. Returns the next page of scrolls the user has not yet viewed in a field. Creates the field on first request and triggers generation on a cache miss.

**Request**

```json
{ "field": "Java Collections", "limit": 10 }
```

| Field | Type | Notes |
|---|---|---|
| `field` | string | Free text as typed. Normalised server-side, so casing and padding do not create duplicate fields. |
| `limit` | integer | Optional, default 10, max 30. |

**Response `200`**

```json
{
  "field": { "id": "0f9c…", "name": "Java Collections" },
  "scrolls": [
    {
      "id": "7a21…",
      "topic": { "id": "b3e4…", "name": "HashMap" },
      "content": "A HashMap stores key-value pairs…",
      "source_url": "https://docs.oracle.com/…",
      "trust_label": "sourced_verified",
      "why_it_matters": "It is the default answer to 'how do I look this up fast'.",
      "recall": {
        "prompt": "What is the average-case cost of a HashMap lookup?",
        "answer": "O(1), degrading to O(log n) once a bucket treeifies."
      },
      "saved": false
    }
  ],
  "generating": true,
  "topics_pending": 7,
  "retry_after_ms": 3000,
  "failed_topics": [ { "id": "c91d…", "name": "ConcurrentSkipListMap" } ],
  "exhausted": false,
  "end_card": null
}
```

| Field | Meaning |
|---|---|
| `scrolls` | **May contain fewer than `limit`, including zero.** Render what arrived. |
| `generating` | More cards are being produced for this field. Re-request after `retry_after_ms`. |
| `topics_pending` | Topics still in the pipeline. Drives a ready-count in the waiting state — never shown before the user exhausts the cards already in hand. |
| `retry_after_ms` | Server-dictated poll cadence. Absent when `generating` is false. |
| `exhausted` | No unviewed scrolls remain. See §4. |
| `failed_topics` | Topics in this field whose last generation run produced no card that passed fact-check. **Tell the user** — "couldn't load verified cards for ConcurrentSkipListMap" — rather than silently omitting the topic. It is dropped for this run, and paging or polling never retries it. It is retried on the field's **next generation run**, which is the next "more topics" tap (§4), or sooner if another field's candidate generation proposes it. While that retry runs, it appears under `topics_pending`. Empty array when nothing failed. |

**Paging has no cursor.** "The next page" means "scrolls this user has not viewed", so successive calls advance as views are logged. A field gaining new topics mid-session cannot invalidate a position that does not exist.

**Retired cards are never returned by any endpoint.** A card taken out of circulation (for example, flagged incorrect after the MVP) is retired rather than deleted. It then disappears from feeds, revision mode and saves, but its view history is kept.

The three states are distinguishable and must not be conflated by the client:

| `scrolls` | `generating` | `exhausted` | Means |
|---|---|---|---|
| non-empty | `false` | `false` | Normal page |
| partial/empty | `true` | `false` | Cold start — keep polling |
| empty | `false` | `true` | Field finished — render the end card |

---

## 4. End of field

When `exhausted` is `true`, `end_card` is populated and `scrolls` is empty.

```json
{
  "scrolls": [],
  "generating": false,
  "exhausted": true,
  "end_card": {
    "viewed_count": 42,
    "adjacent_fields": [
      { "id": "1c8b…", "name": "Java Concurrency", "shared_topics": 4, "source": "overlap",   "has_content": true },
      { "id": null,     "name": "JVM Internals",    "shared_topics": 0, "source": "suggested", "has_content": false }
    ]
  }
}
```

`source` distinguishes the two kinds of suggestion and the client **must** render them differently. `overlap` fields are ranked by shared topics and already have content. `suggested` fields come from an LLM when overlap is thin, have `has_content: false`, and tapping one lands the user in a full cold start — which is fine, but should not be a surprise.

The feed never silently loops. Continuing is always one of the three actions below.

### `POST /v1/fields/{field_id}/expand`

Re-runs candidate generation for the field with its existing topic names passed as exclusions, and **re-queues the field's failed topics** for another attempt. User-triggered only.

```json
{ "topics_queued": 6, "failed_retried": 1, "retry_after_ms": 4000 }
```

| Field | Meaning |
|---|---|
| `topics_queued` | New candidate topics sent to the pipeline |
| `failed_retried` | Previously failed topics sent back for another run |

If both are `0`, the generator produced nothing new and nothing was waiting to be retried. The field is genuinely exhausted, and the client should say so rather than offering the action again.

### `POST /v1/feed/revision`

Same request and response shape as `POST /v1/feed`, except it returns **already-viewed** scrolls ordered by oldest `viewed_at` first. `exhausted` is never true here; the list cycles.

Each card shown in revision mode logs a new view event like any other, which is what moves it back to the end of the queue.

### `GET /v1/fields/{field_id}/adjacent`

Returns the same `adjacent_fields` array standalone, for a client that wants it outside the end card.

---

## 5. `POST /v1/views`

Records displayed cards. Batched — the client may buffer and flush.

```json
{ "views": [ { "scroll_id": "7a21…", "viewed_at": "2026-09-11T14:02:11Z" } ] }
```

`viewed_at` is optional; the server uses its own clock when omitted. Duplicate `scroll_id`s are accepted and recorded as separate impressions — re-viewing in revision mode is a real event.

**Response `202`**

```json
{ "recorded": 4 }
```

---

## 6. Saves

| Route | Effect |
|---|---|
| `GET /v1/saves` | Full scroll objects for the account's saves, newest first by `saved_at`. Saves of retired cards are left out. |
| `PUT /v1/saves/{scroll_id}` | Idempotent add |
| `DELETE /v1/saves/{scroll_id}` | Idempotent remove |

Both mutations return the complete updated list, so the client's local mirror can be replaced wholesale rather than patched:

```json
{ "saved_scroll_ids": ["7a21…", "9f03…"] }
```

---

## 6a. `DELETE /v1/account`

Erases the caller's account. It removes the account, its view history and its saves in one transaction, and **also deletes the user from Firebase Auth**, so no identity remains on either side. An audit row records only when the erasure happened and how many rows it removed. It never records who.

**Response `204`**, no body.

This is the only path that can remove view history. It exists for data-erasure requests, and nothing else in the system can delete from the view log.

---

## 7. Errors

```json
{ "error": { "code": "field_too_long", "message": "field must be 100 characters or fewer" } }
```

| Status | When |
|---|---|
| `400` | Malformed body or a failed field validation |
| `401` | Missing or invalid token |
| `404` | Unknown `field_id` or `scroll_id` |
| `429` | Rate limit — carries `retry_after_ms` |
| `503` | A dependency is down. The feed degrades rather than failing: if the pipeline is unreachable but cached content exists, serve the cached page with `generating: false`. |

---

## 8. Not in v1

Search, topic requests, flagging incorrect cards, multi-field blended feeds, depth toggles. All are ranked post-MVP in [FEATURES.md](FEATURES.md) §3.7. Adding a route later is cheap; changing `POST /v1/feed`'s semantics once two clients ship against it is not.
