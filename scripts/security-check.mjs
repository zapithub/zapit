#!/usr/bin/env node
// ZAPIT — Security smoke check for CI (Phases 1–8.1)
// Fails (exit 1) if any critical invariant is violated.
// No external deps, runs on Node 18+.

import fs from 'fs';
import crypto from 'crypto';

let fails = 0;
function fail(msg){ console.error('❌', msg); fails++; }
function pass(msg){ console.log('✅', msg); }

const indexJs = fs.readFileSync('index.js','utf8');
const plansJs = fs.readFileSync('src/config/plans.js','utf8');
const billingJs = fs.readFileSync('src/utils/billing.js','utf8');
const quotaJs = fs.readFileSync('src/utils/quota.js','utf8');
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
if (!indexJs.includes('evaluateCharge(') || !billingJs.includes('currency_mismatch')) fail('Paystack webhook does not verify amount/currency (S-14/B-04)');
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

// ── Phase 7.2 — short-lived access tokens, hashed/rotating sessions, cookie auth ──
try {
  const idx = fs.readFileSync('index.js','utf8');
  if (idx.includes("expiresIn: '7d'")) fail('access tokens still live 7 days (S-08)');
  else if (!idx.includes('expiresIn: ACCESS_TOKEN_TTL')) fail('access-token TTL is not configurable/clamped (S-08)');
  else pass('Access tokens use the clamped 15-minute TTL (S-08)');
  if (/sessions'\)\.insert\(\{/.test(idx)) fail('a session insert bypasses the hashed row factory (S-08)');
  else pass('Sessions are only created through newSessionRow (hashes) (S-08)');
  if (!idx.includes(".eq('access_token_hash', hashToken(token))")) fail('authenticate does not look up sessions by hash (S-08)');
  else pass('Authenticate resolves sessions by access-token hash (S-08)');
  if (!idx.includes(".eq('refresh_token_hash', rtHash)")) fail('refresh does not look up sessions by hash (S-08)');
  else pass('Refresh resolves sessions by refresh-token hash (S-08)');
  if (!idx.includes("revoked_reason:'rotated'") || !idx.includes('replaced_by_hash'))
    fail('refresh tokens are not rotated (S-08)');
  else pass('Refresh tokens rotate on every use (S-08)');
  if (!idx.includes('isSessionReuse(session)') || !idx.includes('revokeFamilyAndFail'))
    fail('refresh-token reuse does not revoke the family (S-08)');
  else pass('Refresh-token reuse revokes the session family (S-08)');
  if (!idx.includes('parseCookies(req.headers.cookie)') || !idx.includes('setAuthCookies(res,') || !idx.includes('clearAuthCookies(res)'))
    fail('httpOnly cookie path is incomplete (S-09)');
  else pass('httpOnly cookie login/refresh/logout path present (S-09)');
  if (!idx.includes('csrfMatches(req, cookies)') || !idx.includes('isMutating(req.method)'))
    fail('cookie auth has no CSRF protection (S-09)');
  else pass('Cookie auth enforces double-submit CSRF on writes (S-09)');
} catch { fail('index.js missing for session checks'); }
try {
  const sess = fs.readFileSync('src/utils/session.js','utf8');
  for (const fn of ['parseTtlSeconds','hashToken','newFamilyId','newSessionRow','legacySessionRow','isSessionReuse','isSessionActive','isMissingColumnError'])
    if (!sess.includes(`export function ${fn}`)) fail(`session util lacks ${fn} (S-08)`);
  if (!sess.includes('ACCESS_TOKEN_MAX_SEC   = 3600')) fail('session util does not clamp the access TTL (S-08)');
  else pass('Session util exposes the S-08 toolkit with a 1-hour maximum TTL');
  const ck = fs.readFileSync('src/utils/cookies.js','utf8');
  for (const fn of ['parseCookies','csrfMatches','setAuthCookies','clearAuthCookies','serializeCookie','authCookieHeaders'])
    if (!ck.includes(`export function ${fn}`)) fail(`cookie util lacks ${fn} (S-09)`);
  if (!ck.includes('HttpOnly') || !ck.includes('REFRESH_COOKIE_PATH = \'/auth\'')) fail('cookie util does not scope httpOnly cookies (S-09)');
  else pass('Cookie util scopes httpOnly auth cookies and CSRF (S-09)');
  const mig = fs.readFileSync('supabase/migrations/20261008_phase7_02_sessions.sql','utf8');
  if (!mig.includes('access_token_hash') || !mig.includes('refresh_token_hash') || !mig.includes('family_id'))
    fail('Phase 7.2 migration lacks hashed session columns');
  else if (!mig.includes('token = NULL') || !mig.includes('prune_sessions'))
    fail('Phase 7.2 migration lacks legacy purge / housekeeping');
  else pass('Phase 7.2 migration present (hashes, family, purge, prune)');
} catch { fail('session/cookie util or migration missing (S-08/S-09)'); }
try {
  const login = fs.readFileSync('login.html','utf8');
  const dash  = fs.readFileSync('dashboard.html','utf8');
  if (login.includes('params.toString()') || /dashboard\.html\?/.test(login)) fail('login still hands tokens over in the URL (S-09)');
  else if (!dash.includes("credentials: 'include'") || !dash.includes("h['X-CSRF-Token'] = csrf"))
    fail('dashboard does not use the cookie + CSRF path (S-09)');
  else pass('Browser hosts use the URL-free cookie path with CSRF (S-09)');
} catch { fail('frontend files missing for S-09 checks'); }

// ── Phase 7.3 — every advertised quota is enforced (B-06/B-09) ──
try {
  const idx = fs.readFileSync('index.js','utf8');
  const guards = ['quotaGuardFor(METRICS.TEXT)','quotaGuardFor(METRICS.IMAGE)','quotaGuardFor(METRICS.VIDEO)','quotaGuardFor(METRICS.IMAGE, (req) =>'];
  for (const g of guards) if (!idx.includes(g)) fail(`generation route is not metered: ${g} (B-06)`);
  if (guards.every(g => idx.includes(g))) pass('Text/image/video/carousel generations are metered (B-06)');
  if (!idx.includes('metricForContentType(item.type)')) fail('regeneration bypasses the quota (B-06)');
  else pass('Regeneration consumes the item-type quota (B-06)');
  if (!idx.includes('metric:METRICS.BROADCAST')) fail('broadcasts are not metered (B-06)');
  else pass('Broadcasts are metered monthly (B-06)');
  if (!idx.includes('metric:METRICS.REPLY')) fail('WhatsApp replies are not metered (B-06)');
  else pass('WhatsApp replies are metered monthly (B-06)');
  if (idx.includes("update({ reply_count:0, last_reply_reset:new Date().toISOString() })")) fail('the unfiltered monthly reset is back (B-09)');
  else if (!idx.includes(".in('user_id', ids)")) fail('monthly legacy reset does not filter per user (B-09)');
  else pass('Monthly reset is paged and filtered by user id (B-09)');
  if (!idx.includes("prune_usage_counters")) fail('monthly job does not prune old counters (B-09)');
  else pass('Monthly job prunes counters older than 13 months (B-09)');
  if (!idx.includes('usageSnapshot(supabase')) fail('/subscription/current does not expose monthly usage (B-06)');
  else pass('/subscription/current exposes monthly counters (B-06)');
} catch { fail('index.js missing for quota checks'); }
try {
  const q = fs.readFileSync('src/utils/quota.js','utf8');
  for (const fn of ['periodStart','metricForContentType','quotaDecision','consumeQuota','usageSnapshot','quotaGuard'])
    if (!q.includes(`export function ${fn}`) && !q.includes(`export async function ${fn}`)) fail(`quota util lacks ${fn} (B-06)`);
  if (!q.includes('p_user_id: userId')) fail('quota util does not call the atomic RPC (B-06)');
  else pass('Quota util consumes counters through the atomic RPC (B-06)');
  const mig = fs.readFileSync('supabase/migrations/20261009_phase7_03_usage_counters.sql','utf8');
  if (!mig.includes('UNIQUE (user_id, metric, period_start)')) fail('Phase 7.3 migration lacks the per-period unique key');
  else if (!mig.includes('consume_usage') || !mig.includes('WHERE usage_counters.used + v_add <= v_limit')) fail('Phase 7.3 migration lacks atomic consume');
  else pass('Phase 7.3 migration present (period-scoped counters, atomic consume)');
} catch { fail('quota util or migration missing (B-06)'); }

// ── Phase 7.4 — one price resolver; no amount is ever relabelled (B-05) ──
try {
  if (!plansJs.includes('export const PAYSTACK_CURRENCIES')) fail('plans.js lacks the settleable-currency list (B-05)');
  else if (!/PAYSTACK_CURRENCIES\s*=\s*\[[^\]]*'NGN'[^\]]*'GHS'[^\]]*'ZAR'[^\]]*'KES'[^\]]*'USD'/.test(plansJs)) fail('PAYSTACK_CURRENCIES is not the settled NGN/GHS/ZAR/KES/USD set (B-05)');
  else pass('Plans declare exactly the currencies Paystack can settle (B-05)');
  if (!plansJs.includes('export function resolvePlanPrice')) fail('plans.js lacks the single price resolver (B-05)');
  else if (!plansJs.includes("currency: 'USD'") || !plansJs.includes("converted: wanted !== 'USD'")) fail('resolvePlanPrice does not fall back to a USD charge (B-05)');
  else pass('resolvePlanPrice falls back to a USD charge, never a relabelled amount (B-05)');
  if (!plansJs.includes('billing_note')) fail('checkout does not explain the USD fallback (B-05)');
  else pass('Checkout explains the USD fallback to the customer (B-05)');
} catch { fail('src/config/plans.js missing (B-05)'); }
try {
  if (!billingJs.includes('export function resolveCharge')) fail('billing.js lacks resolveCharge (B-05)');
  else if (!billingJs.includes('resolvePlanPrice') || !billingJs.includes('amountMinor: Math.round(amount * 100)')) fail('resolveCharge does not reuse the plan resolver in minor units (B-05)');
  else pass('resolveCharge is the single source of amount + currency (B-05)');
  if (!billingJs.includes("if (expected.currency !== currency)")) fail('webhook would grant a currency the checkout never charges (B-05)');
  else pass('evaluateCharge refuses a currency the checkout would never charge (B-05)');
} catch { fail('src/utils/billing.js missing (B-05)'); }
try {
  if (/\.price\[/.test(indexJs)) fail('index.js still looks plan prices up by hand (B-05)');
  else pass('No hand-rolled price lookups remain in index.js (B-05)');
  if (!indexJs.includes('resolveCharge({ plan, currency: requested, billingCycle: billing_cycle })')) fail('upgrade does not resolve the charge once (B-05)');
  else pass('Upgrade charges exactly what resolveCharge returns (B-05)');
  if (!indexJs.includes('requested_currency:charge.requested_currency')) fail('gateway metadata loses the requested currency (B-05)');
  else pass('Gateway metadata records both charged and requested currency (B-05)');
  if (!indexJs.includes('const getPricingForLocation = __srcGetPricing')) fail('pricing display can drift from the resolver again (B-05)');
  else pass('Pricing display defers to the shared resolver (B-05)');
  if (!indexJs.includes('resolveCharge({ plan: sub.plan, currency: requested, billingCycle: cycle })')) fail('reactivation bypasses the resolver (B-05)');
  else pass('Reactivation charges through the same resolver (B-05)');
} catch { fail('index.js missing for the B-05 checks'); }
try {
  const t = fs.readFileSync('tests/unit/currency.test.mjs','utf8');
  if (!t.includes('never the unsupported currency') || !t.includes('parity')) fail('currency test does not pin the USD fallback and checkout/webhook parity (B-05)');
  else pass('Currency tests pin the fallback + checkout/webhook parity (B-05)');
} catch { fail('tests/unit/currency.test.mjs missing (B-05)'); }



// ── Phase 8.3 — 24h window, templates, scheduled broadcasts (W-03) ──
try {
  const bc = fs.readFileSync('src/utils/broadcast.js','utf8');
  for (const fn of ['isInServiceWindow','partitionByWindow','validateTemplate','renderTemplateBody','templatePayload','planBroadcast'])
    if (!bc.includes(`export function ${fn}`)) fail(`broadcast util lacks ${fn} (W-03)`);
  if (!bc.includes('export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000')) fail('the service window is not 24h (W-03)');
  else pass('The free-form window is exactly 24h (W-03)');
  if (!bc.includes("outside_24h_window") || !bc.includes("mode: 'template'")) fail('outside-window recipients are not separated (W-03)');
  else pass('Outside-window recipients are templated or skipped, never free-texted (W-03)');
} catch { fail('src/utils/broadcast.js missing (W-03)'); }
try {
  if (!indexJs.includes('async function sendWATemplate(') || !indexJs.includes('templatePayload(template, to, params)'))
    fail('there is no template send path (W-03)');
  else pass('Templates are sent as Cloud API template messages (W-03)');
  if (indexJs.includes("message.replace('{name}',c.name||'there')")) fail('the old free-text-everyone broadcast loop is back (W-03)');
  else pass('The old free-text-everyone broadcast loop is gone (W-03)');
  if (!indexJs.includes('planBroadcast({ contacts, message, template, now:new Date() })')) fail('broadcasts do not consult the window (W-03)');
  else pass('Broadcasts are planned against the 24h window (W-03)');
  if (!indexJs.includes('skipped_count') || !indexJs.includes('outside the 24h window')) fail('skipped recipients are not reported (W-03)');
  else pass('Skipped recipients are reported to the merchant (W-03)');
  if (!indexJs.includes("app.post('/whatsapp/templates'") || !indexJs.includes("app.get('/whatsapp/templates'")) fail('no template management routes (W-03)');
  else pass('Merchants can store and list templates (W-03)');
  if (!indexJs.includes('cron:send-broadcasts') || !indexJs.includes('BROADCAST_CRON')) fail('scheduled broadcasts still never run (W-03)');
  else pass('Scheduled broadcasts have a scheduler (W-03)');
  if (!/\.eq\('id', b\.id\)\.eq\('status','scheduled'\)\.select\(\)/.test(indexJs)) fail('the broadcast scheduler has no lease (W-03)');
  else pass('The broadcast scheduler leases each row exactly once (W-03)');
} catch { fail('index.js missing for the broadcast checks'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261013_phase8_03_templates_and_broadcast_runs.sql','utf8');
  if (!mig.includes('CREATE TABLE IF NOT EXISTS wa_templates') || !mig.includes('UNIQUE (user_id, name, language)')) fail('Phase 8.3 migration lacks wa_templates (W-03)');
  else pass('Phase 8.3 migration adds wa_templates (W-03)');
  for (const col of ['template_id','failed_count','skipped_count','results','started_at']) {
    if (!mig.includes(`ADD COLUMN IF NOT EXISTS ${col}`)) { fail(`Phase 8.3 migration lacks broadcasts.${col} (W-03)`); break; }
  }
  if (!mig.includes('idx_broadcasts_due')) fail('Phase 8.3 migration lacks the due-broadcast index (W-03)');
  else pass('Phase 8.3 migration indexes due broadcasts (W-03)');
} catch { fail('Phase 8.3 migration file missing (W-03)'); }
try {
  const t = fs.readFileSync('tests/unit/broadcast.test.mjs','utf8');
  if (!t.includes('23.9') || !t.includes('outside_24h_window')) fail('broadcast test does not pin the window edges (W-03)');
  else pass('Broadcast test pins the window edges and skip reasons (W-03)');
} catch { fail('tests/unit/broadcast.test.mjs missing (W-03)'); }

// ── Phase 8.2 — the in-chat order + payment loop (W-01) ──
try {
  const ord = fs.readFileSync('src/utils/orders.js','utf8');
  for (const fn of ['detectOrderIntent','parseQuantity','matchProduct','applyMessageToDraft','nextMissingSlot','computeOrderTotals','orderPaymentReference','evaluateOrderPayment','paymentInstructions'])
    if (!ord.includes(`export function ${fn}`)) fail(`orders util lacks ${fn} (W-01)`);
  if (!ord.includes("return { ok: false, reason: 'amount_mismatch' }")) fail('order payments are not amount-checked (W-01)');
  else pass('Order payments are amount-checked against the order row (W-01)');
  if (!ord.includes("reason: 'currency_mismatch'")) fail('order payments are not currency-checked (W-01)');
  else pass('Order payments are currency-checked (W-01)');
  if (!ord.includes('validatePaymentReference') || !ord.includes('REFERENCE_RE')) fail('payment references are not validated (W-01)');
  else pass('Payment references are validated before use (W-01)');
} catch { fail('src/utils/orders.js missing (W-01)'); }
try {
  if (!/createOrderFromDraft[\s\S]{0,900}generateOrderNumber\(\)/.test(indexJs)) fail('generateOrderNumber still has no call site (W-01)');
  else pass('generateOrderNumber() runs when the customer orders (W-01)');
  if (!indexJs.includes('async function handleOrderFlow(') || !indexJs.includes('await handleOrderFlow(')) fail('the chat has no order flow (W-01)');
  else pass('The chat order flow is wired (W-01)');
  if (!indexJs.includes('safeDecryptValue(settings?.paystack_secret_key)')) fail("the tenant's Paystack key is still never read (W-01)");
  else pass("The tenant's own Paystack key creates the charge (W-01)");
  if (!indexJs.includes('async function settleOrderCharge(') || !indexJs.includes('await settleOrderCharge(event)')) fail('the Paystack webhook does not settle orders (W-01)');
  else pass('The Paystack webhook settles in-chat orders (W-01)');
  if (!indexJs.includes('evaluateOrderPayment({ order, verifyData')) fail('order settlement trusts the payload (W-01)');
  else pass('Order settlement is verified against the order row (W-01)');
  if (!indexJs.includes("app.post('/whatsapp/orders/:id/payment-link'") || !indexJs.includes("app.post('/whatsapp/orders/:id/verify-payment'"))
    fail('no merchant recovery routes for order payments (W-01)');
  else pass('Merchants can re-send and verify an order payment (W-01)');
  if (!indexJs.includes("source: 'whatsapp'")) fail('chat orders are not marked with their source (W-01)');
  else pass('Chat orders are marked source=whatsapp (W-01)');
} catch { fail('index.js missing for the order-loop checks'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261012_phase8_02_order_loop.sql','utf8');
  const cols = ['items','delivery_address','delivery_fee','payment_provider','payment_reference','payment_link','payment_currency','payment_amount_minor','payment_verified_at','gateway_response','source'];
  const missing = cols.filter(c => !mig.includes(`ADD COLUMN IF NOT EXISTS ${c}`));
  if (missing.length) fail(`Phase 8.2 migration lacks orders columns: ${missing.join(', ')}`);
  else pass('Phase 8.2 migration adds the order-payment columns (W-01)');
  if (!mig.includes('CREATE TABLE IF NOT EXISTS order_drafts') || !mig.includes('UNIQUE (user_id, contact_id)'))
    fail('order drafts have no storage (W-01)');
  else pass('Multi-turn order drafts have storage (W-01)');
  if (!mig.includes('idx_orders_payment_reference') || !mig.includes('prune_order_drafts')) fail('Phase 8.2 migration lacks the reference index/prune (W-01)');
  else pass('Phase 8.2 migration indexes the reference and prunes stale drafts (W-01)');
} catch { fail('Phase 8.2 migration file missing (W-01)'); }
try {
  const t = fs.readFileSync('tests/unit/orders.test.mjs','utf8');
  if (!t.includes('never a price') || !t.includes('amount_mismatch')) fail('orders test does not pin quantity/amount safety (W-01)');
  else pass('Orders test pins quantity parsing + the payment decision matrix (W-01)');
} catch { fail('tests/unit/orders.test.mjs missing (W-01)'); }

// ── Phase 8.1 — every inbound message handled once, honouring opt-out/takeover (W-02/W-04) ──
try {
  const inb = fs.readFileSync('src/utils/inbound.js','utf8');
  for (const fn of ['extractInboundMessages','messageTextOf','classifyOptKeyword','shouldWelcome','isBotPaused','takeoverFields'])
    if (!inb.includes(`export function ${fn}`)) fail(`inbound util lacks ${fn} (W-02/W-04)`);
  if (!inb.includes('OPT_OUT_KEYWORDS') || !inb.includes('OPT_IN_KEYWORDS')) fail('inbound util lacks opt-out/opt-in vocabulary (W-04)');
  else pass('Inbound util defines opt-out/opt-in keywords (W-04)');
  if (!inb.includes('norm.length > 40')) fail('a long sentence could be treated as a bare keyword (W-04)');
  else pass('Only a bare keyword opts a customer out (W-04)');
  if (!inb.includes('welcomed_at') || !inb.includes('message_count')) fail('welcome decision ignores the once-only marker (W-02)');
  else pass('Welcome is decided from welcomed_at + the fresh count (W-02)');
} catch { fail('src/utils/inbound.js missing (W-02/W-04)'); }
try {
  if (!indexJs.includes('extractInboundMessages(body)')) fail('the webhook still reads only the first message (W-04)');
  else pass('The webhook processes every message in the delivery (W-04)');
  if (indexJs.includes("body.entry?.[0]?.changes?.[0]?.value")) fail('the single-message read is back (W-04)');
  else pass('No single-message read remains (W-04)');
  if (!indexJs.includes('for (const item of inbound)')) fail('batched messages are not iterated (W-04)');
  else pass('Batched messages are handled sequentially (W-04)');
  if (!indexJs.includes('async function handleInboundMessage(')) fail('inbound handling is not isolated per message (W-04)');
  else pass('Each message is handled in isolation (W-04)');
  if (!indexJs.includes('classifyOptKeyword(msgText)') || !indexJs.includes('optOutFields(now,')) fail('STOP is not honoured (W-04)');
  else pass('STOP/UNSUBSCRIBE opt the customer out (W-04)');
  if (!indexJs.includes('isBotPaused(conv, now)')) fail('human takeover does not silence the bot (W-04)');
  else pass('Human takeover silences the bot (W-04)');
  if (!indexJs.includes('takeoverFields(new Date())')) fail('a manual reply does not take over the conversation (W-04)');
  else pass('A manual reply takes over the conversation (W-04)');
  if (!indexJs.includes("app.post('/whatsapp/conversations/:id/resume'")) fail('takeover cannot be released (W-04)');
  else pass('Takeover can be released (W-04)');
  if (!indexJs.includes("update({ welcomed_at:nowIso })")) fail('the welcome is never marked as sent (W-02)');
  else pass('The welcome is marked as sent exactly once (W-02)');
} catch { fail('index.js missing for the inbound checks'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261011_phase8_01_inbound_state.sql','utf8');
  const cols = ['welcomed_at','opted_out_at','opt_out_reason','human_takeover','bot_paused_until'];
  const missing = cols.filter(c => !mig.includes(c));
  if (missing.length) fail(`Phase 8.1 migration lacks: ${missing.join(', ')}`);
  else pass('Phase 8.1 migration present (welcome/opt-out/takeover columns)');
} catch { fail('Phase 8.1 migration file missing'); }
try {
  const t = fs.readFileSync('tests/unit/inbound.test.mjs','utf8');
  if (!t.includes('the stale row is exactly what the old code used')) fail('inbound test does not pin the welcome regression (W-02)');
  else pass('Inbound test pins the welcome-once regression (W-02)');
} catch { fail('tests/unit/inbound.test.mjs missing (W-02/W-04)'); }

// ── Phase 7.5 — analytics aggregates are exact, never a capped page (D-05) ──
try {
  const a = fs.readFileSync('src/utils/analytics.js','utf8');
  for (const fn of ['fetchAllRows','revenueTotals','revenueByDay','contentByType','contactsBySegment','ledgerTotals'])
    if (!a.includes(`export async function ${fn}`) && !a.includes(`export function ${fn}`)) fail(`analytics util lacks ${fn} (D-05)`);
  if (!a.includes('.range(from, from + pageSize - 1)')) fail('analytics util does not page PostgREST reads (D-05)');
  else pass('Analytics util reads every page (no 1,000-row truncation) (D-05)');
  if (!a.includes('isRpcMissing(rpc.error)')) fail('analytics util does not fall back when the aggregate RPC is missing (D-05)');
  else pass('Analytics aggregates prefer SQL, fall back to paging (D-05)');
  if (!a.includes('ANALYTICS_MAX_ROWS')) fail('analytics paging has no cap (D-05)');
  else pass('Analytics paging is capped and reports truncation (D-05)');
} catch { fail('src/utils/analytics.js missing (D-05)'); }
try {
  if (/from\('orders'\)\.select\('total'\)/.test(indexJs)) fail('all-time revenue is still read from one capped page (D-05)');
  else pass('No analytics aggregate is computed from a single capped page (D-05)');
  if (!indexJs.includes('revenueTotals(') || !indexJs.includes('ledgerTotals(')) fail('/analytics + /admin/revenue do not use the aggregates (D-05)');
  else pass('Analytics and admin revenue use the aggregates (D-05)');
  if (indexJs.includes('__analyticsCache')) fail('the undefined analytics cache reference is back (D-05)');
  else pass('Overview cache is a real TTL cache, not a ReferenceError (D-05)');
  if (!indexJs.includes('export capped at')) fail('a capped CSV export does not say so (D-05)');
  else pass('Capped exports declare the cap in the file (D-05)');
  if (!indexJs.includes('from_currency') && !indexJs.includes('by_currency')) fail('revenue responses do not separate currencies (B-05/D-05)');
  else pass('Revenue is reported per currency, never as one mixed sum (B-05)');
} catch { fail('index.js missing for the D-05 checks'); }
try {
  const mig = fs.readFileSync('supabase/migrations/20261010_phase7_05_analytics_aggregates.sql','utf8');
  const fns = ['analytics_revenue_by_currency','analytics_revenue_by_day','analytics_content_by_type','analytics_contacts_by_segment','analytics_ledger_totals'];
  const missing = fns.filter(f => !mig.includes(`FUNCTION ${f}`));
  if (missing.length) fail(`Phase 7.5 migration lacks: ${missing.join(', ')}`);
  else if (!mig.includes('REVOKE ALL ON FUNCTION')) fail('Phase 7.5 aggregates are callable by app roles');
  else pass('Phase 7.5 migration present (aggregates + service-only grants)');
} catch { fail('Phase 7.5 migration file missing'); }
try {
  const t = fs.readFileSync('tests/unit/analytics.test.mjs','utf8');
  if (!t.includes('the old code returned 10,000')) fail('analytics test does not pin the 1,001-row regression (D-05)');
  else pass('Analytics test pins the 1,001st row (D-05)');
} catch { fail('tests/unit/analytics.test.mjs missing (D-05)'); }

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
  console.error(`\n${fails} check(s) failed — Phase 8.3 hardening not done.`);
  process.exit(1);
} else {
  console.log('All security checks passed (Phases 1–8.3). ✅');
}
