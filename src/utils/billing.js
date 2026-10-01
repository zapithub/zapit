// ────────────────────────────────────────────────────────────────
// ZAPIT — Subscription billing rules
// Phase 6.4 (B-01, B-02, B-04, B-07): no plan is ever granted without a
// verified payment, cancellations keep access until period end, and the
// amount/currency actually paid must match the plan price.
//
// Pure functions only — index.js wires them, tests exercise them directly.
// ────────────────────────────────────────────────────────────────
import { PLAN_LIMITS } from '../config/plans.js';

export const BILLING_CYCLES = {
  monthly: { days: 30, multiplier: 1 },
  annual:  { days: 365, multiplier: 9.6 }, // 12 months at 20% off (exact decimal)
};

/** Any unknown cycle falls back to monthly (never silently grants a longer period). */
export function normalizeCycle(cycle) {
  return BILLING_CYCLES[cycle] ? cycle : 'monthly';
}

export function cycleDays(cycle) {
  return BILLING_CYCLES[normalizeCycle(cycle)].days;
}

/** Plan price in `currency` (falls back to USD, matching the payment initializer). */
export function planPrice({ plan, currency }) {
  const p = plan && plan !== 'free' ? PLAN_LIMITS[plan] : null;
  if (!p) return null;
  return p.price?.[currency] ?? p.price?.USD ?? null;
}

/**
 * Expected charge in minor units (kobo/cents/pesewas), the same units Paystack
 * uses in `data.amount` — derived from the plan table, never from the client.
 */
export function expectedAmountMinor({ plan, currency, billingCycle = 'monthly' }) {
  const unit = planPrice({ plan, currency });
  if (unit == null) return null;
  const total = unit * BILLING_CYCLES[normalizeCycle(billingCycle)].multiplier;
  return Math.round(total * 100);
}

/**
 * Compare what was actually paid with what the plan costs.
 * @returns {{ok: boolean, reason: 'ok'|'amount_missing'|'currency_missing'|'amount_mismatch'}}
 */
export function verifyPaymentAmount({ paidMinor, currency, expectedMinor, toleranceMinor = 1 }) {
  if (!Number.isFinite(paidMinor) || !Number.isFinite(expectedMinor)) return { ok: false, reason: 'amount_missing' };
  if (typeof currency !== 'string' || !currency.trim()) return { ok: false, reason: 'currency_missing' };
  if (Math.abs(paidMinor - expectedMinor) > toleranceMinor) return { ok: false, reason: 'amount_mismatch' };
  return { ok: true, reason: 'ok' };
}

/**
 * B-02: cancelling keeps access until the paid period ends.
 * @returns {{status:string, cancelled_at:string, cancel_at:string|null, auto_renew:boolean, access_until:string|null}}
 */
export function cancelSubscriptionPlan(subscription, now = new Date()) {
  const nowIso = now.toISOString();
  const expires = subscription?.expires_at ? new Date(subscription.expires_at) : null;
  const inPeriod = expires && !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
  if (!inPeriod) {
    // No paid time left (or a free plan) → cancel immediately.
    return { status: 'cancelled', cancelled_at: nowIso, cancel_at: null, auto_renew: false, access_until: null };
  }
  return {
    status: 'active',                      // keeps plan limits until expires_at
    cancelled_at: nowIso,
    cancel_at: expires.toISOString(),      // cron downgrades to free at this point
    auto_renew: false,
    access_until: expires.toISOString(),
  };
}

/**
 * B-01: reactivation rules.
 *  · active row with a pending cancellation, or a cancelled row whose paid period
 *    has not ended → `resume` (keeps the SAME expiry — no free extension).
 *  · anything else → `payment_required` (the caller must start a fresh payment).
 * @returns {{mode:'resume'|'payment_required'|'not_found', access_until?:string|null}}
 */
export function reactivateDecision(subscription, now = new Date()) {
  if (!subscription) return { mode: 'not_found' };
  const expires = subscription.expires_at ? new Date(subscription.expires_at) : null;
  const inPeriod = expires && !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
  if (subscription.status === 'active' && subscription.cancel_at) {
    return { mode: 'resume', access_until: subscription.expires_at || null };
  }
  if (subscription.status === 'active' && !subscription.cancel_at) {
    return { mode: 'already_active', access_until: subscription.expires_at || null };
  }
  if (subscription.status === 'cancelled' && inPeriod) {
    return { mode: 'resume', access_until: subscription.expires_at };
  }
  return { mode: 'payment_required', access_until: null };
}

/**
 * Decide whether a Paystack `charge.success` may grant a plan.
 * Pure function — the webhook must never grant on anything but `{ok:true}`.
 *
 * @param {{eventData?: object, verifyData?: object}} p
 *   eventData  — `event.data` from the signed webhook payload
 *   verifyData — `data` from GET /transaction/verify/:reference (authoritative)
 * @returns {{ok: boolean, reason: string, grant?: {userId, plan, cycle, currency, paidMinor, amountPaid, reference}}}
 */
export function evaluateCharge({ eventData, verifyData } = {}) {
  const event = eventData || {};
  const data  = verifyData || {};
  const meta  = data.metadata || event.metadata || {};
  const reference = data.reference || event.reference || null;
  const userId = meta.user_id || null;
  const plan   = meta.plan || null;
  const cycle  = normalizeCycle(meta.billing_cycle);
  const currency = String(data.currency || event.currency || '').toUpperCase();
  const paidMinor = Number(data.amount ?? event.amount);

  if (!reference) return { ok: false, reason: 'missing_reference' };
  if (data.status !== 'success') return { ok: false, reason: 'not_successful' };
  if (!userId || !plan || plan === 'free' || !PLAN_LIMITS[plan]) return { ok: false, reason: 'invalid_plan' };
  // The signed webhook and Paystack's verify endpoint must tell the same story.
  const vmeta = data.metadata;
  if (vmeta && event.metadata) {
    if ((vmeta.user_id && event.metadata.user_id && String(vmeta.user_id) !== String(event.metadata.user_id))
      || (vmeta.plan && event.metadata.plan && vmeta.plan !== event.metadata.plan)
      || (vmeta.billing_cycle && event.metadata.billing_cycle && normalizeCycle(vmeta.billing_cycle) !== normalizeCycle(event.metadata.billing_cycle))) {
      return { ok: false, reason: 'metadata_mismatch' };
    }
  }
  if (meta.currency && String(meta.currency).toUpperCase() !== currency) return { ok: false, reason: 'currency_mismatch' };
  const expected = expectedAmountMinor({ plan, currency, billingCycle: cycle });
  const amountOk = verifyPaymentAmount({ paidMinor, currency, expectedMinor: expected });
  if (!amountOk.ok) return { ok: false, reason: amountOk.reason };
  return {
    ok: true,
    reason: 'ok',
    grant: { userId, plan, cycle, currency, paidMinor, amountPaid: paidMinor / 100, reference },
  };
}

/** Fields written when a verified payment activates a plan. */
export function activationFields({ cycle = 'monthly', now = new Date() } = {}) {
  const endIso = new Date(now.getTime() + cycleDays(cycle) * 24 * 60 * 60 * 1000).toISOString();
  return {
    status: 'active',
    starts_at: now.toISOString(),
    expires_at: endIso,
    next_billing_date: endIso,
    auto_renew: true,
    cancel_at: null,
    cancelled_at: null,
  };
}
