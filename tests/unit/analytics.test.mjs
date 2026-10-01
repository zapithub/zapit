// Phase 7.5 — D-05: analytics aggregates are exact, never a capped 1,000-row page
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fetchAllRows, groupCount, revenueByCurrencyFromRows, revenueByDayFromRows,
  revenueTotals, revenueByDay, contentByType, contactsBySegment, ledgerTotals,
  headlineCurrency, ANALYTICS_MAX_ROWS,
} from '../../src/utils/analytics.js';

console.log('▶ analytics.test (Phase 7.5 — D-05)');

const RPC_MISSING = { code: 'PGRST202', message: 'Could not find the function public.analytics_revenue_by_currency' };

/** Minimal PostgREST builder mock: pages with range(), records every call. */
function makeSupabase({ rows = [], rpc = { data: null, error: RPC_MISSING }, rpcCalls = [], rangeCalls = [], errorAt = null } = {}) {
  const builder = () => {
    const q = {
      select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; },
      range(from, to) {
        rangeCalls.push([from, to]);
        if (errorAt !== null && from >= errorAt) return Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } });
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
    return q;
  };
  return {
    from() { return builder(); },
    rpc(name, args) { rpcCalls.push({ name, args }); return Promise.resolve(typeof rpc === 'function' ? rpc(name, args) : rpc); },
  };
}

// ── fetchAllRows: every row, one page at a time ─────────────────
{
  const one = await fetchAllRows(() => makeSupabase({ rows: [{ a: 1 }, { a: 2 }] }).from());
  assert.deepEqual(one.rows, [{ a: 1 }, { a: 2 }]);
  assert.equal(one.truncated, false);

  const exact = Array.from({ length: 2000 }, (_, i) => ({ i }));
  const calls = [];
  const two = await fetchAllRows(() => makeSupabase({ rows: exact, rangeCalls: calls }).from());
  assert.equal(two.rows.length, 2000, 'both pages read');
  assert.equal(two.pages, 3, 'two full pages + the empty terminator page');
  assert.deepEqual(calls[0], [0, 999]);
  assert.deepEqual(calls[1], [1000, 1999]);
  assert.equal(two.truncated, false);

  const capped = await fetchAllRows(() => makeSupabase({ rows: Array.from({ length: 200 }, (_, i) => ({ i })) }).from(), { pageSize: 10, maxRows: 50 });
  assert.equal(capped.rows.length, 50);
  assert.equal(capped.truncated, true, 'hitting the cap is reported, not hidden');

  const failed = await fetchAllRows(() => makeSupabase({ rows: exact, errorAt: 1000 }).from());
  assert.equal(failed.error?.code, '57014', 'a mid-page error is surfaced to the caller');
  assert.equal(failed.rows.length, 1000, 'rows read before the error are preserved');

  const empty = await fetchAllRows(() => makeSupabase({ rows: [] }).from());
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.pages, 1);
}

// ── pure helpers ────────────────────────────────────────────────
{
  assert.deepEqual(groupCount([{ type: 'image' }, { type: 'image' }, { type: 'text' }, { type: null }], 'type'), { image: 2, text: 1 });
  const rows = [
    { total: 100, currency: 'NGN', payment_status: 'paid' },
    { total: 50, currency: 'NGN', payment_status: 'pending' },
    { total: 20, currency: 'USD', payment_status: 'paid' },
    { total: 5, currency: null, payment_status: 'paid' },
  ];
  const byCur = revenueByCurrencyFromRows(rows);
  // A row with no currency is NGN (same COALESCE as the SQL aggregate).
  assert.deepEqual(byCur.NGN, { orders: 3, paid: 2, revenue: 105 });
  assert.deepEqual(byCur.USD, { orders: 1, paid: 1, revenue: 20 });
  assert.deepEqual(Object.keys(byCur).sort(), ['NGN', 'USD'], 'currencies are separate buckets — never one mixed sum');

  const byDay = revenueByDayFromRows([
    { total: 10, currency: 'NGN', payment_status: 'paid', created_at: '2026-09-30T10:00:00Z' },
    { total: 5, currency: 'NGN', payment_status: 'paid', created_at: '2026-09-30T23:00:00Z' },
    { total: 9, currency: 'USD', payment_status: 'paid', created_at: '2026-09-30T12:00:00Z' },
    { total: 7, currency: 'NGN', payment_status: 'pending', created_at: '2026-10-01T12:00:00Z' },
  ], 'NGN');
  assert.deepEqual(byDay, { '2026-09-30': 15 }, 'paid + matching currency only');
  assert.equal(headlineCurrency(byCur, 'USD'), 'USD');
  assert.equal(headlineCurrency(byCur, 'KES'), 'NGN', 'unknown preference falls back to the biggest bucket');
  assert.equal(headlineCurrency({}, 'GBP'), 'GBP');
  assert.equal(headlineCurrency({}, null), 'NGN');
}

// ── the D-05 regression: 1,001 paid orders must count 1,001 ─────
{
  const orders = Array.from({ length: 1001 }, () => ({ total: 10, currency: 'NGN', payment_status: 'paid' }));
  const calls = [];
  const sb = makeSupabase({ rows: orders, rangeCalls: calls });
  const res = await revenueTotals(sb, { userId: 'u-1' });
  assert.equal(res.source, 'paged', 'falls back to paging when the RPC is missing');
  assert.equal(res.byCurrency.NGN.revenue, 10010, 'revenue includes the 1,001st order (the old code returned 10,000)');
  assert.equal(res.byCurrency.NGN.paid, 1001);
  assert.equal(calls.length, 2, 'read every page');
}

