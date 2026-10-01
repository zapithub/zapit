#!/usr/bin/env node
// ZAPIT — Security smoke check for CI (Phases 1–6.2)
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

console.log('');
if (fails) {
  console.error(`\n${fails} check(s) failed — Phase 6.2 not done.`);
  process.exit(1);
} else {
  console.log('All security checks passed (Phases 1–6.2). ✅');
}
