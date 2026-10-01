-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 7.1 (S-07): server-side single-use OAuth state + PKCE
-- Idempotent. Apply before/with the Phase 7.1 deploy; the routes return a
-- clear 503 until it exists, they never fall back to trusting client state.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. oauth_states: opaque state handle (hashed), bound to user + platform ──
CREATE TABLE IF NOT EXISTS oauth_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      text NOT NULL,
  state_hash    text NOT NULL UNIQUE,          -- sha256(state) — the raw state never touches the DB
  code_verifier text,                          -- encrypted PKCE verifier (S256)
  redirect_uri  text,                          -- bound at connect time, re-checked on callback
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,                   -- set exactly once → replay is impossible
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user   ON oauth_states(user_id, platform, created_at DESC);

COMMENT ON TABLE oauth_states IS
  'Phase 7.1 (S-07): single-use, 10-minute OAuth state handles. Only the sha256 hash of the state is stored.';

-- ── 2. RLS: service-role only (the API uses the service key; no anonymous reads) ──
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oauth_states' AND policyname = 'oauth_states_service_only') THEN
    CREATE POLICY oauth_states_service_only ON oauth_states FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 3. Housekeeping: drop states that expired more than a day ago ─────────────
CREATE OR REPLACE FUNCTION prune_oauth_states(older_than_days int DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE deleted integer;
BEGIN
  IF to_regclass('public.oauth_states') IS NULL THEN RETURN 0; END IF;
  DELETE FROM oauth_states
   WHERE created_at < now() - make_interval(days => GREATEST(older_than_days, 0));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

-- Done. Verify:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='oauth_states' ORDER BY ordinal_position;
-- SELECT proname FROM pg_proc WHERE proname='prune_oauth_states';
