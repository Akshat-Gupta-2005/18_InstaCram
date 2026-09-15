-- Topics whose scrape returned something that is not about the topic.
--
-- WHY: the scraper spike reported 10/10 usable while four Java topics were all
-- grounded on one identical article (Java collections framework, 22,789 chars
-- each). Its success test was "more than 500 characters", which cannot tell the
-- right article from a wrong one of the same length. Nothing in the pipeline
-- design would have caught it either: the generated text would not be FALSE, so
-- the fact-check gate passes it. It would just be generic and not about the
-- topic. This table is the detector that gap needs. See Docs/DECISIONS.md P26.
--
-- WHY THIS DEDUPES INSTEAD OF CAPPING, unlike rejected_draft (002): a rejected
-- draft is a distinct event each time and the cap bounds retention. A mismatch
-- is the SAME FACT re-observed - "Wikipedia has no HashMap article" is not new
-- information on the fourth retry. Empty topics are retried on later requests
-- (P16), so appending per run would let one unsourceable topic flood the table.
-- The unique key bounds growth by distinct topics rather than by runs, and
-- times_detected keeps the information a cap would have thrown away.
--
-- WHY NO topic_id FOREIGN KEY: a mismatch can happen for a candidate that never
-- becomes a topic row, and the question this table answers - "which fields need
-- a different source?" - outlives any individual topic. Names are also what the
-- source is queried by, so they are the honest key here.

CREATE TABLE unsourced_topic (
  id                bigserial PRIMARY KEY,
  topic_name        text NOT NULL,
  field_name        text,
  source            text NOT NULL,
  matched_title     text,                                  -- NULL when nothing came back at all
  kind              text NOT NULL
                    CHECK (kind IN ('no_article', 'generic')),
  chars             integer CHECK (chars >= 0),            -- kept to show that length proves nothing
  times_detected    integer NOT NULL DEFAULT 1 CHECK (times_detected > 0),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at  timestamptz NOT NULL DEFAULT now(),
  note              text
);

-- Lowercased to match how candidates.ts already dedupes candidate names, so the
-- same topic in two casings is one row rather than two.
CREATE UNIQUE INDEX unsourced_topic_name_source
  ON unsourced_topic (lower(topic_name), source);

-- Answers "which field should stop using this source", the reason the table exists.
CREATE INDEX unsourced_topic_field ON unsourced_topic (field_name);

-- The six rows below were measured by hand on 2026-09-15, by the scraper spike and
-- by direct title lookups against Wikipedia, BEFORE the pipeline existed to record
-- them. They are inserted here so the table starts with the evidence that caused it
-- to be built, rather than starting empty and losing the finding. Everything after
-- this comes from W4's scraper.
INSERT INTO unsourced_topic
  (topic_name, field_name, source, matched_title, kind, chars, note)
VALUES
  ('HashMap', 'Java Collections', 'wikipedia', 'Hash table', 'generic', 36168,
   'No article titled HashMap exists (404). Returned the general data structure, not the Java class.'),
  ('TreeSet', 'Java Collections', 'wikipedia', 'Java collections framework', 'generic', 22789,
   'Direct title lookup redirects to "Set (abstract data type)". Search fell back to the framework overview.'),
  ('ArrayList', 'Java Collections', 'wikipedia', 'Java collections framework', 'generic', 22789,
   'Direct title lookup redirects to "Dynamic array". Same fallback article as TreeSet, byte-identical.'),
  ('LinkedHashMap', 'Java Collections', 'wikipedia', 'Java collections framework', 'no_article', 22789,
   '404 on direct title lookup. Same fallback article, byte-identical.'),
  ('ConcurrentSkipListMap', 'Java Collections', 'wikipedia', 'Java collections framework', 'no_article', 22789,
   '404 on direct title lookup. Four topics sharing one source page is the clearest signal in this table.'),
  ('Availability heuristic', 'Behavioural Economics', 'wikipedia', 'Heuristic', 'generic', 19400,
   'The only non-technical mismatch. Wikipedia DOES have an "Availability heuristic" article, so unlike the Java cases this one is fixable by better querying.');
