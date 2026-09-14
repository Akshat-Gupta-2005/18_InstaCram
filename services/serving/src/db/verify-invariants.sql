-- Invariant verification for 001_init.sql.
-- Tries to break every invariant the schema claims to enforce, and reports PASS/FAIL
-- per check via NOTICE. Runs inside a transaction that is rolled back, so it leaves
-- the database untouched. Run: psql -f verify-invariants.sql
-- Deliberately ASCII-only so it survives any shell's encoding.

BEGIN;

-- Fixtures ------------------------------------------------------------------
INSERT INTO field (id, name) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'Java Utils');
INSERT INTO topic (id, name, description) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'HashMap', 'Hash-table map with average constant-time lookup.');
INSERT INTO scroll (id, topic_id, content, source_url, trust_label, why_it_matters, recall_prompt, recall_answer)
VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000a001',
        'content', 'https://example.org', 'sourced_verified', 'why', 'q', 'a');
INSERT INTO account (id, firebase_uid, email) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'uid-1', 'u@example.org');

-- 1. field names dedupe by normalised form --------------------------------
DO $$ BEGIN
  INSERT INTO field (name) VALUES ('  java utils ');
  RAISE NOTICE 'FAIL 1: "  java utils " was accepted as a second field';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS 1: field names dedupe case- and whitespace-insensitively';
END $$;

-- 2. topic names are NOT unique (polysemy must be representable, P4) -------
DO $$ BEGIN
  INSERT INTO topic (name, description) VALUES ('Stack', 'LIFO data structure supporting push and pop.');
  INSERT INTO topic (name, description) VALUES ('Stack', 'Set of technologies used together to build an application.');
  RAISE NOTICE 'PASS 2: two distinct "Stack" topics coexist';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'FAIL 2: duplicate topic names rejected - polysemy is unrepresentable';
END $$;

-- 3. field_topic link cannot be duplicated (invariant 2) ------------------
DO $$ BEGIN
  INSERT INTO field_topic VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000a001');
  INSERT INTO field_topic VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000a001');
  RAISE NOTICE 'FAIL 3: duplicate field_topic link accepted';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS 3: duplicate field_topic link rejected';
END $$;

-- 4a. scroll without provenance is rejected (invariant 4) ----------------
DO $$ BEGIN
  INSERT INTO scroll (topic_id, content, source_url, trust_label, why_it_matters, recall_prompt, recall_answer)
  VALUES ('00000000-0000-0000-0000-00000000a001', 'c', NULL, 'ai_generated', 'w', 'q', 'a');
  RAISE NOTICE 'FAIL 4a: scroll with NULL source_url accepted';
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'PASS 4a: scroll with NULL source_url rejected';
END $$;

-- 4b. trust_label outside the value set is rejected -----------------------
DO $$ BEGIN
  INSERT INTO scroll (topic_id, content, source_url, trust_label, why_it_matters, recall_prompt, recall_answer)
  VALUES ('00000000-0000-0000-0000-00000000a001', 'c', 'https://x', 'totally_true', 'w', 'q', 'a');
  RAISE NOTICE 'FAIL 4b: unknown trust_label accepted';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 4b: unknown trust_label rejected';
END $$;

-- 5. topic.status is constrained -----------------------------------------
DO $$ BEGIN
  UPDATE topic SET status = 'broken' WHERE id = '00000000-0000-0000-0000-00000000a001';
  RAISE NOTICE 'FAIL 5: invalid topic.status accepted';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 5: invalid topic.status rejected';
END $$;

-- 6a. topic.description is immutable (invariant 9) ------------------------
DO $$ BEGIN
  UPDATE topic SET description = 'An improved description.' WHERE id = '00000000-0000-0000-0000-00000000a001';
  RAISE NOTICE 'FAIL 6a: topic.description was rewritten';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'PASS 6a: topic.description rewrite blocked';
END $$;

-- 6b. ...but other topic columns still update normally --------------------
DO $$ BEGIN
  UPDATE topic SET status = 'ready' WHERE id = '00000000-0000-0000-0000-00000000a001';
  RAISE NOTICE 'PASS 6b: topic.status still updatable alongside the immutability trigger';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL 6b: status update blocked too (%)', SQLERRM;
END $$;

-- 7a. user_view accepts repeat impressions (revision mode) ----------------
DO $$ BEGIN
  INSERT INTO user_view (user_id, scroll_id) VALUES
    ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001'),
    ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001');
  RAISE NOTICE 'PASS 7a: repeat impressions recorded as separate rows';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'FAIL 7a: repeat impression rejected - revision mode cannot log views';
END $$;

-- 7b. user_view is append-only: UPDATE blocked (invariant 7) ---------------
DO $$ BEGIN
  UPDATE user_view SET viewed_at = now() - interval '1 day';
  RAISE NOTICE 'FAIL 7b: user_view row was updated';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'PASS 7b: user_view UPDATE blocked';
END $$;

-- 7c. user_view is append-only: DELETE blocked ----------------------------
DO $$ BEGIN
  DELETE FROM user_view;
  RAISE NOTICE 'FAIL 7c: user_view row was deleted';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'PASS 7c: user_view DELETE blocked';
