// ────────────────────────────────────────────────────────────────
// ZAPIT — Tenant routing for inbound WhatsApp messages
// Phase 6.3 (S-06): deterministic, fail-closed tenant resolution.
//
// WHY THIS EXISTS
// The shared number serves many free-plan tenants. The old code picked
// `connection_method='shared' … .limit(1)` — an arbitrary tenant — so a
// stranger's message could be answered as, and written into, the wrong
// business. Resolution is now explicit:
//
//   1. Dedicated number → the ONE business that owns it (`connection_method='individual'`).
//      More than one match is a data error → refuse (never guess).
//   2. Shared platform number → the business the customer already talked to
//      (`wa_customer_tenant` sticky mapping), or
//      → the business whose `#CODE` the customer prefixed the message with.
//   3. Anything else → no tenant. The caller must not process the message.
//
// Nothing here ever assigns a tenant "just because" it exists.
// ────────────────────────────────────────────────────────────────
import crypto from 'crypto';

// Unambiguous alphabet for codes read aloud/typed on phones (no 0/O/1/I).
export const ROUTE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROUTE_CODE_LENGTH = 6;
const ROUTE_CODE_RE = /^#?([A-Z0-9]{4,10})$/;
const PREFIX_RE = /^\s*#\s*([A-Za-z0-9]{4,10})\b[\s,:;.!?-]*/;

/** Generate a new tenant route code (crypto-strong, no modulo bias in crypto.randomInt). */
export function generateRouteCode(randomInt = crypto.randomInt) {
  let code = '';
  for (let i = 0; i < ROUTE_CODE_LENGTH; i++) code += ROUTE_CODE_ALPHABET[randomInt(ROUTE_CODE_ALPHABET.length)];
  return code;
}

/** Uppercase + validate a code supplied by a user/DB (accepts a leading '#'). */
export function normalizeRouteCode(raw) {
  if (typeof raw !== 'string') return null;
  const m = ROUTE_CODE_RE.exec(raw.trim().toUpperCase());
  return m ? m[1] : null;
}

/**
 * Pull a leading `#CODE` discriminator out of a customer message.
 * Only a message-initial code counts ("#K7F9QA hello" ✅, "order 123" ❌).
 *
 * @returns {{code: string|null, body: string}} body has the code stripped
 */
export function extractRouteCode(text) {
  if (typeof text !== 'string') return { code: null, body: typeof text === 'string' ? text : '' };
  const m = PREFIX_RE.exec(text);
  if (!m) return { code: null, body: text.trim() };
  return { code: m[1].toUpperCase(), body: text.slice(m[0].length).trim() };
}

function rowsOf(result) {
  const data = result?.data;
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

/**
 * Resolve which business (if any) an inbound message belongs to.
 * FAIL-CLOSED: on any ambiguity or unknown sender the returned tenant is null.
 *
 * @param {object}   p
 * @param {object}   p.db                     Supabase-like client (injectable for tests)
 * @param {string}   p.phoneNumberId          Metadata phone_number_id from Meta
 * @param {string}   [p.platformPhoneNumberId] Platform's shared number id
 * @param {string}   [p.customerPhone]        Sender's phone (wa_id / from)
 * @param {string}   [p.messageText]          Message body (may carry #CODE)
 * @returns {Promise<{tenant: object|null, via: string, code: string|null, body: string}>}
 *   via ∈ individual | sticky | code | ambiguous_individual | ambiguous_code |
 *          unknown_code | unmatched | unknown_number | no_db
 */
export async function resolveTenantForInbound({ db, phoneNumberId, platformPhoneNumberId, customerPhone, messageText = '' }) {
  const out = { tenant: null, via: 'unmatched', code: null, body: typeof messageText === 'string' ? messageText : '' };
  if (!db || typeof db.from !== 'function' || !phoneNumberId) { out.via = 'no_db'; return out; }
  const numberId = String(phoneNumberId);

  // ── 1. Dedicated (individual) number ─────────────────────────────
  try {
    const { data } = await db.from('business_settings').select('*')
      .eq('wa_phone_number_id', numberId).eq('connection_method', 'individual').limit(2);
    const rows = rowsOf({ data });
    if (rows.length > 1) { out.via = 'ambiguous_individual'; return out; } // data error → refuse
    if (rows.length === 1) { out.tenant = rows[0]; out.via = 'individual'; return out; }
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'tenant routing: individual lookup failed', error: e.message }));
    return out;
  }

  // ── 2. Shared platform number ────────────────────────────────────
  const isPlatform = platformPhoneNumberId && numberId === String(platformPhoneNumberId);
  if (!isPlatform) { out.via = 'unknown_number'; return out; }

  // 2a. Sticky mapping: this customer has talked to a tenant before.
  if (customerPhone) {
    try {
      const { data: mapRows } = await db.from('wa_customer_tenant').select('user_id')
        .eq('platform_phone_number_id', numberId).eq('customer_phone', String(customerPhone)).limit(1);
      const mapping = rowsOf({ data: mapRows })[0];
      if (mapping?.user_id) {
        const { data: tRows } = await db.from('business_settings').select('*').eq('user_id', mapping.user_id).limit(2);
        const tenants = rowsOf({ data: tRows });
        if (tenants.length === 1) { out.tenant = tenants[0]; out.via = 'sticky'; return out; }
        if (tenants.length > 1) { out.via = 'ambiguous_code'; return out; } // corrupt settings → refuse
      }
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'tenant routing: sticky lookup failed', error: e.message }));
      // fall through to code path — still fail-closed
    }
  }

  // 2b. Discriminator: customer prefixed the message with #CODE.
  const { code, body } = extractRouteCode(out.body);
  out.code = code; out.body = body;
  if (code) {
    try {
      const { data } = await db.from('business_settings').select('*').eq('wa_route_code', code).limit(2);
      const rows = rowsOf({ data });
      if (rows.length > 1) { out.via = 'ambiguous_code'; return out; }
      if (rows.length === 1) { out.tenant = rows[0]; out.via = 'code'; return out; }
      out.via = 'unknown_code'; return out;
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'tenant routing: code lookup failed', error: e.message }));
      out.via = 'unknown_code'; return out;
    }
  }

  out.via = 'unmatched';
  return out;
}

