-- Raise the quarantine cap from 5 to 20 rejections per topic.
--
-- 001 is already applied, so the change is a new migration rather than an edit.
-- Only the limit changes. Ordering is still by rejected_at. Rejections from one
-- pipeline run share a transaction timestamp and tie with each other, but each run
-- gets its own timestamp, so a newer run always outranks an older one
-- (verify-invariants.sql check 8c). Empty topics are retried on a later request,
-- so a topic can accumulate several runs of at most 4 rejections each; once past
-- 20 rows the cap may trim the OLDEST retained run arbitrarily among its tied rows.
-- That loses nothing diagnostic. See Docs/DECISIONS.md P14.

CREATE OR REPLACE FUNCTION rejected_draft_cap()
RETURNS trigger AS $$
BEGIN
  DELETE FROM rejected_draft
  WHERE topic_id = NEW.topic_id
    AND id NOT IN (
      SELECT id FROM rejected_draft
      WHERE topic_id = NEW.topic_id
      ORDER BY rejected_at DESC
      LIMIT 20
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
