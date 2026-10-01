// ────────────────────────────────────────────────────────────────
// ZAPIT — Analytics aggregation (Phase 7.5 / D-05)
//
// PostgREST returns at most 1,000 rows per request. Every number that used to be
// computed from one such read could therefore be silently truncated. Each
// aggregate here is computed by Postgres when migration 20261010 is applied
// (one call, exact, cheap) and otherwise by reading **every** matching row with
// range() paging — never from a single capped page.
//
// Multi-currency rule (B-05): amounts in different currencies are never summed
// into one meaningless number. Totals are grouped by currency and the caller
// reports the user's own currency as the headline figure.
// ────────────────────────────────────────────────────────────────
import { isRpcMissing } from './quota.js';

export const ANALYTICS_PAGE_SIZE = 1000;
export const ANALYTICS_MAX_ROWS  = 50000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Read every row a query can return, 1,000 at a time.
 * @param {() => any} buildQuery must return a **fresh** PostgREST builder
 * @returns {Promise<{rows: object[], truncated: boolean, pages: number, error: any|null}>}
 */
export async function fetchAllRows(buildQuery, { pageSize = ANALYTICS_PAGE_SIZE, maxRows = ANALYTICS_MAX_ROWS } = {}) {
  const rows = [];
  let from = 0;
  let pages = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    pages++;
    if (error) return { rows, truncated: false, pages, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { rows, truncated: false, pages, error: null };
    if (rows.length >= maxRows) return { rows, truncated: true, pages, error: null };
    from += pageSize;
  }
}