END $$;

-- 8a. cap keeps the newest 20 when timestamps are distinct -----------------
DO $$
DECLARE n int; oldest text;
BEGIN
  FOR i IN 1..22 LOOP
    INSERT INTO rejected_draft (topic_id, content, reason, rejected_at)
    VALUES ('00000000-0000-0000-0000-00000000a001', 'd' || lpad(i::text, 2, '0'), 'r',
            timestamptz '2026-01-01' + i * interval '1 minute');
  END LOOP;
  SELECT count(*), min(content) INTO n, oldest
  FROM rejected_draft WHERE topic_id = '00000000-0000-0000-0000-00000000a001';
  IF n = 20 AND oldest = 'd03' THEN
    RAISE NOTICE 'PASS 8a: cap keeps the newest 20 of 22 (oldest kept %)', oldest;
  ELSE
    RAISE NOTICE 'FAIL 8a: expected 20 rows from d03, got % rows from %', n, oldest;
  END IF;
  DELETE FROM rejected_draft WHERE topic_id = '00000000-0000-0000-0000-00000000a001';
END $$;

-- 8b. a realistic v1 run is retained in full ------------------------------
-- The card generator writes at most 4 drafts, and in v1 a topic is generated once,
-- so a topic never exceeds 4 rejections. They share one transaction timestamp; with
-- the cap far above 4 the tie never decides anything.
DO $$
DECLARE n int;
BEGIN
  FOR i IN 1..4 LOOP
    INSERT INTO rejected_draft (topic_id, content, reason)
    VALUES ('00000000-0000-0000-0000-00000000a001', 'run-' || i, 'r');
  END LOOP;
  SELECT count(*) INTO n FROM rejected_draft WHERE topic_id = '00000000-0000-0000-0000-00000000a001';
  IF n = 4 THEN
    RAISE NOTICE 'PASS 8b: a full 4-draft run is retained despite tied timestamps';
  ELSE
    RAISE NOTICE 'FAIL 8b: expected 4 rows, got %', n;
  END IF;
  DELETE FROM rejected_draft WHERE topic_id = '00000000-0000-0000-0000-00000000a001';
END $$;

-- 8c. a newer run always beats an older one, even with ties inside each run -
-- The property the cap actually needs. 15 tied rows at T1, then 10 tied rows at T2:
-- all 10 of the newer run must survive. Which 10 of the older run's 15 survive is
-- decided by the tie, and is deliberately NOT asserted - see P14.
DO $$
DECLARE n int; newer int;
BEGIN
  FOR i IN 1..15 LOOP
    INSERT INTO rejected_draft (topic_id, content, reason, rejected_at)
    VALUES ('00000000-0000-0000-0000-00000000a001', 'old-' || i, 'r', timestamptz '2026-01-01');
  END LOOP;
  FOR i IN 1..10 LOOP
    INSERT INTO rejected_draft (topic_id, content, reason, rejected_at)
    VALUES ('00000000-0000-0000-0000-00000000a001', 'new-' || i, 'r', timestamptz '2026-01-02');
  END LOOP;
  SELECT count(*), count(*) FILTER (WHERE content LIKE 'new-%') INTO n, newer
  FROM rejected_draft WHERE topic_id = '00000000-0000-0000-0000-00000000a001';
  IF n = 20 AND newer = 10 THEN
    RAISE NOTICE 'PASS 8c: all 10 rows of the newer run survive; 20 kept in total';
  ELSE
    RAISE NOTICE 'FAIL 8c: expected 20 rows incl. 10 newer, got % incl. %', n, newer;
  END IF;
END $$;

-- 9a. a save must reference a real scroll (invariant 8, enforced since 004) -
DO $$ BEGIN
  INSERT INTO saved_scroll (account_id, scroll_id)
  VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000dead1');
  RAISE NOTICE 'FAIL 9a: save of a nonexistent scroll accepted';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'PASS 9a: save of a nonexistent scroll rejected';
END $$;

-- 9b. saving the same scroll twice is rejected (makes PUT idempotent) --------
DO $$ BEGIN
  INSERT INTO saved_scroll (account_id, scroll_id)
  VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001');
  INSERT INTO saved_scroll (account_id, scroll_id)
  VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001');
  RAISE NOTICE 'FAIL 9b: duplicate save accepted';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS 9b: duplicate save rejected';
END $$;

-- 9c. no scroll can be hard-deleted, viewed or not (invariant 12, since 005) -
DO $$ BEGIN
  INSERT INTO scroll (id, topic_id, content, source_url, trust_label, why_it_matters, recall_prompt, recall_answer)
  VALUES ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000a001',
          'c', 'https://example.org', 'ai_generated', 'w', 'q', 'a');
  DELETE FROM scroll WHERE id = '00000000-0000-0000-0000-00000000c002';
  RAISE NOTICE 'FAIL 9c: an unviewed scroll was hard-deleted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE '%retired, never deleted%' THEN
    RAISE NOTICE 'PASS 9c: scroll delete rejected with the retire instruction';
  ELSE
    RAISE NOTICE 'FAIL 9c: scroll delete rejected, but by the wrong rule (%)', SQLERRM;
  END IF;
