-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 8.3 (W-03): templates + broadcast runs
-- Idempotent, additive. WhatsApp only accepts free-form messages inside the
-- 24h window that follows a customer's last inbound message; outside it the
-- business must send an approved template. Broadcasts also carried a
-- `scheduled_for` that nothing ever executed.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Templates a business can broadcast with ───────────────────
CREATE TABLE IF NOT EXISTS wa_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,                     -- e.g. promo_october
  language    text NOT NULL DEFAULT 'en',
  category    text NOT NULL DEFAULT 'marketing',
  body        text NOT NULL,                     -- our record of the approved copy
  variables   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'approved',  -- approved | pending | rejected
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, language)
);

COMMENT ON TABLE wa_templates IS
  'Phase 8.3 (W-03): WhatsApp message templates used for broadcasts outside the 24h service window.';

CREATE INDEX IF NOT EXISTS idx_wa_templates_user ON wa_templates(user_id, name);

ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wa_templates' AND policyname = 'wa_templates_service_only') THEN
    CREATE POLICY wa_templates_service_only ON wa_templates FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 2. Broadcast runs: which template, what happened, when ───────
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS template_id     uuid;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS failed_count    integer DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS skipped_count   integer DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS results         jsonb;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS started_at      timestamptz;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS updated_at      timestamptz;

COMMENT ON COLUMN broadcasts.template_id IS
  'Phase 8.3 (W-03): template used for recipients outside the 24h window (null = free text only).';
COMMENT ON COLUMN broadcasts.results IS
  'Phase 8.3 (W-03): per-run outcome — counts by mode plus the skip reasons.';

-- The broadcaster cron scans exactly this pair.
CREATE INDEX IF NOT EXISTS idx_broadcasts_due
  ON broadcasts(status, scheduled_for) WHERE status IN ('scheduled', 'sending');

-- ── 3. Housekeeping ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_wa_templates_unused(older_than_days int DEFAULT 365)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE deleted integer;
BEGIN
  IF to_regclass('public.wa_templates') IS NULL THEN RETURN 0; END IF;
  DELETE FROM wa_templates t
   WHERE t.updated_at < now() - make_interval(days => GREATEST(older_than_days, 30))
     AND NOT EXISTS (SELECT 1 FROM broadcasts b WHERE b.template_id = t.id);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

-- Done. Verify:
-- SELECT name, language, status FROM wa_templates LIMIT 5;
-- SELECT status, scheduled_for, template_id FROM broadcasts WHERE status = 'scheduled';
-- SELECT prune_wa_templates_unused(365);
