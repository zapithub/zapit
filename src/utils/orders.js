// ────────────────────────────────────────────────────────────────
// ZAPIT — WhatsApp order + payment loop (Phase 8.2 — W-01)
//
// The audit's biggest functional gap: `generateOrderNumber()` existed but was
// never called — there was no way for a customer to actually place an order in
// chat, and a tenant's `paystack_secret_key` was never used. This module is the
// pure brain of that loop: intent, product matching, slot filling, totals,
// payment references, the messages we send, and the rule that decides whether a
// gateway callback may mark an order paid. All I/O stays in index.js.
// ────────────────────────────────────────────────────────────────

/** How long a half-finished draft is kept before we start over. */
export const DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** A draft may take at most this many customer messages before we reset it. */
export const MAX_DRAFT_TURNS = 12;

/**
 * How long a draft keeps steering the conversation. A customer who ordered two
 * hours ago and now asks a support question must get an answer, not "how many?".
 */
export const DRAFT_ACTIVE_MS = 15 * 60 * 1000;

export const ORDER_KEYWORDS = [
  'buy', 'order', 'purchase', 'i want', 'i need', "i'll take", 'ill take', 'i will take',
  'how much', 'price', 'cost', 'do you have', 'available', 'send me', 'deliver',
];

export const CANCEL_KEYWORDS = ['cancel', 'cancel order', 'stop order', 'forget it', 'never mind', 'nevermind'];
export const ORDER_MENU_KEYWORDS = ['order', 'buy', 'shop', 'place order', 'start order', 'menu'];

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1, single: 1, dozen: 12, half: 0.5,
};

/** Lower-case, punctuation-light, single-spaced — used for all matching. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCancelKeyword(text) {
  const norm = normalizeText(text);
  return norm.length > 0 && norm.length <= 30 && CANCEL_KEYWORDS.includes(norm);
}

export function isOrderMenuKeyword(text) {
  const norm = normalizeText(text);
  return norm.length > 0 && norm.length <= 30 && ORDER_MENU_KEYWORDS.includes(norm);
}

/** Does this message look like an order/price enquiry at all? */
export function detectOrderIntent(text) {
  const norm = normalizeText(text);
  if (!norm) return false;
  if (parseQuantity(norm) && /(buy|order|take|want|need|send|give|get)/.test(norm)) return true;
  return ORDER_KEYWORDS.some(k => norm.includes(k));
}

/**
 * Quantity from digits ("3", "x3", "2 bags") or number words ("two").
 * Returns a positive integer/float or null. Never guesses from prices.
 */