END $$;

-- 9d. retiring hides a scroll from live_scroll but keeps its views and saves -
-- Scroll c001 has view rows from check 7a. (9b's save of it was rolled back with
-- that block's exception, so save it again here.)
DO $$
DECLARE live int; views int; saves int;
BEGIN
  INSERT INTO saved_scroll (account_id, scroll_id)
  VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001');
  UPDATE scroll SET retired_at = now() WHERE id = '00000000-0000-0000-0000-00000000c001';
  SELECT count(*) INTO live  FROM live_scroll  WHERE id = '00000000-0000-0000-0000-00000000c001';
  SELECT count(*) INTO views FROM user_view    WHERE scroll_id = '00000000-0000-0000-0000-00000000c001';
  SELECT count(*) INTO saves FROM saved_scroll WHERE scroll_id = '00000000-0000-0000-0000-00000000c001';
  IF live = 0 AND views > 0 AND saves > 0 THEN
    RAISE NOTICE 'PASS 9d: retired scroll is gone from live_scroll; its % view(s) and % save(s) survive', views, saves;
  ELSE
    RAISE NOTICE 'FAIL 9d: expected live=0, views>0, saves>0 - got live=%, views=%, saves=%', live, views, saves;
  END IF;
END $$;

-- 10. account erasure (invariant 13, since 006) ------------------------------
-- State at this point: account e001 has 2 views (7a) and 1 save (9d).
-- A second account, e002, gets 1 view, to prove an erasure touches only its target.
INSERT INTO account (id, firebase_uid, email) VALUES
  ('00000000-0000-0000-0000-00000000e002', 'uid-2', 'v@example.org');
INSERT INTO user_view (user_id, scroll_id) VALUES
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000c001');

-- 10b. a raw account delete is rejected - it would bypass the audit ---------
DO $$ BEGIN
  DELETE FROM account WHERE id = '00000000-0000-0000-0000-00000000e002';
  RAISE NOTICE 'FAIL 10b: raw account delete bypassed erase_account()';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE '%erase_account()%' THEN
    RAISE NOTICE 'PASS 10b: raw account delete rejected - removal must go through erase_account()';
  ELSE
    RAISE NOTICE 'FAIL 10b: rejected, but by the wrong rule (%)', SQLERRM;
  END IF;
END $$;

-- 10c. the flag alone cannot be used to trim view history directly ----------
DO $$ BEGIN
  PERFORM set_config('instacram.erasure', 'on', true);
  DELETE FROM user_view WHERE user_id = '00000000-0000-0000-0000-00000000e002';
  RAISE NOTICE 'FAIL 10c: view rows deleted directly with the erasure flag set';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'PASS 10c: direct view delete refused even with the erasure flag on';
END $$;
DO $$ BEGIN PERFORM set_config('instacram.erasure', 'off', true); END $$;

-- 10a. erase_account removes the account with its views and saves, audited --
DO $$
DECLARE acct int; views int; saves int; v_logged int; s_logged int; idcols int;
BEGIN
  PERFORM erase_account('00000000-0000-0000-0000-00000000e001');
  SELECT count(*) INTO acct  FROM account      WHERE id = '00000000-0000-0000-0000-00000000e001';
  SELECT count(*) INTO views FROM user_view    WHERE user_id = '00000000-0000-0000-0000-00000000e001';
  SELECT count(*) INTO saves FROM saved_scroll WHERE account_id = '00000000-0000-0000-0000-00000000e001';
  SELECT views_removed, saves_removed INTO v_logged, s_logged FROM erasure_log ORDER BY id DESC LIMIT 1;
  SELECT count(*) INTO idcols FROM information_schema.columns
  WHERE table_name = 'erasure_log'
    AND (column_name LIKE '%account%' OR column_name LIKE '%user%' OR column_name LIKE '%email%');
  IF acct = 0 AND views = 0 AND saves = 0 AND v_logged = 2 AND s_logged = 1 AND idcols = 0 THEN
    RAISE NOTICE 'PASS 10a: erase_account removed the account, its 2 views and 1 save, and logged counts with no identifier';
  ELSE
    RAISE NOTICE 'FAIL 10a: account=% views=% saves=% logged=(%,%) identifier-columns=%',
      acct, views, saves, v_logged, s_logged, idcols;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL 10a: erase_account raised (%)', SQLERRM;
END $$;

-- 10d. other accounts are untouched, and the flag is off again ---------------
DO $$
DECLARE others int; flag text;
BEGIN
  SELECT count(*) INTO others FROM user_view WHERE user_id = '00000000-0000-0000-0000-00000000e002';
  flag := current_setting('instacram.erasure', true);
  IF others = 1 AND flag = 'off' THEN
    RAISE NOTICE 'PASS 10d: the other account keeps its history, and the erasure flag is off again';
  ELSE
    RAISE NOTICE 'FAIL 10d: other account views=% (expected 1), flag=% (expected off)', others, flag;
  END IF;
END $$;

ROLLBACK;
