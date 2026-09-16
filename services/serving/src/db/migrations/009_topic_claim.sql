-- W5: a pending topic IS the pipeline's job (DECISIONS 2026-09-16).
--
-- Serving creates a topic with status 'pending' on a cache miss; a pipeline
-- worker claims it with FOR UPDATE SKIP LOCKED. `status` is deliberately NOT
-- extended with a 'running' value. The feed already reads 'pending' as
-- "generating", and a topic being worked on is still generating from the user's
-- point of view - a separate state would be a second column-value that every
-- read path would have to remember to count.
--
-- So the claim lives in its own column, and it doubles as the backoff. The graph's
-- `degraded` outcome (the fact-checker failed, not the cards) leaves a topic
-- 'pending' on purpose. A worker that claimed every pending row would retry a
-- broken checker in a hot loop; instead a claimed topic is re-claimable only once
-- its claim has gone stale, which also recovers a topic whose worker died mid-run.
ALTER TABLE topic ADD COLUMN claimed_at timestamptz;

-- The worker's claim query: pending topics, oldest first.
CREATE INDEX topic_claimable_idx ON topic (created_at) WHERE status = 'pending';