export function groupCount(rows, key) {
  const out = {};
  for (const r of rows || []) {
    const k = r?.[key];
    if (k === undefined || k === null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** `{ currency: { orders, paid, revenue } }` from raw order rows. */
export function revenueByCurrencyFromRows(rows) {
  const out = {};
  for (const o of rows || []) {
    const cur = String(o?.currency || 'NGN').toUpperCase();
    const bucket = out[cur] || (out[cur] = { orders: 0, paid: 0, revenue: 0 });
    bucket.orders += 1;
    if (o?.payment_status === 'paid') {
      bucket.paid += 1;
      bucket.revenue += num(o.total);
    }
  }
  return out;
}

/** `{ YYYY-MM-DD: revenue }` for one currency (or all when `currency` is falsy). */
export function revenueByDayFromRows(rows, currency = null) {
  const out = {};
  for (const o of rows || []) {
    if (o?.payment_status !== 'paid') continue;
    if (currency && String(o?.currency || 'NGN').toUpperCase() !== String(currency).toUpperCase()) continue;
    const day = String(o?.created_at || '').substring(0, 10);
    if (!day) continue;
    out[day] = (out[day] || 0) + num(o.total);
  }
  return out;
}

/**
 * Totals per currency for a user's orders.
 * @returns {Promise<{byCurrency: object, source: 'rpc'|'paged', rows: number, truncated: boolean}>}
 */
export async function revenueTotals(supabase, { userId, since = null } = {}) {
  const rpc = await supabase.rpc('analytics_revenue_by_currency', { p_user_id: userId, p_since: since });
  if (!rpc.error) {
    const byCurrency = {};
    for (const r of rpc.data || []) {
      byCurrency[String(r.currency || 'NGN').toUpperCase()] = {
        orders: num(r.orders_count), paid: num(r.paid_count), revenue: num(r.revenue),
      };
    }
    return { byCurrency, source: 'rpc', rows: 0, truncated: false };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;
  const { rows, truncated } = await fetchAllRows(() => {
    let q = supabase.from('orders').select('total,currency,payment_status').eq('user_id', userId);
    if (since) q = q.gte('created_at', since);
    return q;
  });
  return { byCurrency: revenueByCurrencyFromRows(rows), source: 'paged', rows: rows.length, truncated };
}

/**
 * Paid revenue per day for one currency.
 * @returns {Promise<{byDay: object, source: 'rpc'|'paged', truncated: boolean}>}
 */
export async function revenueByDay(supabase, { userId, since = null, currency = null } = {}) {
  const rpc = await supabase.rpc('analytics_revenue_by_day', { p_user_id: userId, p_since: since, p_currency: currency });
  if (!rpc.error) {
    const byDay = {};
    for (const r of rpc.data || []) {
      const day = String(r.day || '').substring(0, 10);
      if (day) byDay[day] = num(r.revenue);
    }
    return { byDay, source: 'rpc', truncated: false };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;
  const { rows, truncated } = await fetchAllRows(() => {
    let q = supabase.from('orders').select('total,currency,payment_status,created_at').eq('user_id', userId);
    if (since) q = q.gte('created_at', since);
    if (currency) q = q.eq('currency', currency);
    return q;
  });
  return { byDay: revenueByDayFromRows(rows, currency), source: 'paged', truncated };
}

/** `{ type: count }` for generated content in a period. */
export async function contentByType(supabase, { userId, since = null } = {}) {
  const rpc = await supabase.rpc('analytics_content_by_type', { p_user_id: userId, p_since: since });
  if (!rpc.error) {
    const byType = {};
    for (const r of rpc.data || []) byType[String(r.type || 'unknown')] = num(r.item_count);
    return { byType, source: 'rpc', truncated: false };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;
  const { rows, truncated } = await fetchAllRows(() => {
    let q = supabase.from('content_items').select('type').eq('user_id', userId);
    if (since) q = q.gte('created_at', since);
    return q;
  });
  return { byType: groupCount(rows, 'type'), source: 'paged', truncated };
}

/** `{ segment: count }` for a user's contacts. */
export async function contactsBySegment(supabase, { userId } = {}) {
  const rpc = await supabase.rpc('analytics_contacts_by_segment', { p_user_id: userId });
  if (!rpc.error) {
    const bySegment = {};
    for (const r of rpc.data || []) bySegment[String(r.segment || 'lead')] = num(r.contact_count);
    return { bySegment, total: Object.values(bySegment).reduce((s, n) => s + n, 0), source: 'rpc', truncated: false };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;
  const { rows, truncated } = await fetchAllRows(() => supabase.from('contacts').select('segment').eq('user_id', userId));
  // Same normalisation as the RPC: an unset segment counts as `lead`.
  const bySegment = groupCount(rows.map(r => ({ segment: r.segment || 'lead' })), 'segment');
  return { bySegment, total: Object.values(bySegment).reduce((s, n) => s + n, 0), source: 'paged', truncated };
}

/**
 * Subscription ledger totals by plan **and** currency (admin revenue).
 * @returns {Promise<{byPlan: object, byCurrency: object, total: number, rows: number, source: string, truncated: boolean}>}
 */
export async function ledgerTotals(supabase) {
  const rpc = await supabase.rpc('analytics_ledger_totals');
  if (!rpc.error) {
    const byPlan = {}, byCurrency = {};
    let rows = 0;
    for (const r of rpc.data || []) {
      const amount = num(r.amount);
      byPlan[String(r.plan || 'unknown')] = num(byPlan[String(r.plan || 'unknown')]) + amount;
      byCurrency[String(r.currency || 'NGN').toUpperCase()] = num(byCurrency[String(r.currency || 'NGN').toUpperCase()]) + amount;
      rows += num(r.payments);
    }
    return { byPlan, byCurrency, total: Object.values(byCurrency).reduce((s, n) => s + n, 0), rows, source: 'rpc', truncated: false };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;
  const { rows: ledgerRows, truncated } = await fetchAllRows(() => supabase.from('transactions').select('plan,amount_paid,currency').eq('status', 'success'));
  const byPlan = {}, byCurrency = {};
  for (const t of ledgerRows) {
    const amount = num(t.amount_paid);
    const cur = String(t.currency || 'NGN').toUpperCase();
    byPlan[t.plan || 'unknown'] = num(byPlan[t.plan || 'unknown']) + amount;
    byCurrency[cur] = num(byCurrency[cur]) + amount;
  }
  return { byPlan, byCurrency, total: Object.values(byCurrency).reduce((s, n) => s + n, 0), rows: ledgerRows.length, source: 'paged', truncated };
}

/**
 * Pick the headline currency: the user's own, else the currency with the most
 * revenue, else NGN.
 */
export function headlineCurrency(byCurrency, preferred) {
  const keys = Object.keys(byCurrency || {});
  const want = String(preferred || '').toUpperCase();
  if (want && keys.includes(want)) return want;
  if (keys.length) return keys.sort((a, b) => (byCurrency[b]?.revenue || 0) - (byCurrency[a]?.revenue || 0))[0];
  return want || 'NGN';
}
