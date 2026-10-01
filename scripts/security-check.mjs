#!/usr/bin/env node
// Phase 1 — Security smoke check for CI
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

console.log('');
if (fails) {
  console.error(`\n${fails} check(s) failed — Phase 1 not done.`);
  process.exit(1);
} else {
  console.log('All Phase 1 security checks passed. ✅');
}