export function parseQuantity(text) {
  const norm = normalizeText(text);
  if (!norm) return null;
  // Multi-word quantities first: "half a dozen" is 6, not "a" = 1.
  if (/\bhalf\s+(?:a\s+)?dozen\b/.test(norm)) return 6;
  if (/\b(?:a|an|one)\s+dozen\b/.test(norm)) return 12;
  const digit = norm.match(/(?:^|\s)(?:x\s*)?(\d{1,4})(?:\s*(?:x|pcs?|pieces?|bags?|crates?|cartons?|packs?|units?|kg|dozens?))?(?:\s|$)/);
  if (digit) {
    const n = Number(digit[1]);
    if (Number.isFinite(n) && n > 0 && n <= 10000) return n;
  }
  const words = norm.split(/\s+/);
  for (const w of words) {
    if (NUMBER_WORDS[w] !== undefined) return NUMBER_WORDS[w];
    const m = w.match(/^(\d{1,4})x$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Best product match for a message.
 * Token overlap against the product name, with an exact-name shortcut.
 * @returns {{product: object, score: number}|null}
 */
export function matchProduct(text, products = []) {
  const norm = normalizeText(text);
  if (!norm || !Array.isArray(products) || !products.length) return null;
  let best = null;
  for (const product of products) {
    const name = normalizeText(product?.name);
    if (!name) continue;
    if (norm.includes(name)) {
      return { product, score: 1 };
    }
    const nameTokens = name.split(' ').filter(t => t.length > 2);
    if (!nameTokens.length) continue;
    const matched = nameTokens.filter(t => norm.includes(t)).length;
    const score = matched / nameTokens.length;
    // A single generic token ("bag", "rice") is not enough on its own unless the
    // name is a single word; require the majority of the name to appear.
    if (score >= 0.5 && score > (best?.score || 0)) best = { product, score };
  }
  return best;
}

/**
 * Everything after an address cue (explicit), or the whole message (implicit).
 * The caller decides whether an implicit match is plausible — a message that
 * just supplied the product is not an address.
 * @returns {{value: string|null, explicit: boolean}}
 */
export function extractAddressDetail(text) {
  const raw = String(text || '').trim();
  if (!raw) return { value: null, explicit: false };
  const cue = raw.match(/(?:address|deliver(?:y)?(?:\s+address)?(?:\s+to)?|drop(?: it)?\s+(?:off\s+at|at|to)|located at|my place is)\s*[:\-]?\s*(.+)$/i);
  const candidate = (cue ? cue[1] : raw).trim();
  if (candidate.length < 6) return { value: null, explicit: false };
  if (!/[\p{L}\p{N}]/u.test(candidate)) return { value: null, explicit: false };
  return { value: candidate.slice(0, 400), explicit: !!cue };
}

/** Everything after an address cue, or null. */
export function extractAddress(text) {
  return extractAddressDetail(text).value;
}

/** The next slot the draft still needs, or null when it is ready. */
export function nextMissingSlot(draft) {
  if (!draft?.product_name) return 'product';
  const qty = Number(draft?.quantity || 0);
  if (!Number.isFinite(qty) || qty <= 0) return 'quantity';
  if (!draft?.delivery_address) return 'address';
  return null;
}

export function questionFor(slot, { product } = {}) {
  switch (slot) {
    case 'product':  return 'Sure! Which item would you like to order?';
    case 'quantity': return `How many ${product?.name || 'would you like'}?`;
    case 'address':  return 'Great — what is the delivery address (street, area, city)?';
    default:         return null;
  }
}

/**
 * Fold one customer message into the draft.
 * Pure: returns the next draft plus what changed, so the caller can decide what
 * to persist and what to ask next.
 * @returns {{draft: object|null, changed: boolean, cancelled: boolean}}
 */
export function applyMessageToDraft({ text, draft = null, products = [], now = new Date() } = {}) {
  if (isCancelKeyword(text)) return { draft: null, changed: true, cancelled: true };

  let next = draft ? { ...draft } : { turns: 0, created_at: now.toISOString() };
  next.turns = Number(next.turns || 0) + 1;
  next.updated_at = now.toISOString();

  const quantity = parseQuantity(text);
  const match    = matchProduct(text, products);
  const addr     = extractAddressDetail(text);
  let   supplied = false;

  if (match && !next.product_name) {
    next.product_id   = match.product.id ?? null;
    next.product_name = match.product.name ?? null;
    next.unit_price   = Number(match.product.price ?? next.unit_price ?? 0);
    next.currency     = String(match.product.currency || next.currency || 'NGN').toUpperCase();
    supplied = true;
  } else if (!next.product_name && products.length === 1 && detectOrderIntent(text)) {
    // Single-product shop: the customer does not have to name the product.
    const only = products[0];
    next.product_id   = only.id ?? null;
    next.product_name = only.name ?? null;
    next.unit_price   = Number(only.price ?? 0);
    next.currency     = String(only.currency || next.currency || 'NGN').toUpperCase();
    supplied = true;
  }

  if (quantity && Number(next.quantity || 0) <= 0) { next.quantity = quantity; supplied = true; }
  // A free-form reply *is* the address once the product and quantity are known —
  // unless this very message is what supplied them (then only an explicit
  // "deliver to …" counts, so "2 bags of rice" is never an address).
  if (!next.delivery_address && next.product_name && Number(next.quantity || 0) > 0) {
    if (!supplied || addr.explicit) next.delivery_address = addr.value;
  }

  return { draft: next, changed: true, cancelled: false };
}

/** Is this draft still steering the chat (vs merely resumable)? */
export function isDraftActive(draft, now = new Date()) {
  if (!draft) return false;
  const updated = draft.updated_at || draft.created_at;
  const t = updated ? new Date(updated).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= DRAFT_ACTIVE_MS;
}

export function draftExpired(draft, now = new Date()) {
  if (!draft) return true;
  if (Number(draft.turns || 0) > MAX_DRAFT_TURNS) return true;
  const updated = draft.updated_at || draft.created_at;
  const t = updated ? new Date(updated).getTime() : NaN;
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > DRAFT_TTL_MS;
}

/** Money: keep 2-decimal discipline and hand Paystack minor units. */
export function computeOrderTotals({ unitPrice = 0, quantity = 0, deliveryFee = 0 } = {}) {
  const price = Number(unitPrice) || 0;
  const qty   = Number(quantity) || 0;
  const fee   = Number(deliveryFee) || 0;
  const subtotal = Math.round(price * qty * 100) / 100;
  const total    = Math.round((subtotal + fee) * 100) / 100;
  return { subtotal, delivery_fee: fee, total, minor: Math.round(total * 100) };
}

const REFERENCE_RE = /^[A-Za-z0-9._-]{6,100}$/;

export function validatePaymentReference(reference) {
  return typeof reference === 'string' && REFERENCE_RE.test(reference);
}

/**
 * Our own Paystack reference for an order. Deterministic prefix (so support can
 * find the order) + randomness (so a retry can never collide), and always
 * within Paystack's allowed charset/length.
 */
export function orderPaymentReference(orderNumber, random = Math.random) {
  const base = String(orderNumber || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'ORDER';
  const rand = Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
  return `zapord_${base}_${rand}`.slice(0, 60);
}

/** The order summary the customer receives before paying. */
export function buildOrderSummary({ draft, orderNumber, totals, currency }) {
  const lines = [
    `🧾 *Order ${orderNumber}*`,
    `• ${draft.product_name} × ${draft.quantity}`,
    `Subtotal: ${currency} ${totals.subtotal.toLocaleString('en-US')}`,
  ];
  if (totals.delivery_fee > 0) lines.push(`Delivery: ${currency} ${totals.delivery_fee.toLocaleString('en-US')}`);
  lines.push(`*Total: ${currency} ${totals.total.toLocaleString('en-US')}*`);
  lines.push(`📍 ${draft.delivery_address}`);
  return lines.join('\n');
}

/** What we send so the customer can actually pay. */
export function paymentInstructions({ provider, amount, currency, link, bankDetails, orderNumber, reference, businessName }) {
  const amountLine = `${currency} ${Number(amount).toLocaleString('en-US')}`;
  if (provider === 'paystack' && link) {
    return `💳 Pay ${amountLine} securely here:\n${link}\n\nReference: ${orderNumber}. We'll confirm as soon as payment lands.`;
  }
  if (provider === 'bank_transfer' && bankDetails) {
    const detailLines = String(bankDetails).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4);
    return [
      `🏦 Please transfer *${amountLine}* to:`,
      ...detailLines,
      `Use *${reference || orderNumber}* as the transfer reference, then reply PAID.`,
    ].join('\n');
  }
  return `We've recorded ${orderNumber} (${amountLine}) for ${businessName || 'the business'}. Someone will confirm the payment details with you shortly.`;
}

export function orderConfirmedMessage(orderNumber, extra = '') {
  return `✅ Payment received for order ${orderNumber}! Thank you 🙏 We're processing it now.${extra ? `\n${extra}` : ''}`;
}

/**
 * May this gateway payload mark the order paid?
 * The order's own amount/currency (what we asked for) is the reference — never
 * the payload's numbers alone, and never a different order's reference.
 * @returns {{ok: boolean, reason: string, paidMinor?: number}}
 */
export function evaluateOrderPayment({ order, verifyData, eventData } = {}) {
  const data  = verifyData || {};
  const event = eventData || {};
  if (!order) return { ok: false, reason: 'order_not_found' };
  const reference = data.reference || event.reference || null;
  if (!reference) return { ok: false, reason: 'missing_reference' };
  if (order.payment_reference && String(reference) !== String(order.payment_reference)) return { ok: false, reason: 'reference_mismatch' };
  if (data.status !== 'success') return { ok: false, reason: 'not_successful' };
  if (order.payment_status === 'paid') return { ok: false, reason: 'already_paid' };

  const currency = String(data.currency || event.currency || '').toUpperCase();
  const expectedCurrency = String(order.payment_currency || order.currency || '').toUpperCase();
  if (expectedCurrency && currency !== expectedCurrency) return { ok: false, reason: 'currency_mismatch' };

  const paidMinor = Number(data.amount ?? event.amount);
  const expectedMinor = order.payment_amount_minor != null
    ? Number(order.payment_amount_minor)
    : Math.round(Number(order.payment_amount || order.total || 0) * 100);
  if (!Number.isFinite(paidMinor) || !Number.isFinite(expectedMinor)) return { ok: false, reason: 'amount_missing' };
  if (Math.abs(paidMinor - expectedMinor) > 1) return { ok: false, reason: 'amount_mismatch' };

  return { ok: true, reason: 'ok', paidMinor };
}
