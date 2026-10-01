-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 8.2 (W-01): the in-chat order + payment loop
-- Idempotent. The API could already list/confirm/cancel orders, but nothing
-- ever *created* one from a conversation and a tenant's Paystack secret key was
-- never used. This adds the storage the loop needs — additive only, so existing
-- rows and code keep working, and the API degrades if this is not applied yet.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Orders: what was ordered, where it goes, how it is paid ───
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items                jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address     text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee         numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider     text;      -- paystack | bank_transfer | manual
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference    text;      -- our reference / gateway reference
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link         text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_currency     text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount       numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount_minor bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_requested_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_response     jsonb;     -- last verified gateway payload (trimmed)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source               text DEFAULT 'dashboard'; -- whatsapp | dashboard | import
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at           timestamptz;

COMMENT ON COLUMN orders.payment_reference IS
  'Phase 8.2 (W-01): Paystack reference (or the bank-transfer reference) the payment must match.';
COMMENT ON COLUMN orders.source IS
  'Phase 8.2 (W-01): where the order came from — whatsapp for the in-chat loop.';

-- One reference may only ever belong to one order (a duplicate initialize can
-- not create a second payable order for the same payment).
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_reference
  ON orders(payment_reference) WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_payment ON orders(user_id, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(user_id, customer_phone);

-- ── 2. Drafts: multi-turn capture (product → quantity → address) ──
CREATE TABLE IF NOT EXISTS order_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id       uuid,
  conversation_id  uuid,
  product_id       uuid,
  product_name     text,
  unit_price       numeric,
  currency         text,
  quantity         integer,
  delivery_address text,
  items            jsonb,
  turns            integer NOT NULL DEFAULT 0,
  last_message     text,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '6 hours'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

COMMENT ON TABLE order_drafts IS
  'Phase 8.2 (W-01): in-flight WhatsApp order capture — one row per (business, contact), replaced by an orders row when complete.';

CREATE INDEX IF NOT EXISTS idx_order_drafts_expiry ON order_drafts(expires_at);
CREATE INDEX IF NOT EXISTS idx_order_drafts_user   ON order_drafts(user_id, updated_at DESC);

ALTER TABLE order_drafts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_drafts' AND policyname = 'order_drafts_service_only') THEN
    CREATE POLICY order_drafts_service_only ON order_drafts FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 3. Housekeeping ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_order_drafts(older_than_days int DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE deleted integer;
BEGIN
  IF to_regclass('public.order_drafts') IS NULL THEN RETURN 0; END IF;
  DELETE FROM order_drafts
   WHERE updated_at < now() - make_interval(days => GREATEST(older_than_days, 1));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

-- Done. Verify:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'orders' AND column_name LIKE 'payment%';
-- SELECT * FROM order_drafts LIMIT 1;
-- SELECT prune_order_drafts(7);
