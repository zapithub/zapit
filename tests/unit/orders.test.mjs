// Phase 8.2 — W-01: the in-chat order + payment loop
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeText, detectOrderIntent, parseQuantity, matchProduct, extractAddress,
  nextMissingSlot, questionFor, applyMessageToDraft, draftExpired, computeOrderTotals,
  orderPaymentReference, validatePaymentReference, buildOrderSummary, paymentInstructions,
  orderConfirmedMessage, evaluateOrderPayment, isCancelKeyword, isOrderMenuKeyword,
  DRAFT_TTL_MS, MAX_DRAFT_TURNS, DRAFT_ACTIVE_MS, isDraftActive,
} from '../../src/utils/orders.js';

console.log('▶ orders.test (Phase 8.2 — W-01)');

const INDEX = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const MIGRATION = fs.readFileSync(new URL('../../supabase/migrations/20261012_phase8_02_order_loop.sql', import.meta.url), 'utf8');

const NOW = new Date('2026-10-01T10:00:00.000Z');
const PRODUCTS = [
  { id: 'p1', name: 'Rice', price: 2500, currency: 'NGN' },
  { id: 'p2', name: 'Beans', price: 1800, currency: 'NGN' },
  { id: 'p3', name: 'Golden Penny Semovita', price: 3200, currency: 'NGN' },
  { id: 'p4', name: 'Red Palm Oil', price: 6000, currency: 'NGN' },
];

// ── normalisation + intent ──────────────────────────────────────
{
  assert.equal(normalizeText('  HELLO,   World!! '), 'hello world');
  assert.equal(detectOrderIntent('I want to buy 2 bags of rice'), true);
  assert.equal(detectOrderIntent('how much is beans?'), true);
  assert.equal(detectOrderIntent('do you deliver to Wuse?'), true);
  assert.equal(detectOrderIntent('what is your return policy'), false);
  assert.equal(detectOrderIntent(''), false);
  assert.equal(isOrderMenuKeyword('order'), true);
  assert.equal(isOrderMenuKeyword('I want to order rice'), false);   // not a bare menu word
  assert.equal(isCancelKeyword('cancel'), true);
  assert.equal(isCancelKeyword('Cancel order'), true);
  assert.equal(isCancelKeyword('please cancel the meeting tomorrow'), false);
  assert.equal(isCancelKeyword('cancellation policy?'), false);
}

// ── quantity: digits, x-prefix, unit suffixes, words ─────────────
{
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity('x3'), 3);
  assert.equal(parseQuantity('2 bags of rice'), 2);
  assert.equal(parseQuantity('12 crates'), 12);
  assert.equal(parseQuantity('two'), 2);
  assert.equal(parseQuantity('a dozen'), 12);
  assert.equal(parseQuantity('give me 5'), 5);
  assert.equal(parseQuantity('hello there'), null);
  assert.equal(parseQuantity('my number is 08031234567'), null);   // never a phone number
  assert.equal(parseQuantity('I will pay 250000'), null);          // never a price
  assert.equal(parseQuantity('0'), null);
}

// ── product matching ────────────────────────────────────────────
{
  assert.equal(matchProduct('i want 2 bags of rice', PRODUCTS).product.id, 'p1');
  assert.equal(matchProduct('beans please', PRODUCTS).product.id, 'p2');
  assert.equal(matchProduct('golden penny', PRODUCTS).product.id, 'p3');
  assert.equal(matchProduct('do you have orange juice', PRODUCTS), null);
  // A generic word that is only part of a longer name is not a match on its own.
  assert.equal(matchProduct('oil', PRODUCTS), null);
  assert.equal(matchProduct('red palm oil', PRODUCTS).product.id, 'p4');
  assert.equal(matchProduct('anything', []), null);
}

// ── address extraction ──────────────────────────────────────────
{
  assert.equal(extractAddress('deliver to 12 Adeola Street, Lekki'), '12 Adeola Street, Lekki');
  assert.equal(extractAddress('address: 5 Wuse II, Abuja'), '5 Wuse II, Abuja');
  assert.equal(extractAddress('hi'), null);
  assert.equal(extractAddress('!!'), null);
}

