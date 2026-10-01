-- ZAPIT Phase 6.4 — Billing guardrails (B-01, B-02, B-04, B-07)
-- Run: supabase db push  or  psql $DATABASE_URL -f supabase/migrations/20261005_phase6_04_billing_guardrails.sql
--
-- Closes:
--   · B-01  reactivate no longer grants free 30 days (app layer; state columns added here)
--   · B-02  cancel keeps access until period end via cancel_at (cron downgrades at expires_at)
--   · B-04  immutable transactions ledger (unique reference) is the revenue/invoice source
--   · B-07  privileged plan grants are bounded (1–365 days) and written to admin_audit_log.details

-- ── 1. Subscription cancellation / renewal state ──────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE NOTICE '[phase6.4] subscriptions table not found — columns skipped';
  ELSE
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at    timestamptz;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
    -- the expiry cron scans exactly this predicate
    CREATE INDEX IF NOT EXISTS idx_subscriptions_active_expiry
      ON subscriptions(expires_at) WHERE status = 'active';
    RAISE NOTICE '[phase6.4] subscriptions.cancel_at / cancelled_at ready';
  END IF;
END $$;

-- Normalise legacy rows: an active subscription must never keep a stale cancel_at.
DO $$ BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    UPDATE subscriptions SET cancel_at = NULL
     WHERE status = 'active' AND cancel_at IS NOT NULL
       AND (expires_at IS NULL OR cancel_at > expires_at);
  END IF;
END $$;

-- ── 2. Transactions ledger hardening (B-04) ──────────────────────────────────
-- The table is created in 20261001_phase4_hardening.sql with UNIQUE(paystack_reference).
-- Re-assert the constraint for databases that predate it, guarded to avoid duplicates.
DO $$ BEGIN
  IF to_regclass('public.transactions') IS NULL THEN
    RAISE NOTICE '[phase6.4] transactions table not found — skipped';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_paystack_reference_key') THEN
      BEGIN
        ALTER TABLE transactions ADD CONSTRAINT transactions_paystack_reference_key UNIQUE (paystack_reference);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN
        RAISE NOTICE '[phase6.4] transactions unique constraint already exists';
      END;
    END IF;
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
    -- append-only: recorded payments are never edited (DELETE stays available for
    -- retention/GDPR erasure jobs). Uses $fn$ so it can nest inside DO $$ … $$.
    CREATE OR REPLACE FUNCTION transactions_immutable()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'transactions rows are append-only (B-04)';
      END IF;
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions;
    CREATE TRIGGER trg_transactions_immutable
      BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION transactions_immutable();
    RAISE NOTICE '[phase6.4] transactions ledger guarded';
  END IF;
END $$;

-- ── 3. Admin audit details for privileged plan grants (B-07) ─────────────────
DO $$ BEGIN
  IF to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE NOTICE '[phase6.4] admin_audit_log table not found — run 20261002 first';
  ELSE
    ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS details jsonb;
    CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at DESC);
  END IF;
END $$;
