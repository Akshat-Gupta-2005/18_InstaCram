-- Account erasure: the one sanctioned exception to the append-only view log.
--
-- Before this migration, an account with any views could not be deleted:
-- account -> user_view cascades, and user_view's append-only trigger blocked the
-- cascade (verify-invariants check 9e, as it stood). Data-protection law gives
-- people a right to have their personal data erased, so this had to work.
-- See Docs/DECISIONS.md P21.
--
-- Shape: erase_account() sets a transaction-local flag, deletes the account
-- (views and saves cascade with it), clears the flag, and writes an audit row.
-- The append-only rule stays absolute everywhere else.

-- Records THAT an erasure happened and how much it removed - never whose.
-- An identifier here would defeat the erasure it records.
CREATE TABLE erasure_log (
  id            bigserial PRIMARY KEY,
  erased_at     timestamptz NOT NULL DEFAULT now(),
  views_removed integer NOT NULL CHECK (views_removed >= 0),
  saves_removed integer NOT NULL CHECK (saves_removed >= 0)
);

-- user_view: still append-only, except for view rows reached by an erasure.
-- Two conditions, both required:
--   * the erasure flag is on (set only by erase_account()), AND
--   * the delete arrives as a cascade from DELETE FROM account (trigger depth > 1).
-- The second condition means that setting the flag and then running
-- DELETE FROM user_view directly is still refused, so history can't be trimmed
-- selectively while the account survives.
CREATE OR REPLACE FUNCTION user_view_is_append_only()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('instacram.erasure', true) = 'on'
     AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'user_view is append-only (invariant 7): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Invariant 13: an account is removed only through erase_account(), so every
-- removal is audited. A raw DELETE FROM account is rejected even when the account
-- has no views.
CREATE OR REPLACE FUNCTION account_delete_requires_erasure()
RETURNS trigger AS $$
BEGIN
  IF current_setting('instacram.erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'accounts are removed only via erase_account(), which records the erasure (invariant 13)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_no_raw_delete
  BEFORE DELETE ON account
  FOR EACH ROW EXECUTE FUNCTION account_delete_requires_erasure();

CREATE OR REPLACE FUNCTION erase_account(p_account_id uuid)
RETURNS void AS $$
DECLARE
  v_views integer;
  v_saves integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'erase_account: no account %', p_account_id;
  END IF;

  SELECT count(*) INTO v_views FROM user_view    WHERE user_id    = p_account_id;
  SELECT count(*) INTO v_saves FROM saved_scroll WHERE account_id = p_account_id;

  -- Flag on for exactly one statement. is_local = true scopes it to this
  -- transaction even if the reset below were somehow skipped.
  PERFORM set_config('instacram.erasure', 'on', true);
  DELETE FROM account WHERE id = p_account_id;
  PERFORM set_config('instacram.erasure', 'off', true);

  INSERT INTO erasure_log (views_removed, saves_removed) VALUES (v_views, v_saves);
END;
$$ LANGUAGE plpgsql;

-- Residual, logged rather than solved: these rules guard against mistakes, not
-- against a compromised application. Anything able to call set_config() can set
-- the flag. Full enforcement means running the service under a role without
-- DELETE on account/user_view and making erase_account() SECURITY DEFINER;
-- that is W7 infrastructure work (Docs/IMPLEMENTATION-PLAN.md).
