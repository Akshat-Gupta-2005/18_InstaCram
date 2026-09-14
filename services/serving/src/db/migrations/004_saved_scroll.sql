-- Replace account.saved_scroll_ids (uuid[]) with a saved_scroll table.
--
-- The array could not carry a foreign key, so invariant 8 (no dangling saves) was
-- unenforced. It also had no saved_at, so the "newest first" order that
-- Docs/API-CONTRACT.md promises for GET /v1/saves relied on array order never
-- changing, which nothing guaranteed. A table fixes both. See DECISIONS.md P18.

CREATE TABLE saved_scroll (
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  scroll_id  uuid NOT NULL REFERENCES scroll (id) ON DELETE CASCADE,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  -- Also makes PUT /v1/saves/{id} idempotent: INSERT ... ON CONFLICT DO NOTHING.
  PRIMARY KEY (account_id, scroll_id)
);

-- Serves GET /v1/saves, newest first.
CREATE INDEX saved_scroll_account_time_idx ON saved_scroll (account_id, saved_at DESC);

-- Carry over any existing saves. Nothing has been saved yet, but this keeps the
-- migration correct against a database where something has. WITH ORDINALITY
-- keeps the array's order (the most recently appended ID becomes the newest),
-- and IDs of scrolls that no longer exist are dropped, since they were
-- dangling saves to begin with.
INSERT INTO saved_scroll (account_id, scroll_id, saved_at)
SELECT a.id, s.scroll_id, now() + s.ord * interval '1 microsecond'
FROM account a
CROSS JOIN LATERAL unnest(a.saved_scroll_ids) WITH ORDINALITY AS s (scroll_id, ord)
WHERE EXISTS (SELECT 1 FROM scroll WHERE scroll.id = s.scroll_id)
ON CONFLICT DO NOTHING;

ALTER TABLE account DROP COLUMN saved_scroll_ids;
