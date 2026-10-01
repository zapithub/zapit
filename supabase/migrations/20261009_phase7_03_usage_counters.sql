-- ═══════════════════════════════════════════════════════════════
-- ZAPIT — Phase 7.3 (B-06/B-09): period-scoped usage quotas
-- Idempotent. Replaces the old (unfiltered, no-op) monthly reset: counters are
-- keyed by period_start, so a new month simply starts a new row and nothing
-- has to be reset. The API degrades gracefully when this is not applied yet.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Counters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_counters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric       text NOT NULL,
  period_start date NOT NULL,                     -- first day of the UTC month
  used         integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_user_period ON usage_counters(user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_counters_period      ON usage_counters(period_start);

COMMENT ON TABLE usage_counters IS
  'Phase 7.3 (B-06/B-09): monthly plan quotas. Period-scoped rows replace the monthly reset cron — a new month gets a new period_start.';

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usage_counters' AND policyname = 'usage_counters_service_only') THEN
    CREATE POLICY usage_counters_service_only ON usage_counters FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 2. Atomic consume: check-and-increment in one statement ──────
-- Returns allowed=false with the current usage when the limit would be exceeded.
CREATE OR REPLACE FUNCTION consume_usage(
  p_user_id uuid,
  p_metric  text,
  p_amount  integer,
  p_limit   integer,
  p_period  date DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date
)
RETURNS TABLE(allowed boolean, used integer, remaining integer)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_used  integer;
  v_limit integer := GREATEST(COALESCE(p_limit, 0), 0);
  v_add   integer := GREATEST(COALESCE(p_amount, 1), 1);
BEGIN
  IF p_limit IS NULL THEN
    RETURN QUERY SELECT true, 0, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO usage_counters(user_id, metric, period_start, used, updated_at)
  VALUES (p_user_id, p_metric, p_period, v_add, now())
  ON CONFLICT (user_id, metric, period_start)
  DO UPDATE SET used = usage_counters.used + v_add, updated_at = now()
  WHERE usage_counters.used + v_add <= v_limit
  RETURNING usage_counters.used INTO v_used;

  IF v_used IS NULL THEN
    -- The conflict branch was rejected by the WHERE clause: the limit is hit.
    SELECT uc.used INTO v_used
      FROM usage_counters uc
     WHERE uc.user_id = p_user_id AND uc.metric = p_metric AND uc.period_start = p_period;
    RETURN QUERY SELECT false, COALESCE(v_used, 0), 0;
  END IF;

  RETURN QUERY SELECT true, v_used, GREATEST(v_limit - v_used, 0);
END;
$fn$;

-- ── 3. Snapshot for /subscription/current ────────────────────────
CREATE OR REPLACE FUNCTION usage_snapshot(
  p_user_id uuid,
  p_period  date DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date
)
RETURNS TABLE(metric text, used integer)
LANGUAGE sql
STABLE
AS $fn$
  SELECT uc.metric, uc.used
    FROM usage_counters uc
   WHERE uc.user_id = p_user_id AND uc.period_start = p_period
   ORDER BY uc.metric;
$fn$;

-- ── 4. Housekeeping: keep ~13 months of history ──────────────────
CREATE OR REPLACE FUNCTION prune_usage_counters(older_than_months int DEFAULT 13)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE deleted integer;
BEGIN
  IF to_regclass('public.usage_counters') IS NULL THEN RETURN 0; END IF;
  DELETE FROM usage_counters
   WHERE period_start < (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => GREATEST(older_than_months, 1)))::date;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

-- Done. Verify:
-- SELECT consume_usage('<uuid>', 'text_posts', 1, 3, date_trunc('month', now())::date);
-- SELECT * FROM usage_snapshot('<uuid>');
