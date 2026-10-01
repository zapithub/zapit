-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 8.1 (W-02/W-04): inbound conversation state
-- Idempotent. Adds the columns the webhook needs to behave correctly when a
-- single Meta delivery carries several messages:
--   · welcome exactly once per contact (welcomed_at — the old code re-read a
--     stale row and welcomed message #2 again)
--   · a real opt-out record (timestamp + reason, alongside the existing flag)
--   · human takeover (the bot stops answering while the business handles it)
-- The API tolerates this migration not being applied yet: missing columns are
-- detected and retried without them (same pattern as Phase 7.2 sessions).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Contacts: welcome marker + opt-out record ─────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS welcomed_at     timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at    timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_out_reason  text;

COMMENT ON COLUMN contacts.welcomed_at IS
  'Phase 8.1 (W-02): set the first time the welcome message is sent — exactly once per contact.';
COMMENT ON COLUMN contacts.opted_out_at IS
  'Phase 8.1 (W-04): when the customer sent STOP/UNSUBSCRIBE. opted_out stays the canonical flag.';

CREATE INDEX IF NOT EXISTS idx_contacts_user_opted_out ON contacts(user_id, opted_out);

-- ── 2. Conversations: human takeover ─────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_takeover  boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz;

COMMENT ON COLUMN conversations.human_takeover IS
  'Phase 8.1 (W-04): true while the business is answering this conversation by hand; the bot stays silent.';
COMMENT ON COLUMN conversations.bot_paused_until IS
  'Phase 8.1 (W-04): the bot also stays silent until this timestamp after a manual reply.';

CREATE INDEX IF NOT EXISTS idx_conversations_paused ON conversations(user_id, bot_paused_until)
  WHERE bot_paused_until IS NOT NULL;

-- ── 3. Message lookup for the inbox ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_wa_id      ON messages(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_convo_time ON messages(conversation_id, created_at DESC);

-- Done. Verify:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name IN ('contacts','conversations')
--    AND column_name IN ('welcomed_at','opted_out_at','opt_out_reason','human_takeover','bot_paused_until');
