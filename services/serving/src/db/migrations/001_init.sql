-- InstaCram — initial schema
-- 9 tables. Invariants are documented in Docs/BUILD-PLAN.md §3.2; the ones Postgres
-- can carry are constraints here, the ones it cannot are listed at the bottom of this file.
--
-- No BEGIN/COMMIT here: the runner wraps each file in a transaction together with its
-- schema_migrations row, so applying and recording it are atomic.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- field
-- ---------------------------------------------------------------------------
CREATE TABLE field (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Normalised form dedupes "Java Utils" / "java utils " into one field.
  name_norm  text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX field_name_norm_key ON field (name_norm);

-- ---------------------------------------------------------------------------
-- topic
-- ---------------------------------------------------------------------------
CREATE TABLE topic (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  name_norm   text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  -- The candidate-generator one-liner. This is the text that gets embedded, so it
  -- is written once and never rewritten — invariant 9, enforced by trigger below.
  description text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'ready', 'empty')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Deliberately NOT unique. Polysemy means two distinct "Stack" topics must be able
-- to coexist — the v1 matching strategy accepts false splits on purpose (P4).
CREATE INDEX topic_name_norm_idx ON topic (name_norm);
CREATE INDEX topic_status_idx ON topic (status);

-- ---------------------------------------------------------------------------
-- field_topic  (junction — the structural decision the reuse design rests on)
-- ---------------------------------------------------------------------------
CREATE TABLE field_topic (
  field_id   uuid NOT NULL REFERENCES field (id) ON DELETE CASCADE,
  topic_id   uuid NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, topic_id)   -- invariant 2: re-requesting a field cannot duplicate a link
);

CREATE INDEX field_topic_topic_idx ON field_topic (topic_id);

-- ---------------------------------------------------------------------------
-- scroll
-- ---------------------------------------------------------------------------
CREATE TABLE scroll (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id       uuid NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
  content        text NOT NULL,
  -- invariant 4: a card with no provenance must not be servable.
  source_url     text NOT NULL,
  trust_label    text NOT NULL
                 CHECK (trust_label IN ('sourced_verified', 'ai_generated')),
  why_it_matters text NOT NULL,
  recall_prompt  text NOT NULL,
  recall_answer  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scroll_topic_idx ON scroll (topic_id);

-- ---------------------------------------------------------------------------
-- rejected_draft  (quarantine — never served, never promoted; invariant 10)
-- ---------------------------------------------------------------------------
CREATE TABLE rejected_draft (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    uuid NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
  content     text NOT NULL,
  reason      text NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rejected_draft_topic_idx ON rejected_draft (topic_id, rejected_at DESC);

-- ---------------------------------------------------------------------------
-- topic_generation_stats  (counters — kept forever, unlike the draft text)
-- ---------------------------------------------------------------------------
CREATE TABLE topic_generation_stats (
  topic_id         uuid PRIMARY KEY REFERENCES topic (id) ON DELETE CASCADE,
  drafts_generated integer NOT NULL DEFAULT 0 CHECK (drafts_generated >= 0),
  drafts_passed    integer NOT NULL DEFAULT 0 CHECK (drafts_passed >= 0),
  drafts_failed    integer NOT NULL DEFAULT 0 CHECK (drafts_failed >= 0),
  run_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- outbox  (written in the same transaction as its topic — invariant 11)
-- ---------------------------------------------------------------------------
CREATE TABLE outbox (
  id              bigserial PRIMARY KEY,
  topic_id        uuid NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- The worker's claim query: pending/failed rows whose backoff has elapsed.
CREATE INDEX outbox_claim_idx ON outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- account
-- ---------------------------------------------------------------------------
CREATE TABLE account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid     text NOT NULL UNIQUE,
  email            text NOT NULL,
  -- Array per the logged data-model decision. Postgres cannot foreign-key into an
  -- array, so invariant 8 (no dangling saves) is NOT enforced here — see notes below.
  saved_scroll_ids uuid[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_view  (append-only; the feed's paging mechanism)
-- ---------------------------------------------------------------------------
CREATE TABLE user_view (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  scroll_id uuid NOT NULL REFERENCES scroll (id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

-- No unique constraint on (user_id, scroll_id): revision mode re-shows a scroll,
-- and that second impression is a real event that must be recorded.
CREATE INDEX user_view_user_scroll_idx ON user_view (user_id, scroll_id);
-- Supports revision mode's "oldest viewed first" ordering.
CREATE INDEX user_view_user_time_idx ON user_view (user_id, viewed_at);

-- ===========================================================================
-- Triggers enforcing invariants that column constraints cannot express
-- ===========================================================================

-- Invariant 9 — topic.description is written once and never rewritten. Changing it
-- silently shifts every similarity score involving this topic, with no failing test.
CREATE OR REPLACE FUNCTION topic_description_is_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION
      'topic.description is immutable (invariant 9): it is the embedded text. '
      'Add a separate, unembedded column for a richer description instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topic_description_immutable
  BEFORE UPDATE ON topic
  FOR EACH ROW EXECUTE FUNCTION topic_description_is_immutable();

-- Invariant 7 — user_view is append-only. This is the one dataset that cannot be
-- reconstructed, so mutation is blocked at the database rather than by convention.
CREATE OR REPLACE FUNCTION user_view_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'user_view is append-only (invariant 7): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_view_no_update
  BEFORE UPDATE OR DELETE ON user_view
  FOR EACH ROW EXECUTE FUNCTION user_view_is_append_only();

-- Quarantine cap: keep only the most recent 5 rejections per topic. The long-term
-- trend lives in topic_generation_stats, which is never trimmed.
CREATE OR REPLACE FUNCTION rejected_draft_cap()
RETURNS trigger AS $$
BEGIN
  DELETE FROM rejected_draft
  WHERE topic_id = NEW.topic_id
    AND id NOT IN (
      SELECT id FROM rejected_draft
      WHERE topic_id = NEW.topic_id
      ORDER BY rejected_at DESC
      LIMIT 5
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rejected_draft_enforce_cap
  AFTER INSERT ON rejected_draft
  FOR EACH ROW EXECUTE FUNCTION rejected_draft_cap();

-- ===========================================================================
-- Invariants this schema does NOT enforce — the list worth keeping short
-- ===========================================================================
--
--  5. Every topic has exactly one vector in Qdrant.
--     Spans two datastores. Enforced by the outbox (invariant 11) plus the
--     reconciliation sweep. Nothing here can check it.
--
--  6. A topic with zero scrolls carries status='empty', and the LOOKUP MUST TREAT
--     'empty' AS A MISS. The CHECK constraint permits the value; only application
--     code makes the lookup respect it. This is the cached-failure bug from P10 and
--     it lives entirely in code — cover it with the test, not with hope.
--
--  8. account.saved_scroll_ids contains only live scroll IDs.
--     Postgres cannot foreign-key into an array. Deleting a scroll will leave a
--     dangling ID. See Docs/FEATURES.md open items — a saved_scroll junction table
--     would make this a real FK, at the cost of changing the logged array decision.
--
-- 11. An outbox row is written in the same transaction as its topic.
--     A CHECK cannot see across statements. This is a code-level discipline and
--     the test at implementation-plan task 4c.4 is what actually verifies it.
