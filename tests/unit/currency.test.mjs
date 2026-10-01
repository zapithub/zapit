// Phase 7.4 — B-05: one price resolver; a USD amount never wears a £/€ symbol
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAN_LIMITS, PAYSTACK_CURRENCIES, isChargeableCurrency, resolvePlanPrice, getPricingForLocation, COUNTRY_CURRENCY,
} from '../../src/config/plans.js';
import { planPrice, resolveCharge, expectedAmountMinor, chargeCurrency } from '../../src/utils/billing.js';

console.log('▶ currency.test (Phase 7.4 — B-05)');

// ── Paystack settles exactly these five currencies ───────────────
{
  assert.deepEqual(PAYSTACK_CURRENCIES, ['NGN', 'GHS', 'ZAR', 'KES', 'USD']);
  for (const c of PAYSTACK_CURRENCIES) assert.equal(isChargeableCurrency(c), true);
  for (const c of ['GBP', 'EUR', 'CAD', 'JPY', 'XOF']) assert.equal(isChargeableCurrency(c), false, `${c} is not settleable`);
  assert.equal(isChargeableCurrency('ngn'), true, 'case-insensitive');
  assert.equal(isChargeableCurrency(''), false);
}

// ── countries only ever resolve to a settleable currency ─────────
{
  for (const [country, currency] of Object.entries(COUNTRY_CURRENCY)) {
    if (['GBP', 'EUR'].includes(currency)) continue; // legacy display entries — billing resolves them to USD
    assert.ok(isChargeableCurrency(currency), `${country} → ${currency} must be settleable`);
  }
}

// ── resolvePlanPrice: exact prices stay exact, others become USD ──
{
  const expected = { NGN:10000, GHS:150, KES:1500, ZAR:220, USD:12 };
  for (const [currency, amount] of Object.entries(expected)) {
    const r = resolvePlanPrice('creator', currency);
    assert.equal(r.amount, amount);
    assert.equal(r.currency, currency);
    assert.equal(r.converted, false, `${currency} needs no conversion`);
    assert.equal(r.requested_currency, currency);
  }

  // The B-05 bug: GB/EU visitors were shown a USD number with £/€.
  for (const wanted of ['GBP', 'EUR', 'CAD']) {
    const r = resolvePlanPrice('creator', wanted);
    assert.equal(r.amount, 12, 'charged the USD list price');
    assert.equal(r.currency, 'USD', 'reported as USD — never the unsupported currency');
    assert.equal(r.requested_currency, wanted, 'the request is still traceable');
    assert.equal(r.converted, true);
  }

  assert.equal(resolvePlanPrice('free', 'GBP'), null, 'free is never charged');
  assert.equal(resolvePlanPrice('mystery', 'USD'), null);
  assert.equal(resolvePlanPrice('creator', undefined).currency, 'USD', 'missing currency → USD');

  // Amounts are real numbers from a single table, never strings.
  for (const plan of ['creator', 'growth', 'agency']) {
    for (const c of PAYSTACK_CURRENCIES) {
      assert.equal(typeof resolvePlanPrice(plan, c).amount, 'number');
    }
  }
}

// ── planPrice/chargeCurrency/expectedAmountMinor agree 100% ──────
{
  assert.equal(planPrice({ plan:'creator', currency:'GBP' }), 12, 'billing sees the USD price for GBP');
  assert.equal(planPrice({ plan:'creator', currency:'NGN' }), 10000);
  assert.equal(chargeCurrency({ plan:'growth', currency:'EUR' }), 'USD');
  assert.equal(chargeCurrency({ plan:'growth', currency:'KES' }), 'KES');

  const monthlyGbp = resolveCharge({ plan:'creator', currency:'GBP' });
  assert.equal(monthlyGbp.currency, 'USD');
  assert.equal(monthlyGbp.amount, 12);
  assert.equal(monthlyGbp.amountMinor, 1200, 'Paystack minor units');
  assert.equal(monthlyGbp.requested_currency, 'GBP');
  assert.equal(monthlyGbp.converted, true);

  const annualGbp = resolveCharge({ plan:'creator', currency:'GBP', billingCycle:'annual' });
  assert.equal(annualGbp.billingCycle, 'annual');
  assert.equal(annualGbp.amount, 12 * 9.6);
  assert.equal(annualGbp.amountMinor, 11520);
  assert.equal(annualGbp.currency, 'USD');

  const bogusCycle = resolveCharge({ plan:'creator', currency:'NGN', billingCycle:'decade' });
  assert.equal(bogusCycle.billingCycle, 'monthly', 'unknown cycles never grant a longer period');

  assert.equal(expectedAmountMinor({ plan:'creator', currency:'GBP' }), 1200);
  assert.equal(expectedAmountMinor({ plan:'agency', currency:'EUR', billingCycle:'annual' }), expectedAmountMinor({ plan:'agency', currency:'USD', billingCycle:'annual' }));
  assert.equal(expectedAmountMinor({ plan:'free', currency:'USD' }), null);
  assert.equal(resolveCharge({ plan:'free', currency:'USD' }), null);

  // Webhook verification and the checkout must compute the same numbers.
  for (const plan of ['creator','growth','agency']) {
    for (const currency of ['NGN','GHS','KES','ZAR','USD','GBP','EUR']) {
      const charge = resolveCharge({ plan, currency });
      assert.equal(expectedAmountMinor({ plan, currency }), charge.amountMinor, `${plan}/${currency} parity`);
    }
  }
}

