#!/usr/bin/env node
// ZAPIT — Security smoke check for CI (Phases 1–7.1)
// Fails (exit 1) if any critical invariant is violated.
// No external deps, runs on Node 18+.

import fs from 'fs';
import crypto from 'crypto';

let fails = 0;
function fail(msg){ console.error('❌', msg); fails++; }
function pass(msg){ console.log('✅', msg); }

const indexJs = fs.readFileSync('index.js','utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

// 1. No default weak secrets in source (should use env or effective)
if (indexJs.includes("'zapit-secret-change-me'") || indexJs.includes('"zapit-secret-change-me"')) fail('JWT default secret still in source');
else pass('No hardcoded JWT default secret');

if (indexJs.includes("'zapit-32-char-encryption-key-1234'")) fail('Encryption default key still in source');
else pass('No hardcoded encryption default key');

// 2. CORS must not be wide open (cb(null,true) fallback)
if (indexJs.includes("cb(null, true); // open in prod")) fail('CORS fail-open comment still present (wide-open)');
else pass('CORS fail-open removed');

if (!indexJs.includes('ALLOWED_ORIGINS') || !indexJs.includes('PREVIEW_HOST_RE')) fail('CORS allowlist / preview regex missing');
else pass('CORS allowlist present');

// 3. Helmet HSTS / referrer
if (!indexJs.includes('hsts:')) fail('Helmet HSTS not configured');
else pass('Helmet HSTS present');
if (!indexJs.includes('referrerPolicy')) fail('Referrer-Policy not set');
else pass('Referrer-Policy present');
if (!indexJs.includes("Permissions-Policy")) fail('Permissions-Policy not set');
else pass('Permissions-Policy present');

// 4. Paystack constant-time
if (!indexJs.includes('timingSafeEqual')) fail('Paystack timingSafeEqual missing');
else pass('Paystack constant-time check present');
if (!indexJs.includes('webhook_events') || !indexJs.includes('paystack_reference')) fail('Paystack idempotency (webhook_events / paystack_reference) missing');
else pass('Paystack idempotency present');

// 5. spawn vs exec for ffmpeg
if (indexJs.includes("execAsync(`ffmpeg") || indexJs.includes('execAsync(cmd,')) fail('ffmpeg still uses execAsync with string');
else pass('ffmpeg does not use execAsync string');
if (!indexJs.includes("spawn('ffmpeg'")) fail('ffmpeg spawn not found');
else pass('ffmpeg spawn present');

// 6. OTP hashing
if (!indexJs.includes('hashOTP')) fail('hashOTP helper missing');
else pass('hashOTP present');
if (indexJs.includes("code:otp, type:'email_verify'") && !indexJs.includes('hashOTP(otp)')) fail('OTP plain still inserted');
else pass('OTP hashed on insert');

// 7. Password strength
if (!indexJs.includes('isStrongPassword')) fail('isStrongPassword missing');
else pass('Password strength helper present');

// 8. Rate limit per-user for content
if (!indexJs.includes('contentLimiter') || !indexJs.includes('req.user?.id')) fail('Content limiter not per-user');
else pass('Content limiter per-user');

// 9. File upload hardening (sharp metadata)
if (!indexJs.includes('sharp(fileBuffer).metadata()') && !indexJs.includes('sharp(req.file.buffer).metadata()')) fail('sharp magic-byte check missing');
else pass('sharp magic-byte check present');

// 10. Request ID + error ID
if (!indexJs.includes('x-request-id') || !indexJs.includes('X-Request-Id')) fail('Request ID header missing');
else pass('Request ID header present');
if (!indexJs.includes('requestId: req.id')) fail('Error requestId not returned');
else pass('Error requestId present');

// 11. Trust proxy
if (!indexJs.includes("trust proxy")) fail('trust proxy not set');
else pass('trust proxy set');

// 12. Package checks
if (!pkg.scripts['security:check']) fail('package.json security:check missing');
else pass('package.json security:check present');

// ── 13. Phase 6.1 — Reserved usernames (S-01) ───────────────────────
if (!indexJs.includes('RESERVED_USERNAMES') || !indexJs.includes('isReservedUsername')) fail('RESERVED_USERNAMES / isReservedUsername missing (S-01)');
else pass('Reserved usernames guard present (S-01)');
if (!indexJs.includes("This username is reserved")) fail('Reserved username error message missing');
else pass('Reserved username rejection message present');
if (indexJs.includes("adminList.includes(req.user.username)") && !indexJs.includes("dbUser?.role === 'admin'")) fail('requireAdmin still uses username check without DB role (S-01)');
else pass('requireAdmin uses DB role (S-01)');

// ── 14. Phase 6.1 — Admin secret timingSafeEqual (S-02) ─────────────
if (!indexJs.includes('hasValidAdminSecret') || !indexJs.includes('safeEqual')) fail('hasValidAdminSecret / safeEqual missing (S-02)');
else pass('Admin secret timingSafeEqual present (S-02)');
if (indexJs.includes("ADMIN_SECRET && req.headers['x-admin-secret'] === ADMIN_SECRET")) fail('Old ADMIN_SECRET direct compare still present (S-02)');
else pass('Old ADMIN_SECRET compare removed');

// ── 15. Phase 6.1 — S-22 password_hash leak (explicit SAFE_USER_SELECT) ─
if (!indexJs.includes('SAFE_USER_SELECT')) fail('SAFE_USER_SELECT missing (S-22)');
else pass('SAFE_USER_SELECT present (S-22)');
if (indexJs.includes("supabase.from('users').select('*').eq('id',req.params.id).single()")) fail("admin/users/:id still uses select('*') (S-22)");
else pass("admin/users/:id does not use select('*')");
if (indexJs.includes("supabase.from('users').update(updates).eq('id', req.user.id).select().single()")) fail("update-profile still uses select() without allow-list (S-22)");
else pass('update-profile uses explicit select');

// ── 16. Phase 6.1 — W-07 no platform fallback ───────────────────────
if (indexJs.includes("accessToken || WA_ACCESS_TOKEN") && indexJs.includes("async function sendWAMessage")) {
  // Check if the fallback is inside sendWAMessage itself
  const waHelper = indexJs.slice(indexJs.indexOf('async function sendWAMessage'), indexJs.indexOf('async function sendWAMessage') + 1200);
  if (waHelper.includes('accessToken || WA_ACCESS_TOKEN') || waHelper.includes('phoneNumberId || WA_PHONE_NUMBER_ID')) fail('sendWAMessage still falls back to platform tokens (W-07)');
  else pass('sendWAMessage does not fall back (W-07 helper ok)');
} else {
  if (!indexJs.includes("Missing tenant WhatsApp credentials")) fail('W-07 throw message missing');
  else pass('W-07 strict tenant check present');
}
// Ensure no fallback in webhook/broadcast/reply call sites (except shared assignment and admin explicit)
const fallbackCount = (indexJs.match(/wa_phone_number_id\|\|WA_PHONE_NUMBER_ID/g) || []).length;
if (fallbackCount > 0) fail(`Found ${fallbackCount} wa_phone_number_id||WA_PHONE_NUMBER_ID fallback(s) in call sites (W-07) — should be 0 besides shared assignment`);
else pass('No wa_phone_number_id fallback in call sites (W-07)');
const decryptFallback = (indexJs.match(/decrypt\(.*\)\s*:\s*WA_ACCESS_TOKEN/g) || []).length;
if (decryptFallback > 0) fail(`Found ${decryptFallback} decrypt fallback(s) to WA_ACCESS_TOKEN (W-07)`);
else pass('No decrypt fallback to WA_ACCESS_TOKEN (W-07)');

// ── 17. Migration for role ────────────────────────────────────────
try {
  const mig = fs.readFileSync('supabase/migrations/20261002_phase6_01_admin_hardening.sql','utf8');
  if (!mig.includes('role text') || !mig.includes("users_safe")) fail('Phase 6.1 migration missing role / users_safe view');
  else pass('Phase 6.1 migration present');
} catch { fail('Phase 6.1 migration file missing'); }

// ── 18. OTP via fetch? (existing) ─────────────────────────────────
if (!indexJs.includes('generateOTP') || !indexJs.includes('hashOTP')) fail('OTP helpers missing');
else pass('OTP helpers present');

// ── 19. Phase 6.2 — WhatsApp webhook authenticity (S-05) ──────────
if (!indexJs.includes("app.use('/webhook/whatsapp', express.raw(")) fail('WhatsApp webhook raw-body middleware missing (S-05)');
else pass('WhatsApp raw body captured before json (S-05)');
if (!indexJs.includes('x-hub-signature-256')) fail('X-Hub-Signature-256 not checked (S-05)');
else pass('X-Hub-Signature-256 verified (S-05)');
if (!indexJs.includes('verifyMetaSignature') || !indexJs.includes('WA_SIGNATURE_SECRET')) fail('verifyMetaSignature / WA_SIGNATURE_SECRET missing (S-05)');
else pass('Meta HMAC verifier wired (S-05)');
if (!indexJs.includes('Webhook not configured') || !indexJs.includes('status(503)')) fail('Production fail-closed when app secret missing (S-05)');
else pass('Missing app secret fails closed in production (S-05)');
if (!indexJs.includes('Invalid signature') || !indexJs.includes('status(401)')) fail('401 on invalid signature missing (S-05)');
else pass('Invalid signature → 401 (S-05)');
if (!indexJs.includes("claimWebhookEvent(supabase, 'whatsapp'")) fail('WhatsApp replay dedup claim missing (S-05)');
else pass('WhatsApp replay dedup claim present (S-05)');
if (indexJs.includes('token === WA_VERIFY_TOKEN')) fail('GET verify token still uses === (S-05)');
else pass('Verify token uses constant-time compare (S-05)');

// ── 20. Phase 6.2 — webhook util + migration ───────────────────────
try {
  const wu = fs.readFileSync('src/utils/webhook.js','utf8');
  if (!wu.includes('timingSafeEqual') || !wu.includes('createHmac')) fail('webhook util missing timingSafeEqual HMAC (S-05)');
  else pass('webhook util has constant-time HMAC verify (S-05)');
  if (!wu.includes('sha256=') || /sha1=/.test(wu)) fail('webhook util must accept sha256 only, never legacy sha1 (S-05)');
  else pass('webhook util rejects legacy sha1 (S-05)');
  if (!wu.includes('23505')) fail('webhook util duplicate-claim handling missing (S-05)');
  else pass('webhook util handles duplicate claim 23505 (S-05)');
} catch { fail('src/utils/webhook.js missing (S-05)'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261003_phase6_02_wa_webhook.sql','utf8');
  if (!mig.includes('idx_messages_wa_message_id_unique') || !mig.includes('prune_webhook_events')) fail('Phase 6.2 migration missing replay index / retention helper');
  else pass('Phase 6.2 migration present');
} catch { fail('Phase 6.2 migration file missing'); }

// ── 21. Phase 6.3 — Supabase v2 builders have no .catch (W-14) ─────
// `.catch()` on a PostgREST builder is not a function → every such call threw a
// TypeError at runtime (the WhatsApp webhook was dead on arrival). Enforce zero.
const brokenCatch = (indexJs.match(/\.catch\(/g) || []).length;
if (brokenCatch > 0) fail(`Found ${brokenCatch} .catch(...) on Supabase builders — not a function in supabase-js v2 (W-14)`);
else pass('No .catch(...) on Supabase builders (W-14)');

// ── 22. Phase 6.3 — Tenant routing is deterministic & fail-closed (S-06) ──
if (!indexJs.includes('resolveTenantForInbound(')) fail('Webhook does not use resolveTenantForInbound (S-06)');
else pass('Webhook uses deterministic tenant resolver (S-06)');
if (indexJs.includes(".eq('connection_method','shared').eq('auto_reply',true).limit(1)")) fail('Arbitrary shared tenant .limit(1) still present (S-06)');
else pass('No arbitrary shared tenant selection (S-06)');
if (indexJs.includes('updates.wa_phone_number_id  = WA_PHONE_NUMBER_ID') || indexJs.includes('updates.wa_phone_number_id = WA_PHONE_NUMBER_ID')) fail('Shared connect still stores the platform number on tenant rows (S-06)');
else pass('Shared connect does not store platform number/token (S-06)');
if (!indexJs.includes('maybeSendRoutingGuidance(')) fail('Unmatched shared messages have no guidance reply (S-06)');
else pass('Unmatched shared messages get throttled guidance (S-06)');
if (!indexJs.includes('resolveSendCreds(')) fail('Outbound sends do not use explicit channel resolution (S-06/W-07)');
else pass('Outbound sends use explicit channel resolution (S-06/W-07)');

// ── 23. Phase 6.3 — routing util + migration ───────────────────────
try {
  const tr = fs.readFileSync('src/utils/tenantRouting.js','utf8');
  if (!tr.includes('generateRouteCode') || !tr.includes('extractRouteCode')) fail('tenantRouting util missing code helpers (S-06)');
  else pass('tenantRouting util present (S-06)');
  if (!tr.includes('ambiguous_individual') || !tr.includes('ambiguous_code')) fail('tenantRouting util lacks ambiguity refusal (S-06)');
  else pass('tenantRouting refuses ambiguous routing (S-06)');
  if (!tr.includes('platform-shared')) fail('tenantRouting util lacks explicit shared channel (S-06)');
  else pass('tenantRouting has explicit shared channel (S-06)');
} catch { fail('src/utils/tenantRouting.js missing (S-06)'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261004_phase6_03_shared_routing.sql','utf8');
  if (!mig.includes('wa_customer_tenant') || !mig.includes('wa_route_code') || !mig.includes('shared_guidance')) fail('Phase 6.3 migration missing routing tables/column');
  else pass('Phase 6.3 migration present');
  if (!mig.includes('idx_business_settings_wa_number_individual') || !mig.includes('idx_business_settings_route_code')) fail('Phase 6.3 migration missing unique indexes');
  else pass('Phase 6.3 unique indexes present');
} catch { fail('Phase 6.3 migration file missing'); }

// ── 24. Phase 6.4 — Billing guardrails (B-01/B-02/B-04/B-07) ──────
// B-01: reactivating after the paid period must not mint free time
const reactivateBlock = indexJs.slice(indexJs.indexOf("app.post('/subscription/reactivate'"), indexJs.indexOf("app.get('/subscription/invoices'"));
if (!reactivateBlock.includes('reactivateDecision(')) fail('reactivate does not use reactivateDecision (B-01)');
else pass('Reactivate uses billing rules (B-01)');
if (reactivateBlock.includes('expires_at:new Date(Date.now()+30*24*60*60*1000)')) fail('reactivate still grants a free 30-day period (B-01)');
else pass('No free 30-day grant in reactivate (B-01)');
if (!reactivateBlock.includes('initializePaystack(') || !reactivateBlock.includes('payment_required')) fail('reactivate does not require payment when the period has ended (B-01)');
else pass('Reactivate requires a new payment when the period ended (B-01)');

// B-02: cancel keeps access until period end
const cancelBlock = indexJs.slice(indexJs.indexOf("app.post('/subscription/cancel'"), indexJs.indexOf("app.post('/subscription/reactivate'"));
if (!cancelBlock.includes('cancelSubscriptionPlan(') || !cancelBlock.includes('cancel_at')) fail('cancel does not defer to period end (B-02)');
else pass('Cancel keeps access until period end (B-02)');

// B-04/S-14: webhook validates the paid amount/currency and records the ledger
if (!indexJs.includes('evaluateCharge(') || !indexJs.includes('expectedAmountMinor(')) fail('Paystack webhook does not verify amount/currency (S-14/B-04)');
else pass('Paystack webhook verifies amount/currency (S-14/B-04)');
if (!indexJs.includes("from('transactions').insert(")) fail('Paystack webhook does not record the transactions ledger (B-04)');
else pass('Paystack webhook records immutable transactions (B-04)');
if (indexJs.includes("if (!userId||!plan||!PLAN_LIMITS[plan]) return;")) fail('Paystack webhook no longer refuses free plan grants (B-07)');
else pass('Paystack webhook refuses free-plan grants (B-07)');

// B-07: privileged grants are bounded + audited
const setPlanBlock = indexJs.slice(indexJs.indexOf("app.post('/admin/users/:id/set-plan'"), indexJs.indexOf("app.post('/admin/users/:id/suspend'"));
if (!setPlanBlock.includes('expires_in_days must be an integer between 1 and 365')) fail('admin set-plan days are unbounded (B-07)');
else pass('Admin set-plan days are bounded 1–365 (B-07)');
if (!setPlanBlock.includes('admin_audit_log')) fail('admin set-plan is not audited (B-07)');
else pass('Admin set-plan writes an audit row (B-07)');

// S-06 follow-up: guarded dedicated-number connect + awaited allocation
const patchStart = indexJs.indexOf("app.patch('/whatsapp/settings'");
const patchSettings = indexJs.slice(patchStart, indexJs.indexOf('\n// ', patchStart + 10));
if (!patchSettings.includes("belongs to ZAPIT's shared service")) fail('settings accepts the platform shared number (S-06)');
else pass('Settings refuses the platform shared number (S-06)');
if (!patchSettings.includes('is required to connect a dedicated number')) fail('settings connects a dedicated number without a token (W-07)');
else pass('Settings requires a token for dedicated numbers (W-07)');
if (!patchSettings.includes('409')) fail('settings does not map duplicate numbers to 409 (S-06)');
else pass('Settings maps duplicate numbers to 409 (S-06)');
if (/: pickFreeRouteCode\(/.test(indexJs)) fail('route-code allocation is not awaited (S-06 regression)');
else pass('Route-code allocation is always awaited (S-06)');

// billing util + migration
try {
  const bl = fs.readFileSync('src/utils/billing.js','utf8');
  if (!bl.includes('cancelSubscriptionPlan') || !bl.includes('reactivateDecision') || !bl.includes('verifyPaymentAmount') || !bl.includes('evaluateCharge')) fail('billing util missing rules (6.4)');
  else pass('billing util present (6.4)');
  if (!bl.includes("mode: 'payment_required'")) fail('billing util lacks payment_required path (B-01)');
  else pass('billing util has payment_required path (B-01)');
} catch { fail('src/utils/billing.js missing (6.4)'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261005_phase6_04_billing_guardrails.sql','utf8');
  if (!mig.includes('cancel_at') || !mig.includes('transactions_immutable') || !mig.includes('admin_audit_log')) fail('Phase 6.4 migration missing guardrails');
  else pass('Phase 6.4 migration present');
} catch { fail('Phase 6.4 migration file missing'); }

// ── 25. Phase 6.5 — S-13 / S-15 / S-16 ──────────────────────────
// S-16: no mass assignment anywhere
if (indexJs.includes('...req.body')) fail('request body is spread into a DB payload (S-16)');
else pass('No request-body spread into DB payloads (S-16)');
if (/\.update\(req\.body\)/.test(indexJs)) fail('update(req.body) mass assignment (S-16)');
else pass('No update(req.body) mass assignment (S-16)');
{
  const picks = (indexJs.match(/pickFields\(/g) || []).length;
  if (picks < 7) fail(`only ${picks} PATCH routes use pickFields (S-16)`);
  else pass(`All ${picks} PATCH routes use validated allow-lists (S-16)`);
}
if (!indexJs.includes("select(SAFE_USER_SELECT + ',password_hash')")) fail('login does not use an explicit user DTO (S-22)');
else pass('Login uses an explicit user DTO (S-22)');

// S-15: crypto OTP + real lockout
if (/function generateOTP|Math\.random\(\)\s*\*\s*900000/.test(indexJs)) fail('OTP still generated with Math.random (S-15)');
else pass('No Math.random OTP generator (S-15)');
if (!indexJs.includes('verifyOTPRecord(') || !indexJs.includes('attemptsAfterFailure(')) fail('OTP verify flows have no per-code lockout (S-15)');
else pass('OTP verify flows enforce a per-code lockout (S-15)');
try {
  const otp = fs.readFileSync('src/utils/otp.js','utf8');
  if (!otp.includes('crypto.randomInt') || !otp.includes('timingSafeEqual') || !otp.includes('OTP_MAX_ATTEMPTS')) fail('otp util lacks crypto primitives (S-15)');
  else pass('otp util is crypto-strong (S-15)');
} catch { fail('src/utils/otp.js missing (S-15)'); }
if (!indexJs.includes('uniformDelay(')) fail('password reset is timing-distinguishable (S-15)');
else pass('Forgot-password uses a uniform response delay (S-15)');

// S-13: client IP only via Express
if (indexJs.includes("x-forwarded-for")) fail('X-Forwarded-For still read directly (S-13)');
else pass('X-Forwarded-For is never read directly (S-13)');
if (!indexJs.includes('clientIp(req)') || !indexJs.includes('isPrivateIp(')) fail('client IP resolution not centralised (S-13)');
else pass('Client IP resolution uses req.ip with private-range handling (S-13)');
if (!indexJs.includes("process.env.TRUST_PROXY")) fail('proxy trust is not operator-configurable (S-13)');
else pass('Proxy trust is configurable via TRUST_PROXY (S-13)');

// ── Phase 7.1 — OAuth state is a single-use server-side handle + PKCE (S-07) ──
try {
  const idx = fs.readFileSync('index.js','utf8');
  if (idx.includes('Buffer.from(JSON.stringify({ user_id') || idx.includes('stateData.user_id'))
    fail('OAuth state still travels as a client-trusted blob (S-07)');
  else pass('OAuth state carries no client-trusted identity (S-07)');
  if (!idx.includes('state_hash:hashState(state)')) fail('OAuth state is not stored hashed (S-07)');
  else pass('OAuth state is stored hashed (S-07)');
  if (!idx.includes(".eq('state_hash', hashState(String(state)))")) fail('callback does not resolve the state by hash (S-07)');
  else pass('Callback resolves the state by hash (S-07)');
  if (!idx.includes(".is('used_at', null)")) fail('OAuth state is not single-use (S-07)');
  else pass('OAuth state redemption is single-use (S-07)');
  if (!idx.includes('stateDecision({ record: stateRow, platform })')) fail('OAuth state has no central decision point (S-07)');
  else pass('OAuth state has a central decision point (S-07)');
  if (!idx.includes('buildAuthorizeUrl')) fail('authorize URLs are not built by the shared helper (S-07)');
  else pass('Authorize URLs are built by the shared helper (S-07)');
  if (!idx.includes('sanitizeProviderError')) fail('provider error strings are not sanitised (S-07)');
  else pass('Provider error strings are sanitised (S-07)');
  if (!idx.includes('pkceParam') || !idx.includes('ttBody.code_verifier') || !idx.includes('ytBody.code_verifier'))
    fail('PKCE verifier is not forwarded to every provider token exchange (S-07)');
  else pass('PKCE verifier is forwarded on all token exchanges (S-07)');
} catch { fail('index.js missing for OAuth checks'); }
try {
  const o = fs.readFileSync('src/utils/oauth.js','utf8');
  for (const fn of ['newOAuthState','hashState','newPkcePair','pkceChallengeFor','stateDecision','sanitizeProviderError','buildAuthorizeUrl'])
    if (!o.includes(`export function ${fn}`)) fail(`oauth util lacks ${fn} (S-07)`);
  if (!o.includes('randomBytes(OAUTH_STATE_BYTES)')) fail('OAuth state is not CSPRNG-derived (S-07)');
  else pass('OAuth util exposes the full S-07 toolkit');
  if (!/OAUTH_STATE_TTL_MS = 10 \* 60 \* 1000/.test(o)) fail('OAuth state TTL is not the 10-minute window');
  else pass('OAuth state TTL is bounded to 10 minutes (S-07)');
} catch { fail('src/utils/oauth.js missing (S-07)'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261007_phase7_01_oauth_state.sql','utf8');
  if (!mig.includes('state_hash') || !mig.includes('UNIQUE')) fail('Phase 7.1 migration lacks unique state hashes');
  else if (!mig.includes('used_at') || !mig.includes('expires_at')) fail('Phase 7.1 migration lacks single-use + expiry');
  else if (!mig.includes('ENABLE ROW LEVEL SECURITY') || !mig.includes('prune_oauth_states')) fail('Phase 7.1 migration lacks RLS / housekeeping');
  else pass('Phase 7.1 migration present (oauth_states, RLS, prune)');
} catch { fail('Phase 7.1 migration file missing'); }

// validation single-source + migration
try {
  const v = fs.readFileSync('src/utils/validation.js','utf8');
  if (!v.includes('export function pickFields')) fail('validation util lacks pickFields (S-16)');
  else pass('validation util exposes pickFields (S-16)');
} catch { fail('src/utils/validation.js missing'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261006_phase6_05_hardening.sql','utf8');
  if (!mig.includes('attempts') || !mig.includes('idx_otp_email_type')) fail('Phase 6.5 migration missing OTP lockout');
  else pass('Phase 6.5 migration present');
} catch { fail('Phase 6.5 migration file missing'); }

console.log('');
if (fails) {
  console.error(`\n${fails} check(s) failed — Phase 7.1 hardening not done.`);
  process.exit(1);
} else {
  console.log('All security checks passed (Phases 1–7.1). ✅');
}
