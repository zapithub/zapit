// ZAPIT — plan quota enforcement (Phase 7.3 — B-06)
// Plans advertised text/image/video/broadcast/reply quotas, but the generation
// routes only checked feature flags: a free account could generate unlimited
// content. Counters now live in `usage_counters`, scoped to a period
// (YYYY-MM-01, UTC), and are consumed through the atomic `consume_usage` RPC so
// two concurrent requests cannot both slip past the limit.
//
// The API degrades gracefully: if migration 20261009 is not applied yet, the
// fallback read-then-upsert keeps limits working (slightly racy), and if the
// table is missing entirely enforcement is skipped with a warning — a missing
// migration must never break generation for paying customers.

export const METRICS = Object.freeze({
  TEXT:      'text_posts',
  IMAGE:     'image_generations',
  VIDEO:     'video_generations',
  BROADCAST: 'whatsapp_broadcasts',
  REPLY:     'whatsapp_replies',
});

export const METRIC_LABELS = Object.freeze({
  text_posts:          'text posts',
  image_generations:   'images',
  video_generations:   'videos',
  whatsapp_broadcasts: 'broadcasts',
  whatsapp_replies:    'WhatsApp replies',
});

/** First day of the current UTC month — the quota period key. */
export function periodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Content item type → the metric it consumes. */
export function metricForContentType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'text': case 'caption': return METRICS.TEXT;
    case 'image': case 'carousel': return METRICS.IMAGE;
    case 'video': return METRICS.VIDEO;
    default: return null;
  }
}

/** Pure limit arithmetic — the single decision used by RPC, fallback and tests. */
export function quotaDecision({ used = 0, limit = null, amount = 1 } = {}) {
  const usedN = Math.max(0, Number(used) || 0);
  if (limit === null || limit === undefined || !Number.isFinite(Number(limit)))
    return { allowed: true, used: usedN, limit: null, remaining: null, enforced: false };
  const cap  = Math.max(0, Number(limit));
  const add  = Math.max(0, Math.trunc(Number(amount) || 0));
  const next = usedN + add;
  return {
    allowed: next <= cap, used: usedN, next, limit: cap,
    remaining: Math.max(0, cap - next), enforced: true,
  };
}

/** PostgREST "function not found" → the RPC migration has not been applied. */
export function isRpcMissing(error) {
  const code = String(error?.code || '');
  const msg  = String(error?.message || '');
  return code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(msg);
}

export function quotaExceededBody(metric, { used = 0, limit = 0 } = {}) {
  const label = METRIC_LABELS[metric] || metric;
  return {
    success: false,
    code: 'quota_exceeded',
    error: `You've used all ${limit} ${label} on your plan this month. Upgrade your plan to keep going.`,
    data: { metric, used, limit },
  };
}

/**
 * Atomically consume `amount` of `metric` for the current period.
 * Returns { allowed, used, limit, remaining, enforced, degraded? }.
 */
export async function consumeQuota(supabase, { userId, metric, amount = 1, limit, period = periodStart() }) {
  if (!metric || !userId) return { allowed: true, used: 0, limit: null, remaining: null, enforced: false };
  if (limit === null || limit === undefined || !Number.isFinite(Number(limit)))
    return { allowed: true, used: 0, limit: null, remaining: null, enforced: false };

  const cap = Math.max(0, Number(limit));
  const amt = Math.max(1, Math.trunc(Number(amount) || 1));

  // 1) atomic path
  try {
    const { data, error } = await supabase.rpc('consume_usage', {
      p_user_id: userId, p_metric: metric, p_amount: amt, p_limit: cap, p_period: period,
    });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        return {
          allowed: !!row.allowed,
          used: Number(row.used || 0), limit: cap,
          remaining: Number(row.remaining || 0), enforced: true,
        };
      }
    } else if (!isRpcMissing(error)) {
      console.warn(JSON.stringify({ level:'warn', msg:'quota rpc error', metric, err:error.message }));
    }
  } catch (e) {
    console.warn(JSON.stringify({ level:'warn', msg:'quota rpc threw', metric, err:e.message }));
  }

  // 2) fallback: read-then-upsert (race window documented; correct for normal use)
  try {
    const { data: row } = await supabase.from('usage_counters').select('used')
      .eq('user_id', userId).eq('metric', metric).eq('period_start', period).single();
    const decision = quotaDecision({ used: row?.used || 0, limit: cap, amount: amt });
    if (!decision.allowed) return { ...decision, enforced: true };
    const nextUsed = (row?.used || 0) + amt;
    const { error } = await supabase.from('usage_counters').upsert(
      { user_id: userId, metric, period_start: period, used: nextUsed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,metric,period_start' },
    );
    if (error) throw new Error(error.message);
    return { allowed: true, used: nextUsed, limit: cap, remaining: Math.max(0, cap - nextUsed), enforced: true, degraded: true };
  } catch (e) {
    console.warn(JSON.stringify({ level:'warn', msg:'quota enforcement degraded — apply migration 20261009', metric, err:e.message }));
    return { allowed: true, used: 0, limit: cap, remaining: null, enforced: false, degraded: true };
  }
}

/** Current-period counters (or null when the RPC is unavailable). */
export async function usageSnapshot(supabase, { userId, period = periodStart() } = {}) {
  try {
    const { data, error } = await supabase.rpc('usage_snapshot', { p_user_id: userId, p_period: period });
    if (error || !Array.isArray(data)) return null;
    return Object.fromEntries(data.map(r => [r.metric, Number(r.used || 0)]));
  } catch { return null; }
}

/**
 * Express middleware factory: consumes the metric before the handler runs.
 * `supabase` and `getLimits(userId)` are injected by index.js (no cycles, no globals).
 */
export function quotaGuard(metric, { supabase, getLimits, amount } = {}) {
  return async function quotaMiddleware(req, res, next) {
    try {
      if (!supabase || !getLimits || !req.user?.id) return next();
      const limits = await getLimits(req.user.id);
      const wanted = typeof amount === 'function' ? amount(req) : (amount || 1);
      const decision = await consumeQuota(supabase, { userId: req.user.id, metric, amount: wanted, limit: limits?.[metric] });
      if (!decision.allowed) return res.status(403).json(quotaExceededBody(metric, decision));
      req.quota = { ...decision, metric };
      return next();
    } catch (e) {
      // Quota plumbing must never take the endpoint down.
      console.warn(JSON.stringify({ level:'warn', msg:'quota guard failed open', metric, err:e.message }));
      return next();
    }
  };
}
