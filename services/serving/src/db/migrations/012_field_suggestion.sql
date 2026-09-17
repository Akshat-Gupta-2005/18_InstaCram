-- Task 5.7: related fields suggested by the model, for when topic overlap is thin.
--
-- Generated in the BACKGROUND and stored (DECISIONS 2026-09-17). Measured, one
-- suggestion call takes ~8s on an idle GPU and ~57s while the pipeline is
-- generating - which is normal, not rare - so calling it while building the
-- end-of-field card would stall exactly the request a user sees when they finish.
-- Stored, it costs one call per field instead of one per visit, and the list does
-- not reshuffle between visits: three identical calls returned three different
-- lists.
CREATE TABLE field_suggestion (
  field_id   uuid NOT NULL REFERENCES field (id) ON DELETE CASCADE,
  name       text NOT NULL,
  name_norm  text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  -- The model's order, which is its own ranking of relevance.
  position   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, name_norm)
);

-- When suggestions were generated for the field. NULL means not yet, which is
-- different from "generated, and the model had none": only the first should be
-- retried by a later expansion.
ALTER TABLE field ADD COLUMN suggestions_at timestamptz;
