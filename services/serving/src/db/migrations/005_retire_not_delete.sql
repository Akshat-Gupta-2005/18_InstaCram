-- Cards are retired, never deleted.
--
-- Before this migration, a card anyone had viewed could not be deleted at all:
-- deleting a scroll cascades into user_view, and user_view's append-only trigger
-- blocks the delete (verify-invariants check 9d, as it stood). Letting deletes
-- through would erase view history, the one dataset that cannot be rebuilt. So a
-- card leaving circulation (e.g. flagged incorrect, post-MVP) is marked retired.
-- See Docs/DECISIONS.md P20.

ALTER TABLE scroll ADD COLUMN retired_at timestamptz;

-- Every read path queries live_scroll, never scroll. This carries the same
-- forgotten-WHERE risk rejected for the quarantine, and the view is what contains
-- it: the safe query is the default one. Columns are listed explicitly, so a
-- column added to scroll later must be added here on purpose.
CREATE VIEW live_scroll AS
  SELECT id, topic_id, content, source_url, trust_label,
         why_it_matters, recall_prompt, recall_answer, created_at
  FROM scroll
  WHERE retired_at IS NULL;

-- Feed queries read live scrolls by topic; keep that path indexed.
CREATE INDEX scroll_live_topic_idx ON scroll (topic_id) WHERE retired_at IS NULL;

-- Invariant 12: no scroll is ever hard-deleted, viewed or not. Enforced by the
-- database rather than by convention, and it gives a clear instruction instead
-- of the confusing append-only error that a cascade into user_view produced.
CREATE OR REPLACE FUNCTION scroll_is_never_deleted()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'scrolls are retired, never deleted (invariant 12): set retired_at instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scroll_no_delete
  BEFORE DELETE ON scroll
  FOR EACH ROW EXECUTE FUNCTION scroll_is_never_deleted();
