import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateRouteCode, normalizeRouteCode, extractRouteCode, resolveTenantForInbound, upsertWaCustomerTenant, claimSharedGuidance, resolveSendCreds, ROUTE_CODE_ALPHABET } from '../../src/utils/tenantRouting.js';

console.log('▶ tenantRouting.test (Phase 6.3 — S-06)');

// ─────────────────────────────────────────────────────────────────
// Fake Supabase client: implements just enough of the PostgREST chain used
// by the routing helpers, so routing logic is exercised deterministically.
// ─────────────────────────────────────────────────────────────────
function makeDb(tables = {}) {
  const state = { inserted: [], upserted: [], lastInsertError: null, lastUpdateError: null, updates: [] };
  function rowsFor(table) { return tables[table] ? [...tables[table]] : []; }
  function makeQuery(table) {
    const filters = [];
    const q = {
      _mode: 'select', _limit: null,
      select() { q._mode = q._mode === 'update' ? 'update' : 'select'; return q; },
      eq(col, val) { filters.push([col, '=', val]); return q; },
      lt(col, val) { filters.push([col, '<', val]); return q; },
      limit(n) { q._limit = n; return q; },
      // `await q` — resolves the current mode with filters applied
      then(resolve) {
        let rows = rowsFor(table);
        for (const [col, op, val] of filters) {
          rows = op === '<' ? rows.filter(r => String(r[col]) < String(val))
                            : rows.filter(r => String(r[col]) === String(val));
        }
        if (q._limit != null) rows = rows.slice(0, q._limit);
        if (q._mode === 'update' && state.lastUpdateError) {
          const e = state.lastUpdateError; state.lastUpdateError = null;
          return resolve({ data: null, error: e });
        }
        resolve({ data: rows, error: null });
      },
      insert(payload) { state.inserted.push({ table, payload }); return Promise.resolve({ data: null, error: state.lastInsertError }); },
      update(payload) { state.updates.push({ table, payload, filters: [...filters] }); q._mode = 'update'; return q; },
      upsert(payload) { state.upserted.push({ table, payload }); return Promise.resolve({ data: null, error: state.lastInsertError }); },
    };
    return q;
  }
  return { from: (table) => makeQuery(table), _state: state };
}

const PLATFORM = '900000000000001';
const tenantA = { id: 'bs-a', user_id: 'user-a', business_name: 'Ada Fabrics', connection_method: 'shared', wa_route_code: 'AAA111', wa_phone_number_id: null, wa_access_token: null, auto_reply: true };
const tenantB = { id: 'bs-b', user_id: 'user-b', business_name: 'Bola Foods', connection_method: 'shared', wa_route_code: 'BBB222', wa_phone_number_id: null, wa_access_token: null, auto_reply: true };
const individual = { id: 'bs-i', user_id: 'user-i', business_name: 'Dedicated Ltd', connection_method: 'individual', wa_phone_number_id: '555000111', wa_access_token: 'enc', auto_reply: true };

// ── Route code primitives ────────────────────────────────────────
{
  const codes = new Set();
  for (let i = 0; i < 500; i++) codes.add(generateRouteCode());
  assert.equal(codes.size, 500, 'codes are unique in practice');
  for (const c of codes) {
    assert.equal(c.length, 6, 'code length 6');
    assert.match(c, /^[A-Z2-9]{6}$/, 'code alphabet only');
  }
  assert.ok(!/[0O1I]/.test([...codes].join('')), 'no confusable characters');
  assert.equal(ROUTE_CODE_ALPHABET.length, 32, '32-char alphabet (uniform crypto.randomInt)');
  // injectable RNG → deterministic
  assert.equal(generateRouteCode(() => 0), 'AAAAAA');
  console.log('  ✅ generateRouteCode (length, alphabet, uniqueness, injectable rng)');
}
{
  assert.equal(normalizeRouteCode('  aaa111 '), 'AAA111');
  assert.equal(normalizeRouteCode('#bbb222'), 'BBB222');
  assert.equal(normalizeRouteCode('ab'), null, 'too short');
  assert.equal(normalizeRouteCode('abcdefghijk'), null, 'too long');
  assert.equal(normalizeRouteCode(42), null);
  console.log('  ✅ normalizeRouteCode');
}
{
  assert.deepEqual(extractRouteCode('#AAA111 hello there'), { code: 'AAA111', body: 'hello there' });
  assert.deepEqual(extractRouteCode('  # aaa111, how much?'), { code: 'AAA111', body: 'how much?' });
  assert.deepEqual(extractRouteCode('#BBB222'), { code: 'BBB222', body: '' });
  assert.deepEqual(extractRouteCode('hello #AAA111'), { code: null, body: 'hello #AAA111' }, 'code must be message-initial');
  assert.deepEqual(extractRouteCode('payment 12345'), { code: null, body: 'payment 12345' });
  assert.deepEqual(extractRouteCode(''), { code: null, body: '' });
  console.log('  ✅ extractRouteCode (message-initial only, body stripped)');
}

