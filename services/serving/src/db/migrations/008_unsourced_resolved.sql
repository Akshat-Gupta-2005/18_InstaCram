-- Mark an unsourced topic as resolved once some source grounds it.
--
-- WHY: the table answers "which fields need a different source". After the
-- Javadoc source landed, all five Java Collections topics grounded - and the
-- table still reported five unsourced topics for that field, which is the exact
-- opposite of the truth. A diagnostic that goes stale silently is worse than no
-- diagnostic, because it is still believed.
--
-- WHY resolved_at RATHER THAN DELETING THE ROW: "wikipedia could not ground
-- HashMap, javadoc could" is the finding that justified adding a second source.
-- Deleting it would erase the evidence for a decision already taken, and the
-- next person would have to rediscover it. Consistent with how this schema
-- treats cards (retire, never delete - invariant 12, migration 005), for the
-- same reason: the row is still true, it is just no longer current.

ALTER TABLE unsourced_topic
  ADD COLUMN resolved_at   timestamptz,
  ADD COLUMN resolved_by   text;        -- the source that finally grounded it

-- Every "how bad is it" query filters on this, so it is worth an index that
-- serves the common case directly.
CREATE INDEX unsourced_topic_open
  ON unsourced_topic (field_name)
  WHERE resolved_at IS NULL;

-- The six seeded rows were recorded before the Javadoc source existed. Five of
-- them are now grounded by it or by direct-title lookup, verified by a real run
-- on 2026-09-15 scoring 10/10 with 0 refusals. Marking them here rather than
-- leaving the pipeline to do it on its next run, so the table is not misleading
-- in between.
UPDATE unsourced_topic
   SET resolved_at = now(),
       resolved_by = 'javadoc'
 WHERE source = 'wikipedia'
   AND lower(topic_name) IN (
         'hashmap', 'treeset', 'arraylist', 'concurrentskiplistmap', 'linkedhashmap'
       );

UPDATE unsourced_topic
   SET resolved_at = now(),
       resolved_by = 'wikipedia'
 WHERE source = 'wikipedia'
   AND lower(topic_name) = 'availability heuristic';