// ── checkout display tells the truth ────────────────────────────
{
  const ng = getPricingForLocation({ country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' });
  assert.equal(ng.plans.creator.currency, 'NGN');
  assert.equal(ng.plans.creator.currency_symbol, '₦');
  assert.equal(ng.plans.creator.currency_converted, false);
  assert.equal(ng.plans.creator.billing_note, null);
  assert.ok(ng.plans.creator.price_formatted.includes('₦'));

  const gb = getPricingForLocation({ country_code:'GB', country_name:'the United Kingdom', city:'London', currency:'GBP', timezone:'Europe/London' });
  assert.equal(gb.plans.creator.currency, 'USD', 'UK visitors are billed in USD');
  assert.equal(gb.plans.creator.currency, 'USD');
  assert.ok(gb.plans.creator.price_formatted.startsWith('$'), 'formatted with the currency actually charged');
  assert.ok(!gb.plans.creator.price_formatted.includes('£'), 'no £ on a USD amount');
  assert.equal(gb.plans.creator.requested_currency, 'GBP');
  assert.equal(gb.plans.creator.currency_converted, true);
  assert.ok(gb.plans.creator.billing_note.includes('USD'), 'the customer is told why');
  assert.equal(gb.plans.creator.price_raw, 12);
  assert.equal(gb.plans.creator.price_annual, Math.round(12 * 12 * 0.8));

  const de = getPricingForLocation({ country_code:'DE', currency:'EUR' });
  assert.equal(de.plans.growth.currency, 'USD');
  assert.equal(de.plans.growth.currency_converted, true);

  const free = getPricingForLocation({ country_code:'GB', currency:'GBP' });
  assert.equal(free.plans.free.price_raw, 0);
  assert.equal(free.plans.free.billing_note, null, 'no billing note on a free plan');

  // Every displayed plan currency must be one we can actually settle.
  for (const plan of Object.values(gb.plans)) {
    assert.ok(PAYSTACK_CURRENCIES.includes(plan.currency), `${plan.name} displays a settleable currency`);
  }
  assert.equal(PLAN_LIMITS.creator.price.USD, 12, 'the price table is untouched');
}

// ── wiring: the API charges what it resolved ─────────────────────
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(!/\.price\[/.test(src), 'no raw price lookups remain in index.js');
  assert.ok(!src.includes('?? data.price.USD'), 'no USD fallback that keeps the wrong label');
  assert.ok(src.includes('const getPricingForLocation = __srcGetPricing'), 'pricing comes from the shared module');
  assert.ok(src.includes('const formatPrice           = __srcFormat'), 'formatting comes from the shared module');
  assert.ok(src.includes('resolveCharge({ plan, currency: requested, billingCycle: billing_cycle })'), 'upgrade resolves the charge once');
  assert.ok(src.includes('currency, requested_currency:charge.requested_currency'), 'the gateway metadata carries both currencies');
  assert.ok(src.includes('currency_converted:charge.converted'), 'the client is told about conversion');
  assert.ok(src.includes('resolveCharge({ plan: sub.plan, currency: requested, billingCycle: cycle })'), 'reactivation uses the same resolver');

  const billing = fs.readFileSync('src/utils/billing.js', 'utf8');
  assert.ok(billing.includes("from '../config/plans.js'") && billing.includes('resolvePlanPrice'), 'billing defers to the plan resolver');
}

console.log('✅ currency.test passed');
