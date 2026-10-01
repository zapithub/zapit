-- ZAPIT Phase 6.2 — WhatsApp webhook authenticity & replay safety (S-05)
-- Run: supabase db push  or  psql $DATABASE_URL -f supabase/migrations/20261003_phase6_02_wa_webhook.sql
-- App layer (index.js + src/utils/webhook.js) verifies X-Hub-Signature-256 over the
-- raw body; this migration adds the DB-layer replay/idempotency guarantees.

-- ── 1. Defense-in-depth: a WhatsApp message id must be unique per inbound message ──
-- The application claims each wamid in webhook_events before processing; this unique
-- index additionally makes duplicate message rows impossible if a claim used a
-- different retry path. Created ONLY when the table is clean, so a legacy duplicate
-- cannot break the migration — dedupe first, then re-run.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE '[phase6.2] messages table not found — unique index skipped';
  ELSIF EXISTS (
    SELECT 1 FROM messages
    WHERE whatsapp_message_id IS NOT NULL
    GROUP BY whatsapp_message_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE '[phase6.2] duplicate whatsapp_message_id values exist — unique index skipped; dedupe and re-run';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_message_id_unique
      ON messages(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
  END IF;
END $$;

-- ── 2. webhook_events: fast dedup lookup + retention support ──────────────────────
DO $$
BEGIN
  IF to_regclass('public.webhook_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_time
      ON webhook_events(provider, received_at DESC);
  ELSE
    RAISE NOTICE '[phase6.2] webhook_events table not found — index skipped';
  END IF;
END $$;

-- ── 3. Retention helper — call from cron: SELECT prune_webhook_events(30); ────────
CREATE OR REPLACE FUNCTION prune_webhook_events(retain_days int DEFAULT 30)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE deleted integer;
BEGIN
  DELETE FROM webhook_events WHERE received_at < now() - (retain_days || ' days')::interval;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

COMMENT ON TABLE webhook_events IS
  'Idempotency/replay protection. WhatsApp: event_id = wamid; Paystack: event_id = reference. Prune with prune_webhook_events(30).';
