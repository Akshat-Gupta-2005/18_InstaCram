-- Count generation runs per topic.
--
-- An empty topic (every draft failed fact-check) is retried on a later request,
-- with no attempt limit. Each retry costs a full pipeline run - scrape plus several
-- LLM calls - so the number of runs has to be observable. Without it, a topic that
-- can never pass burns money indefinitely and nothing reports it. This is the P10
-- lesson ("fail fast needs a counter") applied to the retry decision that followed it.

ALTER TABLE topic_generation_stats
  ADD COLUMN runs integer NOT NULL DEFAULT 0 CHECK (runs >= 0);

COMMENT ON COLUMN topic_generation_stats.runs IS
  'Pipeline runs for this topic. >1 means it came back empty and was retried.';
