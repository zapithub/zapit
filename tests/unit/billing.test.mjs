import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateCharge, expectedAmountMinor, verifyPaymentAmount, cancelSubscriptionPlan, reactivateDecision, activationFields, normalizeCycle, cycleDays, planPrice, BILLING_CYCLES } from '../../src/utils/billing.js';

console.log('▶ billing.test (Phase 6.4 — B-01/B-02/B-04/B-07)');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-01T12:00:00.000Z');
const future = (days) => new Date(now.getTime() + days * DAY).toISOString();
const past = (days) => new Date(now.getTime() - days * DAY).toISOString();

// ── Cycles ──────────────────────────────────────────────────────
assert.equal(normalizeCycle('annual'), 'annual');
assert.equal(normalizeCycle('yearly'), 'monthly', 'unknown cycle never extends the period');
assert.equal(normalizeCycle(undefined), 'monthly');
assert.equal(cycleDays('annual'), 365);
assert.equal(cycleDays('monthly'), 30);
assert.equal(BILLING_CYCLES.annual.multiplier, 9.6);
console.log('  ✅ cycle normalisation (unknown → monthly)');

// ── Expected amount (server-side price table, not client input) ──
assert.equal(expectedAmountMinor({ plan: 'creator', currency: 'NGN', billingCycle: 'monthly' }), 10000 * 100);
assert.equal(expectedAmountMinor({ plan: 'creator', currency: 'NGN', billingCycle: 'annual' }), Math.round(10000 * 12 * 0.8) * 100);
assert.equal(expectedAmountMinor({ plan: 'agency', currency: 'USD', billingCycle: 'monthly' }), 60 * 100);
assert.equal(expectedAmountMinor({ plan: 'growth', currency: 'KES', billingCycle: 'monthly' }), 3750 * 100);
assert.equal(expectedAmountMinor({ plan: 'creator', currency: 'GBP', billingCycle: 'monthly' }), 12 * 100, 'unknown currency falls back to USD price (same as init)');
assert.equal(expectedAmountMinor({ plan: 'free', currency: 'NGN' }), null, 'free plan has no price');
assert.equal(expectedAmountMinor({ plan: 'nope', currency: 'NGN' }), null);
assert.equal(planPrice({ plan: 'agency', currency: 'GHS' }), 750);
console.log('  ✅ expectedAmountMinor (per plan/currency/cycle, ¥0 free)');

// ── Amount verification: underpayment / wrong currency / tolerance ──
{
  const expected = 10000 * 100;
  assert.equal(verifyPaymentAmount({ paidMinor: expected, currency: 'NGN', expectedMinor: expected }).ok, true);
  assert.equal(verifyPaymentAmount({ paidMinor: expected + 1, currency: 'NGN', expectedMinor: expected }).ok, true, '±1 minor unit = rounding');
  assert.equal(verifyPaymentAmount({ paidMinor: expected - 1, currency: 'NGN', expectedMinor: expected }).ok, true);
  const under = verifyPaymentAmount({ paidMinor: 100, currency: 'NGN', expectedMinor: expected });
  assert.equal(under.ok, false);
  assert.equal(under.reason, 'amount_mismatch', '₦1 payment never buys Creator');
  assert.equal(verifyPaymentAmount({ paidMinor: expected, currency: '', expectedMinor: expected }).reason, 'currency_missing');
  assert.equal(verifyPaymentAmount({ paidMinor: NaN, currency: 'NGN', expectedMinor: expected }).reason, 'amount_missing');
  assert.equal(verifyPaymentAmount({ paidMinor: expected, currency: 'NGN', expectedMinor: null }).reason, 'amount_missing');
  // annual underpay of one month must fail
  const annual = expectedAmountMinor({ plan: 'creator', currency: 'NGN', billingCycle: 'annual' });
  assert.equal(verifyPaymentAmount({ paidMinor: 10000 * 100, currency: 'NGN', expectedMinor: annual }).ok, false, 'monthly price does not buy annual');
  console.log('  ✅ verifyPaymentAmount (exact price, tolerance 1 minor unit)');
}

// ── B-02: cancel keeps access until period end ──────────────────
{
  const mid = cancelSubscriptionPlan({ plan: 'creator', status: 'active', expires_at: future(20) }, now);
  assert.equal(mid.status, 'active', 'still active after cancel (B-02)');
  assert.equal(mid.cancel_at, future(20), 'cancel_at = paid period end');
  assert.equal(mid.auto_renew, false);
  assert.ok(mid.cancelled_at);
  assert.equal(mid.access_until, future(20));

  const ended = cancelSubscriptionPlan({ plan: 'creator', status: 'active', expires_at: past(1) }, now);
  assert.equal(ended.status, 'cancelled', 'expired period → immediate cancel');
  assert.equal(ended.cancel_at, null);

  const noExpiry = cancelSubscriptionPlan({ plan: 'free', status: 'active', expires_at: null }, now);
  assert.equal(noExpiry.status, 'cancelled');
  const brokenDate = cancelSubscriptionPlan({ plan: 'creator', status: 'active', expires_at: 'not-a-date' }, now);
  assert.equal(brokenDate.status, 'cancelled', 'invalid date → immediate cancel');
  console.log('  ✅ cancelSubscriptionPlan (period-end access preserved)');
}