// ── RPC first: exact, typed, and no paging ──────────────────────
{
  const calls = [];
  const sb = makeSupabase({
    rpc: { data: [ { currency: 'ngn', orders_count: '5', paid_count: '4', revenue: '250.50' }, { currency: 'USD', orders_count: 2, paid_count: 2, revenue: 40 } ], error: null },
    rangeCalls: calls,
  });
  const res = await revenueTotals(sb, { userId: 'u-1', since: '2026-09-01T00:00:00Z' });
  assert.equal(res.source, 'rpc');
  assert.equal(calls.length, 0, 'no row reads when Postgres can aggregate');
  assert.deepEqual(res.byCurrency.NGN, { orders: 5, paid: 4, revenue: 250.5 });
  assert.deepEqual(res.byCurrency.USD, { orders: 2, paid: 2, revenue: 40 });
}

// ── a real RPC error must 500, never silently under-report ──────
{
  const sb = makeSupabase({ rpc: { data: null, error: { code: '42501', message: 'permission denied for function' } } });
  const denied = (e) => e?.code === '42501' && e.message.includes('permission denied');
  await assert.rejects(() => revenueTotals(sb, { userId: 'u-1' }), denied);
  await assert.rejects(() => revenueByDay(sb, { userId: 'u-1' }), denied);
  await assert.rejects(() => contentByType(sb, { userId: 'u-1' }), denied);
  await assert.rejects(() => contactsBySegment(sb, { userId: 'u-1' }), denied);
  await assert.rejects(() => ledgerTotals(sb), denied);
}

// ── each aggregate: RPC shape + paged fallback ──────────────────
{
  const dayRpc = makeSupabase({ rpc: { data: [{ day: '2026-09-30T00:00:00', revenue: 300, paid_count: 3 }], error: null } });
  const viaRpc = await revenueByDay(dayRpc, { userId: 'u-1', currency: 'NGN' });
  assert.deepEqual(viaRpc.byDay, { '2026-09-30': 300 });

  const paged = await revenueByDay(makeSupabase({ rows: [
    { total: 10, currency: 'NGN', payment_status: 'paid', created_at: '2026-09-30T08:00:00Z' },
    { total: 99, currency: 'USD', payment_status: 'paid', created_at: '2026-09-30T08:00:00Z' },
  ] }), { userId: 'u-1', currency: 'NGN' });
  assert.deepEqual(paged.byDay, { '2026-09-30': 10 });

  const content = await contentByType(makeSupabase({ rows: [{ type: 'image' }, { type: 'text' }, { type: 'image' }] }), { userId: 'u-1' });
  assert.deepEqual(content.byType, { image: 2, text: 1 });

  const contacts = await contactsBySegment(makeSupabase({ rows: [{ segment: 'vip' }, { segment: null }, { segment: 'lead' }] }), { userId: 'u-1' });
  assert.deepEqual(contacts.bySegment, { vip: 1, lead: 2 }, 'an unset segment is a lead, matching the RPC');
  assert.equal(contacts.total, 3);

  const ledger = await ledgerTotals(makeSupabase({ rows: [
    { plan: 'creator', amount_paid: 12, currency: 'USD' },
    { plan: 'creator', amount_paid: 10000, currency: 'NGN' },
    { plan: 'agency', amount_paid: 60, currency: 'USD' },
  ] }));
  assert.deepEqual(ledger.byPlan, { creator: 10012, agency: 60 });
  assert.deepEqual(ledger.byCurrency, { NGN: 10000, USD: 72 });
  assert.equal(ledger.total, 10072);
  assert.equal(ledger.rows, 3);

  const viaRpcLedger = await ledgerTotals(makeSupabase({ rpc: { data: [{ plan: 'creator', currency: 'USD', payments: 3, amount: 36 }], error: null } }));
  assert.deepEqual(viaRpcLedger.byPlan, { creator: 36 });
  assert.equal(viaRpcLedger.rows, 3);
  assert.equal(ANALYTICS_MAX_ROWS, 50000);
}

// ── wiring: no endpoint aggregates a single capped page ─────────
{
  const src = fs.readFileSync('index.js', 'utf8');
  for (const fn of ['revenueTotals(', 'revenueByDay(', 'contentByType(', 'contactsBySegment(', 'ledgerTotals(', 'fetchAllRows(']) {
    assert.ok(src.includes(fn), `${fn} is wired into index.js`);
  }
  assert.ok(!/from\('orders'\)\.select\('total'\)/.test(src), 'the all-time revenue read is gone');
  assert.ok(!/from\('content_items'\)\.select\('type'\)/.test(src), 'the content-type histogram read is gone');
  assert.ok(!/from\('contacts'\)\.select\('segment'\)/.test(src), 'the segment histogram read is gone');
  assert.ok(!src.includes('__analyticsCache'), 'the undefined analytics cache reference is gone');
  assert.ok(src.includes('analyticsCache.get(cacheKey)'), 'the overview cache is a real, TTL-bound cache');
  assert.ok(src.includes('parsePagination({ page:req.query.page, limit:req.query.limit }'), 'list endpoints paginate explicitly');
  assert.ok(src.includes('export capped at'), 'a capped export says so in the file itself');

  const mig = fs.readFileSync('supabase/migrations/20261010_phase7_05_analytics_aggregates.sql', 'utf8');
  for (const fn of ['analytics_revenue_by_currency', 'analytics_revenue_by_day', 'analytics_content_by_type', 'analytics_contacts_by_segment', 'analytics_ledger_totals']) {
    assert.ok(mig.includes(`FUNCTION ${fn}`), `migration defines ${fn}`);
  }
  assert.ok(mig.includes('REVOKE ALL ON FUNCTION'), 'aggregates are not callable by app roles');
  assert.ok(mig.includes('idx_orders_user_created'), 'the aggregate scans are indexed');
}

console.log('✅ analytics.test passed');
