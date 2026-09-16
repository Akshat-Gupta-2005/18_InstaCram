-- W5: candidate generation for a field is a job (DECISIONS 2026-09-16).
--
-- Candidate generation takes 32-54s, so the first feed request for a field cannot
-- wait for it. It enqueues a row here and returns `generating: true`; a worker in
-- serving claims the row, generates candidates, and resolves each one.
--
-- An open expansion counts toward `generating`. Without that, a brand-new field
-- has no topics while its candidates are being produced, so it reports
-- `exhausted` and shows the end-of-field card for most of a minute.
CREATE TABLE field_expansion (
  id              bigserial PRIMARY KEY,
  field_id        uuid NOT NULL REFERENCES field (id) ON DELETE CASCADE,
  -- 'initial' fills a field on its first request; 'more' is the user's
  -- "more topics" tap (task 5.6), which passes existing names as exclusions.
  kind            text NOT NULL CHECK (kind IN ('initial', 'more')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  last_error      text,
  -- How each candidate resolved. Kept because "the field has few topics" has
  -- four different causes, and these counts are what tell them apart - and
  -- because a high `created` share is the cache hit rate W5 must measure.
  candidates      integer,
  reused          integer,
  joined          integer,
  requeued        integer,
  created         integer,
  resolve_errors  integer,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- P16, one level up: polling must never re-run candidate generation. A field
-- gets at most ONE initial expansion, ever; a later poll's insert is a no-op.
CREATE UNIQUE INDEX field_expansion_initial_once
  ON field_expansion (field_id) WHERE kind = 'initial';

-- At most one expansion outstanding per field, so repeated "more topics" taps
-- while one is still running do not stack up LLM calls.
CREATE UNIQUE INDEX field_expansion_one_open
  ON field_expansion (field_id) WHERE status IN ('pending', 'running');

-- The worker's claim query.
CREATE INDEX field_expansion_claim_idx
  ON field_expansion (next_attempt_at) WHERE status = 'pending';
