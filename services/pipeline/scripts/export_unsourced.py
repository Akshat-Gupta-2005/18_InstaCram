"""Regenerate sourcing/unsourced-topics.json from the unsourced_topic table.

The TABLE is the record: the pipeline writes to it, it survives container
restarts, it is safe under concurrent topic workers, and it can be queried
("which field mismatches most?"). This FILE is a readable, committable snapshot
of that table - useful in review and in a diff, useless as a place for a
container to write. See Docs/DECISIONS.md P26.

The file is overwritten wholesale, never appended to, so it can never disagree
with the table about what was observed.

Run:  .venv/Scripts/python scripts/export_unsourced.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

OUT_PATH = Path(__file__).resolve().parents[1] / "sourcing" / "unsourced-topics.json"

HEADER_COMMENT = [
    "Topics whose scrape did NOT return an article about the topic itself.",
    "",
    "GENERATED FILE - do not edit by hand. Regenerate with:",
    "    cd services/pipeline && .venv/Scripts/python scripts/export_unsourced.py",
    "The unsourced_topic table is the record; this is a snapshot of it.",
    "",
    "WHY THIS EXISTS: the scraper spike reported 10/10 success while four Java",
    "topics were all grounded on one identical article. The success metric was",
    "'more than 500 characters', which cannot tell the right article from a wrong",
    "one of the same length. This is the record that metric could not keep.",
    "See Docs/DECISIONS.md P26.",
    "",
    "KINDS:",
    "  no_article - the source has no page for this topic at all",
    "  generic    - the source returned a broader page that subsumes the topic",
    "",
    "WHAT IT IS FOR: deciding which sources a field needs. A field whose topics",
    "cluster here does not need better search - it needs a different source.",
]

QUERY = """
SELECT topic_name, field_name, source, matched_title, kind, chars,
       times_detected, first_detected_at, last_detected_at, note
FROM unsourced_topic
ORDER BY field_name NULLS LAST, topic_name
"""


async def main() -> int:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        print("DATABASE_URL is not set. It lives in the repo-root .env.", file=sys.stderr)
        return 1

    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(QUERY)
    finally:
        await conn.close()

    entries = [
        {
            "topic": r["topic_name"],
            "field": r["field_name"],
            "source": r["source"],
            "matched_title": r["matched_title"],
            "kind": r["kind"],
            "chars": r["chars"],
            "times_detected": r["times_detected"],
            "first_detected_at": r["first_detected_at"].date().isoformat(),
            "last_detected_at": r["last_detected_at"].date().isoformat(),
            "note": r["note"],
        }
        for r in rows
    ]

    # Which field mismatches most is the question the table exists to answer, so the
    # export answers it up front instead of leaving it to whoever reads the entries.
    by_field: dict[str, int] = {}
    for e in entries:
        key = e["field"] or "(unknown)"
        by_field[key] = by_field.get(key, 0) + 1

    document = {
        "_comment": HEADER_COMMENT,
        "total": len(entries),
        "by_field": dict(sorted(by_field.items(), key=lambda kv: (-kv[1], kv[0]))),
        "entries": entries,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"  {len(entries)} topic(s) across {len(by_field)} field(s)")
    for field, count in document["by_field"].items():
        print(f"  {count:>3}  {field}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
