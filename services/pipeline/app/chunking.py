"""Splitting source material so a prompt cannot silently overflow the context.

Exists because overflow here is SILENT and the failure is invisible from the
outside. Ollama truncates an over-long prompt from the front and answers anyway,
so the fact-checker returned confident, well-formed verdicts on cards it had
never been shown. Nothing errored; the rejection rate simply went to zero. See
DECISIONS P33.

Two properties matter, and both exist to avoid manufacturing a false verdict:

  CLEAN BREAKS. A chunk cut mid-sentence invites a reader - human or model - to
  judge a fragment. Breaks are preferred at a paragraph, then a line, then a
  sentence, and only fall back to a hard cut when a single run of text offers
  nothing to break on.

  OVERLAP. A claim that straddles a boundary would be half-present in two chunks
  and whole in neither, and a contradiction no chunk can see is a contradiction
  the gate reports as absent. Overlapping means every span of `overlap`
  characters appears complete in at least one chunk.
"""

from __future__ import annotations

# Ordered by how much of a break each one is. A paragraph break is a real
# boundary in the source; a full stop is the weakest signal worth using.
_SEPARATORS = ("\n\n", "\n", ". ")

# Only the tail of a window is searched for a break. Looking further back would
# let one early paragraph break shrink a chunk to a fraction of the budget and
# multiply the number of calls.
_TAIL_FRACTION = 0.25


def split(text: str, *, size: int, overlap: int = 0) -> list[str]:
    """Split `text` into chunks of at most `size` characters.

    Short text is returned as a single chunk, so the common case - a Javadoc
    class description, a lead section - costs exactly one call and behaves as it
    did before chunking existed.
    """
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap < 0:
        raise ValueError("overlap cannot be negative")
    if overlap >= size:
        # Otherwise each step back would be at least as large as each step
        # forward, and the walk below would never terminate.
        raise ValueError(f"overlap {overlap} must be smaller than size {size}")

    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]

    chunks: list[str] = []
    start = 0

    while start < len(text):
        end = start + size
        if end >= len(text):
            chunks.append(text[start:].strip())
            break

        window = text[start:end]
        cut = _break_point(window)
        chunks.append(window[:cut].strip())

        # Never step back more than half of what was just emitted. An overlap
        # approaching the chunk size would otherwise reduce forward progress to a
        # crawl - size 200 with overlap 199 advances one character per chunk,
        # which terminates but turns one source into thousands of model calls.
        # Half keeps every boundary-spanning span whole somewhere while bounding
        # the chunk count at roughly twice the minimum.
        step_back = min(overlap, cut // 2)
        start = max(start + 1, start + cut - step_back)

    return [c for c in chunks if c]


def _break_point(window: str) -> int:
    """Index to cut this window at - the latest good break in its tail."""
    floor = int(len(window) * (1 - _TAIL_FRACTION))
    for sep in _SEPARATORS:
        found = window.rfind(sep, floor)
        if found != -1:
            return found + len(sep)
    return len(window)