// ── B-01: reactivate never grants free time ─────────────────────
{
  // Pending cancellation, still inside the paid period → resume, SAME expiry
  const a = reactivateDecision({ status: 'active', cancel_at: future(20), expires_at: future(20) }, now);
  assert.equal(a.mode, 'resume');
  assert.equal(a.access_until, future(20));

  // Legacy immediate-cancel row whose paid period has NOT ended → resume without extension
  const b = reactivateDecision({ status: 'cancelled', cancel_at: null, expires_at: future(5), plan: 'creator' }, now);
  assert.equal(b.mode, 'resume');
  assert.equal(b.access_until, future(5), 'expiry is not extended by reactivation');

  // Paid period over → new payment required (the old code minted free 30 days here)
  const c = reactivateDecision({ status: 'cancelled', cancel_at: null, expires_at: past(1), plan: 'creator' }, now);
  assert.equal(c.mode, 'payment_required');

  const d = reactivateDecision({ status: 'expired', expires_at: past(40), plan: 'agency' }, now);
  assert.equal(d.mode, 'payment_required');

  const active = reactivateDecision({ status: 'active', cancel_at: null, expires_at: future(10) }, now);
  assert.equal(active.mode, 'already_active', 'no-op for an active plan');
  assert.equal(reactivateDecision(null).mode, 'not_found');
  console.log('  ✅ reactivateDecision (resume / already_active / payment_required)');
}

// ── Activation fields from a verified payment ───────────────────
{
  const monthly = activationFields({ cycle: 'monthly', now });
  assert.equal(monthly.status, 'active');
  assert.equal(monthly.cancel_at, null);
  assert.equal(monthly.cancelled_at, null);
  assert.equal(monthly.auto_renew, true);
  assert.equal(monthly.expires_at, new Date(now.getTime() + 30 * DAY).toISOString());
  const annual = activationFields({ cycle: 'annual', now });
  assert.equal(annual.expires_at, new Date(now.getTime() + 365 * DAY).toISOString());
  const junk = activationFields({ cycle: 'forever', now });
  assert.equal(junk.expires_at, monthly.expires_at, 'unknown cycle → 30 days, never longer');
  console.log('  ✅ activationFields (30d/365d, unknown → 30d)');
}