// ── slot filling: multi-turn capture ────────────────────────────
{
  // turn 1: intent + product + quantity → only the address is missing
  const t1 = applyMessageToDraft({ text: 'i want 2 bags of rice', products: PRODUCTS, now: NOW });
  assert.equal(t1.draft.product_name, 'Rice');
  assert.equal(t1.draft.quantity, 2);
  assert.equal(t1.draft.unit_price, 2500);
  assert.equal(nextMissingSlot(t1.draft), 'address');
  assert.match(questionFor('address'), /delivery address/i);

  // turn 2: the free-form reply is the address → complete
  const t2 = applyMessageToDraft({ text: '12 Adeola Street, Lekki', draft: t1.draft, products: PRODUCTS, now: NOW });
  assert.equal(t2.draft.delivery_address, '12 Adeola Street, Lekki');
  assert.equal(nextMissingSlot(t2.draft), null);

  // one-shot: everything in one message
  const one = applyMessageToDraft({ text: 'order 3 beans, deliver to 5 Wuse II, Abuja', products: PRODUCTS, now: NOW });
  assert.equal(one.draft.product_name, 'Beans');
  assert.equal(one.draft.quantity, 3);
  assert.equal(one.draft.delivery_address, '5 Wuse II, Abuja');
  assert.equal(nextMissingSlot(one.draft), null);

  // single-product shop: naming the product is optional when intent is clear
  const solo = applyMessageToDraft({ text: 'i want to buy 2', products: [PRODUCTS[0]], now: NOW });
  assert.equal(solo.draft.product_name, 'Rice');
  assert.equal(solo.draft.quantity, 2);

  // ask-product path
  const ask = applyMessageToDraft({ text: 'i want to order something', products: PRODUCTS, now: NOW });
  assert.equal(nextMissingSlot(ask.draft), 'product');
  assert.match(questionFor('product'), /which item/i);

  // cancel clears the draft
  const cancelled = applyMessageToDraft({ text: 'cancel', draft: t1.draft, products: PRODUCTS, now: NOW });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.draft, null);

  // turns increment, and a draft that ran too long is expired
  assert.equal(t1.draft.turns, 1);
  assert.equal(draftExpired(t1.draft, NOW), false);
  const old = { ...t1.draft, updated_at: new Date(NOW.getTime() - DRAFT_TTL_MS - 1000).toISOString() };
  assert.equal(draftExpired(old, NOW), true);
  const chatty = { ...t1.draft, turns: MAX_DRAFT_TURNS + 1 };
  assert.equal(draftExpired(chatty, NOW), true);
  assert.equal(draftExpired(null, NOW), true);

  // "active" is narrower than "resumable": a 20-minute-old draft no longer
  // hijacks an unrelated support question.
  assert.equal(isDraftActive(t1.draft, NOW), true);
  const stale = { ...t1.draft, updated_at: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString() };
  assert.equal(isDraftActive(stale, NOW), false);
  assert.equal(draftExpired(stale, NOW), false);
  assert.equal(isDraftActive(null, NOW), false);
}

// ── money ───────────────────────────────────────────────────────
{
  const t = computeOrderTotals({ unitPrice: 2500, quantity: 2, deliveryFee: 500 });
  assert.deepEqual(t, { subtotal: 5000, delivery_fee: 500, total: 5500, minor: 550000 });
  const floaty = computeOrderTotals({ unitPrice: 0.1, quantity: 3 });
  assert.equal(floaty.total, 0.3);
  assert.equal(floaty.minor, 30);
  const free = computeOrderTotals({ unitPrice: 1800, quantity: 1, deliveryFee: 0 });
  assert.equal(free.total, 1800);
}

// ── payment references ──────────────────────────────────────────
{
  const ref = orderPaymentReference('ZAP-ABC123-4F', () => 0.5);
  assert.match(ref, /^zapord_ZAPABC1234F_/);
  assert.ok(validatePaymentReference(ref));
  assert.equal(ref.length <= 60, true);
  const a = orderPaymentReference('ZAP-1'), b = orderPaymentReference('ZAP-1');
  assert.notEqual(a, b);                                   // retries never collide
  assert.equal(validatePaymentReference('ab'), false);
  assert.equal(validatePaymentReference('has space'), false);
  assert.equal(validatePaymentReference(null), false);
}

// ── the messages the customer sees ──────────────────────────────
{
  const summary = buildOrderSummary({
    draft: { product_name: 'Rice', quantity: 2, delivery_address: '12 Adeola Street' },
    orderNumber: 'ZAP-ABC-1F', totals: { subtotal: 5000, delivery_fee: 500, total: 5500 }, currency: 'NGN',
  });
  assert.match(summary, /Order ZAP-ABC-1F/);
  assert.match(summary, /Rice × 2/);
  assert.match(summary, /Total: NGN 5,500/);
  assert.match(summary, /12 Adeola Street/);

  const online = paymentInstructions({ provider: 'paystack', amount: 5500, currency: 'NGN', link: 'https://pay.test/x', orderNumber: 'ZAP-ABC-1F', reference: 'zapord_x' });
  assert.match(online, /https:\/\/pay\.test\/x/);
  const bank = paymentInstructions({ provider: 'bank_transfer', amount: 5500, currency: 'NGN', orderNumber: 'ZAP-ABC-1F', reference: 'zapord_x', bankDetails: 'GTBank\n0123456789\nZAPIT Ltd' });
  assert.match(bank, /GTBank/);
  assert.match(bank, /zapord_x/);
  const manual = paymentInstructions({ provider: 'manual', amount: 5500, currency: 'NGN', orderNumber: 'ZAP-ABC-1F' });
  assert.match(manual, /recorded ZAP-ABC-1F/);
  assert.match(orderConfirmedMessage('ZAP-ABC-1F'), /Payment received for order ZAP-ABC-1F/);
}

