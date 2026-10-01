// Phase 7.3 — B-06 (quota enforcement) + B-09 (monthly reset was a no-op)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  METRICS, METRIC_LABELS, periodStart, metricForContentType, quotaDecision,
  quotaExceededBody, isRpcMissing, consumeQuota, usageSnapshot, quotaGuard,
} from '../../src/utils/quota.js';

console.log('▶ quota.test (Phase 7.3 — B-06/B-09)');

// ── period key + metric mapping ──────────────────────────────────
{
  assert.equal(periodStart(new Date('2026-10-01T00:00:00Z')), '2026-10-01');
  assert.equal(periodStart(new Date('2026-10-31T23:59:59Z')), '2026-10-01', 'same month → same period key');
  assert.equal(periodStart(new Date('2026-11-01T00:00:01Z')), '2026-11-01', 'new month → new period, no reset needed');
  assert.match(periodStart(), /^\d{4}-\d{2}-01$/);

  assert.equal(metricForContentType('text'), METRICS.TEXT);
  assert.equal(metricForContentType('caption'), METRICS.TEXT);
  assert.equal(metricForContentType('image'), METRICS.IMAGE);
  assert.equal(metricForContentType('carousel'), METRICS.IMAGE);
  assert.equal(metricForContentType('video'), METRICS.VIDEO);
  assert.equal(metricForContentType('mystery'), null);
  assert.equal(metricForContentType(undefined), null);
}

// ── pure limit arithmetic ────────────────────────────────────────
{
  assert.equal(quotaDecision({ used:0, limit:10, amount:1 }).allowed, true);
  assert.equal(quotaDecision({ used:9, limit:10, amount:1 }).allowed, true, 'exact boundary allowed');
  assert.equal(quotaDecision({ used:10, limit:10, amount:1 }).allowed, false);
  assert.equal(quotaDecision({ used:9, limit:10, amount:5 }).allowed, false, 'a multi-unit action cannot cross the cap');
  assert.equal(quotaDecision({ used:0, limit:0, amount:1 }).allowed, false, 'zero-limit plans (free broadcasts) block');
  assert.equal(quotaDecision({ used:0, limit:null }).enforced, false, 'no limit → unlimited');
  assert.equal(quotaDecision({ used:0 }).enforced, false);
  assert.equal(quotaDecision({ used:'4', limit:'10', amount:'2' }).allowed, true, 'numeric strings tolerated');
  assert.equal(quotaDecision({ used:5, limit:10, amount:1 }).remaining, 4);
  assert.equal(quotaDecision({ used:10, limit:10, amount:1 }).remaining, 0, 'remaining never negative');
  assert.equal(quotaDecision({ used:0, limit:10 }).next, 1, 'default amount is 1');
}

// ── error classification ─────────────────────────────────────────
{
  assert.equal(isRpcMissing({ code:'PGRST202', message:'Could not find the function public.consume_usage' }), true);
  assert.equal(isRpcMissing({ message:'function consume_usage(uuid, text) does not exist' }), true);
  assert.equal(isRpcMissing({ message:'permission denied' }), false);
  assert.equal(isRpcMissing(null), false);
}