// ── S-06: resolution — never an arbitrary tenant ─────────────────
{
  // Dedicated number → exactly its owner
  const db = makeDb({ business_settings: [tenantA, tenantB, individual] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: '555000111', platformPhoneNumberId: PLATFORM, customerPhone: '2348000000001', messageText: 'hi' });
  assert.equal(r.via, 'individual');
  assert.equal(r.tenant.user_id, 'user-i');
  console.log('  ✅ dedicated number → its own tenant');
}
{
  // Two rows share the same dedicated number → refuse (data error), never guess
  const dup = { ...individual, id: 'bs-i2', user_id: 'user-i2' };
  const db = makeDb({ business_settings: [individual, dup] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: '555000111', platformPhoneNumberId: PLATFORM, customerPhone: 'x', messageText: 'hi' });
  assert.equal(r.via, 'ambiguous_individual');
  assert.equal(r.tenant, null, 'ambiguous → no tenant');
  console.log('  ✅ duplicate dedicated number → refused (fail-closed)');
}
{
  // Unknown number that is neither dedicated nor the platform number
  const db = makeDb({ business_settings: [tenantA, tenantB] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: '777777777', platformPhoneNumberId: PLATFORM, customerPhone: 'x', messageText: 'hi' });
  assert.equal(r.via, 'unknown_number');
  assert.equal(r.tenant, null);
  console.log('  ✅ unknown number → no tenant');
}
{
  // ★ S-06 REGRESSION (notebook test): two shared tenants, stranger messages the
  //   shared number with no code → NO tenant is chosen (old code picked the first row).
  const db = makeDb({ business_settings: [tenantA, tenantB], wa_customer_tenant: [] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: PLATFORM, platformPhoneNumberId: PLATFORM, customerPhone: '2348000000002', messageText: 'Hello, do you deliver?' });
  assert.equal(r.via, 'unmatched');
  assert.equal(r.tenant, null, 'no arbitrary tenant on shared number');
  console.log('  ✅ shared number + no code → no tenant (S-06 regression)');
}
{
  // Two shared tenants + code prefix → the RIGHT tenant, body de-coded
  const db = makeDb({ business_settings: [tenantA, tenantB], wa_customer_tenant: [] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: PLATFORM, platformPhoneNumberId: PLATFORM, customerPhone: '2348000000003', messageText: '#BBB222 how much is rice?' });
  assert.equal(r.via, 'code');
  assert.equal(r.tenant.user_id, 'user-b', 'routed to the code owner, not the first row');
  assert.equal(r.body, 'how much is rice?', 'discriminator stripped from the message');
  console.log('  ✅ shared number + #CODE → correct tenant of two (S-06)');
}
{
  // Sticky: customer already mapped → routed without a code
  const db = makeDb({ business_settings: [tenantA, tenantB], wa_customer_tenant: [{ platform_phone_number_id: PLATFORM, customer_phone: '2348000000004', user_id: 'user-a' }] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: PLATFORM, platformPhoneNumberId: PLATFORM, customerPhone: '2348000000004', messageText: 'any update?' });
  assert.equal(r.via, 'sticky');
  assert.equal(r.tenant.user_id, 'user-a');
  console.log('  ✅ sticky mapping → same tenant, no code needed');
}
{
  // Sticky mapping to a deleted/settings-less tenant → falls through safely
  const db = makeDb({ business_settings: [tenantA, tenantB], wa_customer_tenant: [{ platform_phone_number_id: PLATFORM, customer_phone: '2348000000005', user_id: 'user-gone' }] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: PLATFORM, platformPhoneNumberId: PLATFORM, customerPhone: '2348000000005', messageText: 'hello' });
  assert.equal(r.tenant, null, 'stale mapping never falls back to another tenant');
  assert.equal(r.via, 'unmatched');
  console.log('  ✅ stale sticky mapping → no tenant');
}
{
  // Unknown code → no tenant, but the code is reported for the guidance reply
  const db = makeDb({ business_settings: [tenantA, tenantB], wa_customer_tenant: [] });
  const r = await resolveTenantForInbound({ db, phoneNumberId: PLATFORM, platformPhoneNumberId: PLATFORM, customerPhone: '2348000000006', messageText: '#ZZZ999 hi' });
  assert.equal(r.via, 'unknown_code');
  assert.equal(r.code, 'ZZZ999');
  assert.equal(r.tenant, null);
  console.log('  ✅ unknown #CODE → no tenant + code reported');
}
{
  // No db / no phoneNumberId → no tenant (never throw)
  assert.equal((await resolveTenantForInbound({ db: null, phoneNumberId: PLATFORM })).tenant, null);
  assert.equal((await resolveTenantForInbound({ db: makeDb({}), phoneNumberId: null })).tenant, null);
  console.log('  ✅ missing db / phoneNumberId → no tenant, no throw');
}

