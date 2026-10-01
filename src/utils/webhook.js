// ────────────────────────────────────────────────────────────────
// ZAPIT — WhatsApp / Meta webhook authenticity helpers
// Phase 6.2 (S-05): HMAC-SHA256 signature verification over the exact
// raw body, constant-time verify-token handshake, and replay/idempotency
// claim via webhook_events.
//
// Single source of truth: index.js imports these helpers and the unit
// tests exercise the very same code (no duplicated logic).
// ────────────────────────────────────────────────────────────────
import crypto from 'crypto';

// Meta sends `sha256=<64 hex chars>`; legacy SHA-1 headers are rejected.
const META_SHA256_SIG_RE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Constant-time string comparison.
 * The length short-circuit is safe here: lengths are public (fixed by the
 * HMAC algorithm / header format), contents are not.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

/**
 * Verify Meta's `X-Hub-Signature-256` header against the exact raw request
 * body. The body MUST NOT be re-serialized before this call.
 *
 * @param {Buffer|string} rawBody Raw bytes exactly as received
 * @param {unknown} signatureHeader Value of `X-Hub-Signature-256`
 * @param {unknown} appSecret Meta app secret (`WA_APP_SECRET` / `META_APP_SECRET`)
 * @returns {boolean} true only if the signature matches, in constant time
 */
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length === 0) return false;
  if (typeof signatureHeader !== 'string') return false;
  const match = META_SHA256_SIG_RE.exec(signatureHeader.trim());
  if (!match) return false; // missing / malformed / legacy SHA-1 → reject
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest(); // 32 bytes
  const provided = Buffer.from(match[1], 'hex'); // exactly 32 bytes (64 hex chars)
  if (provided.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(provided, expected); } catch { return false; }
}

/**
 * Verify Meta's GET subscription handshake
 * (`?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`).
 * Fail-closed: an empty/missing expectedToken never verifies.
 *
 * @param {unknown} mode `hub.mode`
 * @param {unknown} token `hub.verify_token`
 * @param {unknown} expectedToken configured `WA_VERIFY_TOKEN`
 * @returns {boolean}
 */
export function verifyWebhookVerifyToken(mode, token, expectedToken) {
  if (mode !== 'subscribe') return false;
  if (typeof expectedToken !== 'string' || expectedToken.length === 0) return false;
  if (typeof token !== 'string' || token.length === 0) return false;
  return timingSafeEqualStr(token, expectedToken);
}

/**
 * Atomically claim a webhook event id (replay/retry protection).
 * Relies on `webhook_events UNIQUE (provider, event_id)` from Phase 4.
 *
 * @param {{from:Function}} db Supabase client (or compatible fake)
 * @param {string} provider e.g. 'whatsapp'
 * @param {string} eventId e.g. WhatsApp `wamid`
 * @param {object|null} payload Optional metadata stored with the claim
 * @returns {Promise<boolean>} true = new delivery (process it),
 *                             false = duplicate (skip)
 *
 * On infrastructure errors we fail open (processing continues): the residual
 * risk is a duplicate reply, not a security breach, and the error is logged.
 */
export async function claimWebhookEvent(db, provider, eventId, payload = null) {
  if (!db || typeof db.from !== 'function') return true;
  if (eventId === undefined || eventId === null || String(eventId) === '') return true;
  try {
    const { error } = await db.from('webhook_events').insert({
      provider, event_id: String(eventId), payload, received_at: new Date().toISOString(),
    });
    if (error) {
      if (error.code === '23505') return false; // unique violation → duplicate delivery
      console.warn('[webhook dedup] claim insert failed:', error.message || error.code);
    }
    return true;
  } catch (e) {
    console.warn('[webhook dedup] claim error:', e.message);
    return true;
  }
}
