-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 7.2 (S-08): hashed, rotating, revocable sessions
-- Idempotent. The API falls back to the legacy raw columns when this is not
-- applied yet, so it is safe to deploy first and push immediately after.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. New session columns ───────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS access_token_hash   text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refresh_token_hash  text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS access_jti          text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refresh_jti         text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS family_id           uuid;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refresh_expires_at  timestamptz;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rotated_at          timestamptz;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at          timestamptz;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason      text;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS replaced_by_hash    text;
  ELSE
    RAISE NOTICE 'sessions table missing — create it before applying 20261008';
  END IF;
END $$;

-- ── 2. Lookups used on every authenticated request / refresh ─────
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_hash
  ON sessions(access_token_hash) WHERE access_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_hash
  ON sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_jti ON sessions(refresh_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_family      ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_live        ON sessions(user_id) WHERE revoked_at IS NULL;

COMMENT ON COLUMN sessions.access_token_hash  IS 'Phase 7.2 (S-08): sha256 of the access token — raw tokens are never stored';
COMMENT ON COLUMN sessions.refresh_token_hash IS 'Phase 7.2 (S-08): sha256 of the current refresh token';
COMMENT ON COLUMN sessions.family_id          IS 'Phase 7.2 (S-08): session family; reuse of a rotated token revokes the whole family';

-- ── 3. Backfill + purge the raw secrets that pre-7.2 rows carry ──
-- Hashes must match Node''s sha256 hex, so use pgcrypto when available.
DO $$ BEGIN
  IF to_regclass('public.sessions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='token')
  THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      UPDATE sessions SET access_token_hash  = encode(digest(token, 'sha256'), 'hex')
        WHERE access_token_hash IS NULL AND token IS NOT NULL;
      UPDATE sessions SET refresh_token_hash = encode(digest(refresh_token, 'sha256'), 'hex')
        WHERE refresh_token_hash IS NULL AND refresh_token IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'session hash backfill skipped (%): legacy rows keep working until they expire', SQLERRM;
    END;

    -- Raw secrets only disappear once their hashes exist.
    BEGIN
      ALTER TABLE sessions ALTER COLUMN token         DROP NOT NULL;
      ALTER TABLE sessions ALTER COLUMN refresh_token DROP NOT NULL;
      UPDATE sessions SET token = NULL, refresh_token = NULL
        WHERE access_token_hash IS NOT NULL AND refresh_token_hash IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'legacy token purge skipped (%)', SQLERRM;
    END;
  END IF;
END $$;

-- ── 4. Housekeeping: drop dead sessions after the refresh window ─
CREATE OR REPLACE FUNCTION prune_sessions(older_than_days int DEFAULT 45)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE deleted integer;
BEGIN
  IF to_regclass('public.sessions') IS NULL THEN RETURN 0; END IF;
  DELETE FROM sessions
   WHERE created_at < now() - make_interval(days => GREATEST(older_than_days, 1));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

-- Done. Verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name='sessions' ORDER BY ordinal_position;
-- SELECT count(*) FILTER (WHERE access_token_hash IS NOT NULL) AS hashed,
--        count(*) FILTER (WHERE token IS NOT NULL) AS legacy FROM sessions;
