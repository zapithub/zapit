-- ZAPIT Phase 6.3 — Tenant routing & shared-mode safety (S-06)
-- Run: supabase db push  or  psql $DATABASE_URL -f supabase/migrations/20261004_phase6_03_shared_routing.sql
--
-- Problem being closed:
--   · POST /webhook/whatsapp used `connection_method='shared' … .limit(1)` → arbitrary tenant.
--   · /onboarding/whatsapp copied the PLATFORM number + token into every shared tenant row,
--     so any shared tenant could be selected as "the" business for a stranger's message.
-- Fix: deterministic routing (dedicated number, sticky customer→tenant, #CODE discriminator)
--      with fail-closed behaviour for anything unmatched.

-- ── 1. Route codes — per-business discriminator shown in the dashboard ─────────────
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS wa_route_code text;

-- Backfill: shared tenants first (they are the ones that need a code), then any other row
-- missing one. Collision-safe: retries with fresh entropy; unique index is created after.
DO $$
DECLARE
  rec      record;
  cand     text;
  assigned boolean;
  i        int;
BEGIN
  FOR rec IN SELECT id FROM business_settings WHERE wa_route_code IS NULL LOOP
    assigned := false;
    FOR i IN 1..10 LOOP
      -- md5() keeps this dependency-free (no pgcrypto); uniqueness is verified below.
      cand := upper(substr(md5(rec.id::text || clock_timestamp()::text || i::text || random()::text), 1, 6));
      IF NOT EXISTS (SELECT 1 FROM business_settings WHERE wa_route_code = cand) THEN
        UPDATE business_settings SET wa_route_code = cand WHERE id = rec.id;
        assigned := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT assigned THEN
      RAISE NOTICE '[phase6.3] could not assign a route code for business_settings.id=% — reconnect in Settings to retry', rec.id;
    END IF;
  END LOOP;
END $$;

-- Store codes uppercase only; comparisons in the app are exact-match on this column.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_settings_route_code_check') THEN
    ALTER TABLE business_settings ADD CONSTRAINT business_settings_route_code_check
      CHECK (wa_route_code IS NULL OR wa_route_code ~ '^[A-Z0-9]{4,10}$');
  END IF;
END $$;

-- One business per code (the whole point of a discriminator).
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_route_code
  ON business_settings(wa_route_code) WHERE wa_route_code IS NOT NULL;

-- ── 2. Hygiene: shared tenants must not carry the platform's number/token ─────────
-- Shared rows were never really "connected" to Meta; the platform number did the work.
-- Keeping platform credentials on tenant rows is what made S-06 / W-07 dangerous.
UPDATE business_settings
   SET wa_phone_number_id = NULL, wa_access_token = NULL, wa_business_account_id = NULL
 WHERE connection_method = 'shared'
   AND (wa_phone_number_id IS NOT NULL OR wa_access_token IS NOT NULL OR wa_business_account_id IS NOT NULL);
-- If a tenant later upgrades to a dedicated number, they reconnect in Settings → WhatsApp.

-- ── 3. One dedicated number = one tenant (routing step 1 must be unambiguous) ─────
-- Created only when the table is clean; duplicates are reported instead of failing the push.
DO $$
BEGIN
  IF to_regclass('public.business_settings') IS NULL THEN
    RAISE NOTICE '[phase6.3] business_settings missing — unique index skipped';
  ELSIF EXISTS (
    SELECT 1 FROM business_settings
     WHERE connection_method = 'individual' AND wa_phone_number_id IS NOT NULL
     GROUP BY wa_phone_number_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE '[phase6.3] duplicate individual wa_phone_number_id values exist — unique index skipped; resolve and re-run';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_wa_number_individual
      ON business_settings(wa_phone_number_id)
      WHERE connection_method = 'individual' AND wa_phone_number_id IS NOT NULL;
  END IF;
END $$;

-- ── 4. Sticky routing: customer phone → tenant for the shared number (S-06) ──────
CREATE TABLE IF NOT EXISTS wa_customer_tenant (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_phone_number_id text NOT NULL,
  customer_phone           text NOT NULL,
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_phone_number_id, customer_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_customer_tenant_user
  ON wa_customer_tenant(user_id, last_seen_at DESC);
COMMENT ON TABLE wa_customer_tenant IS
  'Shared-number sticky routing: once a customer messages a tenant code, later messages route to the same tenant.';

-- ── 5. Guidance throttle: at most one "include a business code" reply per window ──
CREATE TABLE IF NOT EXISTS shared_guidance (
  platform_phone_number_id text NOT NULL,
  customer_phone           text NOT NULL,
  last_sent_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_phone_number_id, customer_phone)
);

-- ── 6. Retention: prune sticky mappings + guidance for numbers dormant > 180 days ─
CREATE OR REPLACE FUNCTION prune_wa_routing(retain_days int DEFAULT 180)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE deleted integer := 0; d integer;
BEGIN
  DELETE FROM wa_customer_tenant WHERE last_seen_at < now() - (retain_days || ' days')::interval;
  GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM shared_guidance     WHERE last_sent_at  < now() - (retain_days || ' days')::interval;
  GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  RETURN deleted;
END $$;