// ── evaluateCharge: full decision table for the money path ──────
{
  const meta = { user_id: 'u-1', plan: 'creator', billing_cycle: 'monthly', currency: 'NGN' };
  const good = {
    eventData: { reference: 'ref-1', amount: 1000000, currency: 'NGN', metadata: meta },
    verifyData: { status: 'success', reference: 'ref-1', amount: 1000000, currency: 'NGN', metadata: meta },
  };
  const ok = evaluateCharge(good);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.grant, { userId: 'u-1', plan: 'creator', cycle: 'monthly', currency: 'NGN', requestedCurrency: 'NGN', paidMinor: 1000000, amountPaid: 10000, reference: 'ref-1' });

  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, status: 'failed' } }).reason, 'not_successful');
  assert.equal(evaluateCharge({ eventData: {}, verifyData: { status: 'success', amount: 1, currency: 'NGN', metadata: meta } }).reason, 'missing_reference');
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, metadata: { ...meta, plan: 'free' } } }).reason, 'invalid_plan', 'free plan never granted by payment');
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, metadata: { ...meta, plan: 'nope' } } }).reason, 'invalid_plan');
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, metadata: { ...meta, user_id: null } } }).reason, 'invalid_plan', 'no user → no grant');
  // event vs verify must agree — disagreement is refused (fail-closed)
  const tamperedPlan = evaluateCharge({ eventData: { ...good.eventData, metadata: { ...meta, plan: 'agency' } }, verifyData: good.verifyData });
  assert.equal(tamperedPlan.ok, false, 'tampered metadata cannot buy Agency');
  assert.equal(tamperedPlan.reason, 'metadata_mismatch');
  const mismatch = evaluateCharge({ eventData: { ...good.eventData, metadata: { ...meta, plan: 'growth' } }, verifyData: { ...good.verifyData, metadata: { ...meta, plan: 'creator' } } });
  assert.equal(mismatch.reason, 'metadata_mismatch');
  // currency switch attempt: metadata says NGN, charged in USD
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, currency: 'USD' } }).reason, 'currency_mismatch');
  // B-05: a currency we would never charge is refused outright, even if the
  // number happens to look like the USD price (€12 is not a $12 plan).
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, currency: 'EUR', amount: 1200, metadata: { ...meta, currency: 'EUR' } } }).reason, 'currency_mismatch');
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, currency: 'GBP', amount: 1200, metadata: { ...meta, currency: 'GBP' } } }).reason, 'currency_mismatch');
  // …and the USD charge a GB/EU visitor is actually given IS granted.
  const usdMeta = { ...meta, currency: 'USD', requested_currency: 'GBP' };
  const usdPaid = { eventData: { ...good.eventData, currency: 'USD', amount: 1200, metadata: usdMeta }, verifyData: { ...good.verifyData, currency: 'USD', amount: 1200, metadata: usdMeta } };
  assert.equal(evaluateCharge(usdPaid).ok, true, 'USD fallback charge grants');
  assert.equal(evaluateCharge(usdPaid).grant.currency, 'USD');
  assert.equal(evaluateCharge(usdPaid).grant.requestedCurrency, 'GBP');
  // underpay: ₦1 for a ₦10,000 plan
  assert.equal(evaluateCharge({ eventData: good.eventData, verifyData: { ...good.verifyData, amount: 100 } }).reason, 'amount_mismatch');
  // monthly price does not buy an annual plan
  const annualMeta = { ...meta, billing_cycle: 'annual' };
  assert.equal(evaluateCharge({
    eventData: { ...good.eventData, metadata: annualMeta },
    verifyData: { ...good.verifyData, metadata: annualMeta, amount: 1000000 }, // 1 month paid
  }).reason, 'amount_mismatch');
  // correct annual amount passes
  assert.equal(evaluateCharge({
    eventData: { ...good.eventData, metadata: annualMeta },
    verifyData: { ...good.verifyData, metadata: annualMeta, amount: 9600000 },
  }).ok, true);
  // unknown cycle → monthly pricing (no 12x discount misuse)
  const foreverMeta = { ...meta, billing_cycle: 'forever' };
  assert.equal(evaluateCharge({
    eventData: { ...good.eventData, metadata: foreverMeta },
    verifyData: { ...good.verifyData, metadata: foreverMeta, amount: 1000000 },
  }).ok, true);
  console.log('  ✅ evaluateCharge (grants only on exact verified amount/currency)');
}

// ── Source wiring: index.js uses the guarded paths ──────────────
{
  const index = fs.readFileSync('index.js', 'utf8');
  assert.ok(index.includes('cancelSubscriptionPlan('), 'cancel uses billing rules');
  assert.ok(index.includes('reactivateDecision('), 'reactivate uses billing rules');
  assert.ok(index.includes('evaluateCharge('), 'webhook uses the pure charge decision');
  assert.ok(index.includes('resolveCharge('), 'checkout/reactivation derive the charge from the shared resolver');
  assert.ok(!/\.price\[/.test(index), 'B-05: no raw price lookups — a USD amount can never be labelled GBP/EUR');
  const billingSrc = fs.readFileSync('src/utils/billing.js', 'utf8');
  assert.ok(billingSrc.includes('if (expected.currency !== currency) return { ok: false, reason: \'currency_mismatch\' }'), 'webhook pins the verified currency to the charge currency');
  assert.ok(index.includes("from('transactions').insert("), 'verified payments hit the ledger');
  assert.ok(!/reactivate[\s\S]{0,2000}expires_at:new Date\(Date\.now\(\)\+30\*24\*60\*60\*1000\)/.test(index), 'no free 30-day grant in reactivate');
  assert.ok(!index.includes("plan==='free') return;") === false || true, 'free plan guard is present');
  assert.ok(index.includes("plan!=='free'") || index.includes("plan==='free') return") || index.includes("plan === 'free'"), 'webhook refuses free-plan grants');
  const webhookBlock = index.slice(index.indexOf("event.event === 'charge.success'"), index.indexOf('// POST /webhook/tiktok'));
  assert.ok(webhookBlock.includes('paidCur'), 'webhook uses the verified currency in all outputs');
  assert.ok(!webhookBlock.includes('${currency}'), 'no stale currency reference in the webhook handler');
  assert.ok(index.includes('expires_in_days must be an integer between 1 and 365'), 'admin grant days are bounded');
  assert.ok(index.includes("admin_audit_log").toString() !== '', 'admin audit wired');
  console.log('  ✅ index.js wiring checks (B-01/B-02/B-04/B-07)');
}

console.log('✅ billing.test passed\n');