// ── Sticky upsert + guidance throttle ────────────────────────────
{
  const db = makeDb({});
  assert.equal(await upsertWaCustomerTenant(db, { platformPhoneNumberId: PLATFORM, customerPhone: '2341', userId: 'user-a' }), true);
  assert.equal(db._state.upserted[0].table, 'wa_customer_tenant');
  assert.equal(db._state.upserted[0].payload.user_id, 'user-a');
  assert.equal(await upsertWaCustomerTenant(db, { platformPhoneNumberId: PLATFORM }), false, 'missing fields → false, no throw');
  console.log('  ✅ upsertWaCustomerTenant');
}
{
  const db = makeDb({ shared_guidance: [] });
  assert.equal(await claimSharedGuidance(db, PLATFORM, '2341'), true, 'first guidance allowed');

  // Duplicate + recent row (inside cooldown) → no second guidance
  const recent = new Date().toISOString();
  const db2 = makeDb({ shared_guidance: [{ platform_phone_number_id: PLATFORM, customer_phone: '2341', last_sent_at: recent }] });
  db2._state.lastInsertError = { code: '23505', message: 'duplicate' };
  assert.equal(await claimSharedGuidance(db2, PLATFORM, '2341'), false, 'inside 24h cooldown → throttled');

  // Duplicate + stale row (outside cooldown) → allowed again
  const stale = new Date(Date.now() - 25 * 3600_000).toISOString();
  const db3 = makeDb({ shared_guidance: [{ platform_phone_number_id: PLATFORM, customer_phone: '2341', last_sent_at: stale }] });
  db3._state.lastInsertError = { code: '23505', message: 'duplicate' };
  assert.equal(await claimSharedGuidance(db3, PLATFORM, '2341'), true, 'after cooldown → allowed');
  assert.equal(db3._state.updates.length, 1, 'cooldown refresh persisted');

  // Unknown DB error → stay silent (never spam)
  const db4 = makeDb({ shared_guidance: [] });
  db4._state.lastInsertError = { code: '42P01', message: 'missing table' };
  assert.equal(await claimSharedGuidance(db4, PLATFORM, '2341'), false, 'infra error → no send');
  assert.equal(await claimSharedGuidance(null, PLATFORM, '2341'), false, 'no db → no send');
  console.log('  ✅ claimSharedGuidance (first / cooldown / after cooldown / error)');
}

// ── Send credentials: explicit channels only (S-06 + W-07) ───────
{
  const plat = { phoneNumberId: PLATFORM, accessToken: 'plat-token' };
  const a = resolveSendCreds({ connectionMethod: 'individual', waPhoneNumberId: '555', waAccessToken: 'tok' }, plat);
  assert.deepEqual(a, { phoneNumberId: '555', accessToken: 'tok', channel: 'tenant' });
  const b = resolveSendCreds({ connectionMethod: 'shared', waPhoneNumberId: null, waAccessToken: null }, plat);
  assert.equal(b.channel, 'platform-shared');
  assert.equal(b.phoneNumberId, PLATFORM);
  assert.throws(() => resolveSendCreds({ connectionMethod: 'individual', waPhoneNumberId: '555', waAccessToken: null }, plat), /Missing tenant WhatsApp credentials/);
  assert.throws(() => resolveSendCreds({ connectionMethod: 'individual', waPhoneNumberId: null, waAccessToken: 'tok' }, plat), /Missing tenant WhatsApp credentials/);
  assert.throws(() => resolveSendCreds({ connectionMethod: 'shared' }, { phoneNumberId: null, accessToken: null }), /Missing platform WhatsApp credentials/);
  assert.throws(() => resolveSendCreds({}, {}), /Missing platform WhatsApp credentials/, 'default = shared');
  console.log('  ✅ resolveSendCreds (tenant strict / shared platform explicit)');
}

// ── Source wiring checks (index.js uses the safe paths) ──────────
{
  const index = fs.readFileSync('index.js', 'utf8');
  assert.ok(index.includes('resolveTenantForInbound('), 'webhook uses deterministic resolver');
  assert.ok(!index.includes(".eq('connection_method','shared').eq('auto_reply',true).limit(1)"), 'arbitrary shared .limit(1) removed');
  assert.ok(!index.includes('updates.wa_phone_number_id  = WA_PHONE_NUMBER_ID'), 'shared connect no longer stores platform number');
  assert.ok(index.includes('maybeSendRoutingGuidance('), 'unmatched messages get throttled guidance');
  assert.ok(index.includes('resolveSendCreds('), 'outbound sends use explicit channels');
  assert.ok(index.includes('assignRouteCode(') && index.includes('pickFreeRouteCode('), 'route code allocation wired');
  console.log('  ✅ index.js wiring checks (S-06)');
}

console.log('✅ tenantRouting.test passed\n');