// ── atomic RPC path ──────────────────────────────────────────────
function fakeClient({ rpc, select, upsert } = {}) {
  return {
    rpc: rpc || (async () => ({ data: null, error: { message:'no rpc' } })),
    from(table) {
      const api = {
        select: () => api, eq: () => api, single: async () => select ? select(table) : { data: null },
        upsert: async (row) => upsert ? upsert(table, row) : { error: null },
        update: () => api, insert: async () => ({ error:null }),
      };
      return api;
    },
  };
}
{
  const client = fakeClient({ rpc: async (fn, args) => {
    assert.equal(fn, 'consume_usage');
    assert.equal(args.p_metric, METRICS.TEXT);
    assert.equal(args.p_amount, 3);
    assert.equal(args.p_limit, 10);
    assert.match(args.p_period, /^\d{4}-\d{2}-01$/);
    return { data: [{ allowed:true, used:3, remaining:7 }], error:null };
  }});
  const q = await consumeQuota(client, { userId:'u1', metric:METRICS.TEXT, amount:3, limit:10 });
  assert.deepEqual({ allowed:q.allowed, used:q.used, remaining:q.remaining, enforced:q.enforced }, { allowed:true, used:3, remaining:7, enforced:true });
  assert.equal(q.degraded, undefined, 'atomic path is not degraded');

  const blocked = await consumeQuota(fakeClient({ rpc: async () => ({ data:[{ allowed:false, used:10, remaining:0 }], error:null }) }), { userId:'u1', metric:METRICS.TEXT, amount:1, limit:10 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 10);
}

// ── graceful degradation without the migration ───────────────────
{
  let upserted = null;
  const client = fakeClient({
    rpc: async () => ({ data:null, error:{ code:'PGRST202', message:'Could not find the function consume_usage' } }),
    select: () => ({ data: { used: 9 } }),
    upsert: (_t, row) => { upserted = row; return { error:null }; },
  });
  const q = await consumeQuota(client, { userId:'u1', metric:METRICS.IMAGE, amount:1, limit:10 });
  assert.equal(q.allowed, true);
  assert.equal(q.used, 10);
  assert.equal(q.degraded, true, 'fallback is marked degraded');
  assert.equal(upserted.used, 10);
  assert.equal(upserted.metric, METRICS.IMAGE);

  const atCap = await consumeQuota(fakeClient({
    rpc: async () => ({ data:null, error:{ code:'PGRST202' } }),
    select: () => ({ data:{ used:10 } }),
  }), { userId:'u1', metric:METRICS.IMAGE, amount:1, limit:10 });
  assert.equal(atCap.allowed, false, 'fallback still blocks at the cap');

  // Missing table entirely → fail open (never break paying customers), loudly.
  const broken = await consumeQuota(fakeClient({
    rpc: async () => ({ data:null, error:{ code:'PGRST202' } }),
    select: () => { throw new Error('relation "usage_counters" does not exist'); },
  }), { userId:'u1', metric:METRICS.VIDEO, amount:1, limit:3 });
  assert.equal(broken.allowed, true);
  assert.equal(broken.enforced, false, 'enforcement is off, not silently wrong');

  // Unlimited plans never even hit the database.
  let touched = 0;
  const spy = { rpc: async () => { touched++; return { data:null }; }, from(){ touched++; return { select:()=>({eq:()=>({single:async()=>({data:null})})}) }; } };
  const unlimited = await consumeQuota(spy, { userId:'u1', metric:METRICS.TEXT, limit:null });
  assert.equal(unlimited.enforced, false);
  assert.equal(touched, 0);
}

// ── snapshot ─────────────────────────────────────────────────────
{
  const snap = await usageSnapshot(fakeClient({ rpc: async () => ({ data:[{ metric:'text_posts', used:4 },{ metric:'image_generations', used:'7' }] }) }), { userId:'u1' });
  assert.deepEqual(snap, { text_posts:4, image_generations:7 });
  assert.equal(await usageSnapshot(fakeClient({ rpc: async () => ({ data:null, error:{ message:'nope' } }) }), { userId:'u1' }), null);
}

// ── middleware behaviour ─────────────────────────────────────────
{
  const limits = { text_posts: 2 };
  const makeRes = () => {
    const res = { statusCode:null, body:null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const guard = quotaGuard(METRICS.TEXT, {
    supabase: fakeClient({ rpc: async () => ({ data:[{ allowed:false, used:2, remaining:0 }], error:null }) }),
    getLimits: async () => limits,
  });

  // allowed → next()
  const guardOk = quotaGuard(METRICS.TEXT, {
    supabase: fakeClient({ rpc: async () => ({ data:[{ allowed:true, used:1, remaining:1 }], error:null }) }),
    getLimits: async () => limits,
  });
  let nexted = 0; const req = { user:{ id:'u1' }, body:{} };
  await guardOk(req, makeRes(), () => nexted++);
  assert.equal(nexted, 1, 'allowed requests continue');
  assert.equal(req.quota.metric, METRICS.TEXT);

  // blocked → 403 quota_exceeded
  const res = makeRes();
  let nexted2 = 0;
  await guard({ user:{ id:'u1' }, body:{} }, res, () => nexted2++);
  assert.equal(nexted2, 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'quota_exceeded');
  assert.equal(res.body.data.metric, METRICS.TEXT);

  // plumbing failure → fail open, never 500 the endpoint
  const failing = quotaGuard(METRICS.TEXT, { supabase: fakeClient(), getLimits: async () => { throw new Error('db down'); } });
  let nexted3 = 0;
  await failing({ user:{ id:'u1' }, body:{} }, makeRes(), () => nexted3++);
  assert.equal(nexted3, 1, 'quota plumbing fails open');

  const body = quotaExceededBody(METRICS.IMAGE, { used:5, limit:5 });
  assert.equal(body.code, 'quota_exceeded');
  assert.ok(body.error.includes('5 images'), 'message names the metric and cap');
  assert.equal(METRIC_LABELS.whatsapp_broadcasts, 'broadcasts');
}

// ── wiring: every advertised quota is actually enforced ──────────
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(src.includes('quotaGuardFor(METRICS.TEXT)'), 'text generation metered');
  assert.ok(src.includes('quotaGuardFor(METRICS.IMAGE)'), 'image generation metered');
  assert.ok(src.includes('quotaGuardFor(METRICS.IMAGE, (req) =>'), 'carousel metered per slide');
  assert.ok(src.includes('quotaGuardFor(METRICS.VIDEO)'), 'video generation metered');
  assert.ok(src.includes('metricForContentType(item.type)'), 'regeneration metered by item type');
  assert.ok(src.includes('metric:METRICS.BROADCAST'), 'broadcasts metered');
  assert.ok(src.includes('metric:METRICS.REPLY'), 'WhatsApp replies metered');
  assert.ok(src.includes('usageSnapshot(supabase'), 'subscription exposes monthly counters');

  // B-09: the monthly job must never issue an unscoped write again.
  const cronBlock = src.slice(src.indexOf("cron.schedule('0 0 1 * *'"), src.indexOf("cron.schedule('0 0 1 * *'") + 2200);
  assert.ok(cronBlock.includes(".in('user_id', ids)"), 'legacy reset filters by explicit user ids');
  assert.ok(cronBlock.includes('prune_usage_counters'), 'monthly job prunes old counters');
  assert.ok(!cronBlock.includes("update({ reply_count:0, last_reply_reset:new Date().toISOString() })"),
    'the unfiltered B-09 no-op write is gone');

  const mig = fs.readFileSync('supabase/migrations/20261009_phase7_03_usage_counters.sql', 'utf8');
  assert.ok(mig.includes('CREATE TABLE IF NOT EXISTS usage_counters'));
  assert.ok(mig.includes('UNIQUE (user_id, metric, period_start)'), 'one row per user/metric/month');
  assert.ok(mig.includes('CREATE OR REPLACE FUNCTION consume_usage'), 'atomic consume function exists');
  assert.ok(mig.includes('WHERE usage_counters.used + v_add <= v_limit'), 'the update itself enforces the cap');
  assert.ok(mig.includes('usage_snapshot') && mig.includes('prune_usage_counters'));
  assert.ok(mig.includes('ENABLE ROW LEVEL SECURITY'), 'counters are service-role only');
}

console.log('✅ quota.test passed');
