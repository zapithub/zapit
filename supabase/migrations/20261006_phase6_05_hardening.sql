-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 6.5 hardening (S-15 OTP lockout, S-16 allow-lists)
-- Idempotent. Apply before/with the Phase 6.5 deploy.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. OTP attempt lockout (S-15) ───────────────────────────────
-- Codes are stored hashed; `attempts` counts wrong guesses for the newest
-- live code so it can be locked after OTP_MAX_ATTEMPTS (5) and replaced.
DO $$ BEGIN
  IF to_regclass('public.otp_verifications') IS NOT NULL THEN
    ALTER TABLE otp_verifications ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
    ALTER TABLE otp_verifications ADD COLUMN IF NOT EXISTS ip_address text;

    -- newest-code lookup on every verify
    CREATE INDEX IF NOT EXISTS idx_otp_email_type
      ON otp_verifications(email, type, created_at DESC);
    -- live (unused) code lookup
    CREATE INDEX IF NOT EXISTS idx_otp_live
      ON otp_verifications(email, type, expires_at) WHERE verified = false;
  END IF;
END $$;

-- Retention helper for the ops cron (expired codes carry no value).
CREATE OR REPLACE FUNCTION prune_otp_verifications(older_than_days int DEFAULT 7)
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE removed integer;
BEGIN
  IF to_regclass('public.otp_verifications') IS NULL THEN RETURN 0; END IF;
  DELETE FROM otp_verifications
   WHERE created_at < now() - (older_than_days || ' days')::interval
     AND (expires_at < now() OR verified = true);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $fn$;
