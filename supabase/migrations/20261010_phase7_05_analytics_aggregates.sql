-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 7.5 (D-05): analytics aggregates that cannot truncate
-- Idempotent. PostgREST caps one response at 1,000 rows; every analytics
-- number that was computed by reading rows client-side could therefore be a
-- silent undercount (revenue, orders, content types, contact segments, ledger).
-- These functions aggregate in Postgres: one call, exact, cheap. The API still
-- works before this migration (it pages every row instead) — see
-- src/utils/analytics.js.
--
-- Multi-currency (B-05): totals are grouped by currency; different currencies
-- are never summed into one meaningless number.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Orders per currency (overview / whatsapp / revenue totals) ──
CREATE OR REPLACE FUNCTION analytics_revenue_by_currency(
  p_user_id uuid,
  p_since   timestamptz DEFAULT NULL
)
RETURNS TABLE(currency text, orders_count bigint, paid_count bigint, revenue numeric)
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(NULLIF(upper(o.currency), ''), 'NGN')                            AS currency,
         count(*)::bigint                                                          AS orders_count,
         (count(*) FILTER (WHERE o.payment_status = 'paid'))::bigint               AS paid_count,
         COALESCE((sum(o.total) FILTER (WHERE o.payment_status = 'paid')), 0)::numeric AS revenue
    FROM orders o
   WHERE o.user_id = p_user_id
     AND (p_since IS NULL OR o.created_at >= p_since)
   GROUP BY 1
   ORDER BY 4 DESC, 1;
$fn$;

-- ── 2. Paid revenue per day, for one currency (revenue chart) ─────
CREATE OR REPLACE FUNCTION analytics_revenue_by_day(
  p_user_id  uuid,
  p_since    timestamptz DEFAULT NULL,
  p_currency text        DEFAULT NULL
)
RETURNS TABLE(day date, revenue numeric, paid_count bigint)
LANGUAGE sql
STABLE
AS $fn$
  SELECT (o.created_at AT TIME ZONE 'UTC')::date  AS day,
         COALESCE(sum(o.total), 0)::numeric       AS revenue,
         count(*)::bigint                         AS paid_count
    FROM orders o
   WHERE o.user_id = p_user_id
     AND o.payment_status = 'paid'
     AND (p_since IS NULL OR o.created_at >= p_since)
     AND (p_currency IS NULL OR upper(COALESCE(o.currency, 'NGN')) = upper(p_currency))
   GROUP BY 1
   ORDER BY 1;
$fn$;

-- ── 3. Generated content by type ─────────────────────────────────
CREATE OR REPLACE FUNCTION analytics_content_by_type(
  p_user_id uuid,
  p_since   timestamptz DEFAULT NULL
)
RETURNS TABLE(type text, item_count bigint)
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(NULLIF(c.type, ''), 'unknown') AS type,
         count(*)::bigint                        AS item_count
    FROM content_items c
   WHERE c.user_id = p_user_id
     AND (p_since IS NULL OR c.created_at >= p_since)
   GROUP BY 1
   ORDER BY 2 DESC, 1;
$fn$;

-- ── 4. Contacts by segment ───────────────────────────────────────
CREATE OR REPLACE FUNCTION analytics_contacts_by_segment(p_user_id uuid)
RETURNS TABLE(segment text, contact_count bigint)
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(NULLIF(c.segment, ''), 'lead') AS segment,
         count(*)::bigint                         AS contact_count
    FROM contacts c
   WHERE c.user_id = p_user_id
   GROUP BY 1
   ORDER BY 2 DESC, 1;
$fn$;

-- ── 5. Subscription ledger totals by plan + currency (admin) ─────
CREATE OR REPLACE FUNCTION analytics_ledger_totals()
RETURNS TABLE(plan text, currency text, payments bigint, amount numeric)
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(NULLIF(t.plan, ''), 'unknown')                 AS plan,
         COALESCE(NULLIF(upper(t.currency), ''), 'NGN')          AS currency,
         count(*)::bigint                                        AS payments,
         COALESCE(sum(t.amount_paid), 0)::numeric                AS amount
    FROM transactions t
   WHERE t.status = 'success'
   GROUP BY 1, 2
   ORDER BY 4 DESC;
$fn$;

-- ── 6. Indexes for the aggregate scans ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_created        ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_payment_status ON orders(user_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_content_items_user_created ON content_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_user_segment      ON contacts(user_id, segment);
CREATE INDEX IF NOT EXISTS idx_transactions_status        ON transactions(status);

-- ── 7. Service-only execution ────────────────────────────────────
-- Aggregates must never be callable straight from PostgREST by an app user
-- (analytics_ledger_totals() is platform-wide revenue). The API's service key
-- keeps its grant; anon/authenticated lose theirs.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'analytics_revenue_by_currency(uuid,timestamptz)',
    'analytics_revenue_by_day(uuid,timestamptz,text)',
    'analytics_content_by_type(uuid,timestamptz)',
    'analytics_contacts_by_segment(uuid)',
    'analytics_ledger_totals()'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

-- Done. Verify:
-- SELECT * FROM analytics_revenue_by_currency('<uuid>', NULL);
-- SELECT * FROM analytics_revenue_by_day('<uuid>', now() - interval '30 days', 'NGN');
-- SELECT * FROM analytics_content_by_type('<uuid>', NULL);
-- SELECT * FROM analytics_contacts_by_segment('<uuid>');
-- SELECT * FROM analytics_ledger_totals();