// ── the gateway decision: only OUR amounts, in OUR currency ────
{
  const order = {
    order_number: 'ZAP-ABC-1F', payment_status: 'pending', status: 'pending',
    payment_reference: 'zapord_ABC_123456', payment_currency: 'NGN',
    payment_amount: 5500, payment_amount_minor: 550000, total: 5500, currency: 'NGN',
  };
  const good = { reference: 'zapord_ABC_123456', status: 'success', amount: 550000, currency: 'NGN' };
  assert.deepEqual(evaluateOrderPayment({ order, verifyData: good }), { ok: true, reason: 'ok', paidMinor: 550000 });
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, amount: 550001 } }).ok, true);   // 1-minor tolerance
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, amount: 550100 } }).reason, 'amount_mismatch');
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, currency: 'GHS' } }).reason, 'currency_mismatch');
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, status: 'failed' } }).reason, 'not_successful');
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, reference: 'zapord_OTHER_999' } }).reason, 'reference_mismatch');
  assert.equal(evaluateOrderPayment({ order: { ...order, payment_status: 'paid' }, verifyData: good }).reason, 'already_paid');
  assert.equal(evaluateOrderPayment({ order, verifyData: { ...good, reference: undefined }, eventData: {} }).reason, 'missing_reference');
  assert.equal(evaluateOrderPayment({ order: null, verifyData: good }).reason, 'order_not_found');
  assert.equal(evaluateOrderPayment({ order, verifyData: null, eventData: null }).reason, 'missing_reference');
  // falls back to amount × 100 when the minor column is absent
  const legacy = { ...order, payment_amount_minor: null };
  assert.equal(evaluateOrderPayment({ order: legacy, verifyData: good }).ok, true);
  // the event payload alone is never enough — the verify call decides
  assert.equal(evaluateOrderPayment({ order, verifyData: { status: 'success', reference: order.payment_reference, currency: 'NGN' } }).reason, 'amount_missing');
}

// ── the migration carries the loop's storage ────────────────────
{
  for (const col of ['items', 'delivery_address', 'delivery_fee', 'payment_provider', 'payment_reference',
    'payment_link', 'payment_currency', 'payment_amount', 'payment_amount_minor',
    'payment_requested_at', 'payment_verified_at', 'gateway_response', 'source', 'updated_at']) {
    assert.ok(MIGRATION.includes(`ADD COLUMN IF NOT EXISTS ${col}`), `orders.${col} must be added`);
  }
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS order_drafts/);
  assert.match(MIGRATION, /UNIQUE \(user_id, contact_id\)/);
  assert.match(MIGRATION, /idx_orders_payment_reference/);
  assert.match(MIGRATION, /prune_order_drafts/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
}

// ── wiring: the loop is actually reachable ──────────────────────
{
  assert.ok(INDEX.includes("from './src/utils/orders.js'"), 'orders utils are imported');
  // the audit finding itself: generateOrderNumber must have a call site
  assert.ok(/createOrderFromDraft[\s\S]{0,900}generateOrderNumber\(\)/.test(INDEX), 'generateOrderNumber() is called when an order is created');
  assert.match(INDEX, /async function handleOrderFlow\(/);
  assert.match(INDEX, /await handleOrderFlow\(/);
  assert.match(INDEX, /async function settleOrderCharge\(/);
  assert.match(INDEX, /await settleOrderCharge\(event\)/);
  assert.match(INDEX, /async function markOrderPaid\(/);
  assert.match(INDEX, /evaluateOrderPayment\(\{ order, verifyData/);
  assert.match(INDEX, /async function initializeOrderPayment\(/);
  // the tenant's own key — never the platform key — authorises an order charge
  assert.match(INDEX, /safeDecryptValue\(settings\?\.paystack_secret_key\)/);
  assert.ok(INDEX.includes("app.post('/whatsapp/orders/:id/payment-link'"));
  assert.ok(INDEX.includes("app.post('/whatsapp/orders/:id/verify-payment'"));
  assert.ok(INDEX.includes("source: 'whatsapp'"));
  assert.ok(INDEX.includes('isChargeableCurrency(currency)'));
  assert.ok(INDEX.includes("from('order_drafts')"));
  // reply quota accounting stays intact
  assert.ok(INDEX.includes('reply_count:(businessSettings.reply_count||0)+1'));
}

console.log('✅ orders.test passed');