/**
 * Remember customer → tenant for the shared number (sticky routing).
 * Never throws; failure only means the customer must send the code again.
 */
export async function upsertWaCustomerTenant(db, { platformPhoneNumberId, customerPhone, userId }) {
  if (!db || typeof db.from !== 'function' || !platformPhoneNumberId || !customerPhone || !userId) return false;
  const now = new Date().toISOString();
  try {
    const { error } = await db.from('wa_customer_tenant').upsert({
      platform_phone_number_id: String(platformPhoneNumberId),
      customer_phone: String(customerPhone),
      user_id: userId,
      last_seen_at: now,
    }, { onConflict: 'platform_phone_number_id,customer_phone' });
    if (error) { console.warn('[tenant routing] sticky upsert failed:', error.message || error.code); return false; }
    return true;
  } catch (e) {
    console.warn('[tenant routing] sticky upsert error:', e.message);
    return false;
  }
}

/**
 * Throttle the "send us a business code" guidance reply to one per customer
 * per cooldown window. Uses `shared_guidance` (UNIQUE platform+customer).
 * @returns {Promise<boolean>} true = caller may send guidance now
 */
export async function claimSharedGuidance(db, platformPhoneNumberId, customerPhone, cooldownHours = 24) {
  if (!db || typeof db.from !== 'function' || !platformPhoneNumberId || !customerPhone) return false;
  const platform = String(platformPhoneNumberId);
  const phone = String(customerPhone);
  const now = Date.now();
  try {
    const { error } = await db.from('shared_guidance').insert({
      platform_phone_number_id: platform, customer_phone: phone, last_sent_at: new Date(now).toISOString(),
    });
    if (!error) return true;                       // first time we ever talk to this number
    if (error.code !== '23505') {                  // unknown error → do not risk spamming
      console.warn('[shared guidance] insert failed:', error.message || error.code);
      return false;
    }
    const { data } = await db.from('shared_guidance')
      .update({ last_sent_at: new Date(now).toISOString() })
      .eq('platform_phone_number_id', platform).eq('customer_phone', phone)
      .lt('last_sent_at', new Date(now - cooldownHours * 3600_000).toISOString())
      .select('platform_phone_number_id').limit(1);
    return rowsOf({ data }).length === 1;          // only true when the cooldown had elapsed
  } catch (e) {
    console.warn('[shared guidance] error:', e.message);
    return false;
  }
}

/**
 * Resolve which credentials may be used to send to a customer.
 * EXPLICIT channels — never an implicit fallback (W-07):
 *   · individual → the tenant's own number/token (throws when missing)
 *   · shared     → the platform's shared number/token (throws when missing)
 *
 * @param {{connectionMethod?: string, waPhoneNumberId?: string|null, waAccessToken?: string|null}} tenant
 * @param {{phoneNumberId?: string|null, accessToken?: string|null}} platform
 * @returns {{phoneNumberId: string, accessToken: string, channel: 'tenant'|'platform-shared'}}
 */
export function resolveSendCreds(tenant = {}, platform = {}) {
  const method = tenant.connectionMethod === 'individual' ? 'individual' : 'shared';
  if (method === 'individual') {
    if (!tenant.waPhoneNumberId || !tenant.waAccessToken) throw new Error('Missing tenant WhatsApp credentials');
    return { phoneNumberId: tenant.waPhoneNumberId, accessToken: tenant.waAccessToken, channel: 'tenant' };
  }
  if (!platform.phoneNumberId || !platform.accessToken) throw new Error('Missing platform WhatsApp credentials for shared number');
  return { phoneNumberId: platform.phoneNumberId, accessToken: platform.accessToken, channel: 'platform-shared' };
}
