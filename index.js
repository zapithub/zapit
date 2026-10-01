// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZAPIT BACKEND — index.js
// Version: 3.0.0 | Africa's #1 WhatsApp + Content SaaS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAN_LIMITS as __SRC_PLAN_LIMITS, getPricingForLocation as __srcGetPricing, formatPrice as __srcFormat } from './src/config/plans.js';
import { subscriptionCache, analyticsCache } from './src/utils/cache.js';
import { withAdvisoryLock } from './src/utils/distributedLock.js';
import { parsePagination, isValidEmail, isValidUsername, isStrongPassword, sanitizeStr, validateBody, pickFields } from './src/utils/validation.js';
import { generateOTP, hashOTP, verifyOTPRecord, attemptsAfterFailure, OTP_MAX_ATTEMPTS, OTP_TTL_MS } from './src/utils/otp.js';
import { verifyMetaSignature, verifyWebhookVerifyToken, claimWebhookEvent } from './src/utils/webhook.js';
import { generateRouteCode, resolveTenantForInbound, upsertWaCustomerTenant, claimSharedGuidance, resolveSendCreds } from './src/utils/tenantRouting.js';
import { evaluateCharge, resolveCharge, cancelSubscriptionPlan, reactivateDecision, activationFields, normalizeCycle } from './src/utils/billing.js';
import { newOAuthState, hashState, newPkcePair, stateDecision, sanitizeProviderError, buildAuthorizeUrl, OAUTH_STATE_TTL_MS } from './src/utils/oauth.js';
import { ACCESS_TOKEN_TTL, ACCESS_TOKEN_TTL_SEC, hashToken, newFamilyId, newSessionRow, legacySessionRow, isSessionReuse, isSessionActive, isMissingColumnError, REUSE_REASON } from './src/utils/session.js';
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, parseCookies, isMutating, csrfMatches, setAuthCookies, clearAuthCookies } from './src/utils/cookies.js';
import { METRICS, quotaGuard, consumeQuota, quotaExceededBody, usageSnapshot, metricForContentType, periodStart } from './src/utils/quota.js';
import { revenueTotals, revenueByDay, contentByType, contactsBySegment, ledgerTotals, fetchAllRows, headlineCurrency, ANALYTICS_MAX_ROWS } from './src/utils/analytics.js';
import { extractInboundMessages, messageTextOf, classifyOptKeyword, isGreetingOnly, shouldWelcome, isBotPaused, takeoverFields, optOutFields, optInFields, STOP_CONFIRMATION, START_CONFIRMATION } from './src/utils/inbound.js';
import { DRAFT_TTL_MS, isDraftActive, detectOrderIntent, isOrderMenuKeyword, isCancelKeyword, applyMessageToDraft, nextMissingSlot, questionFor, draftExpired, computeOrderTotals, orderPaymentReference, buildOrderSummary, paymentInstructions, orderConfirmedMessage, evaluateOrderPayment, validatePaymentReference } from './src/utils/orders.js';
import { isChargeableCurrency } from './src/config/plans.js';
import { planBroadcast, validateTemplate, templatePayload, broadcastOutcomeMessage } from './src/utils/broadcast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const execAsync  = promisify(exec);

// ─── RUNTIME REQUIREMENT ────────────────────────────────────────
// @supabase/realtime-js (pulled in by supabase-js) needs the built-in WebSocket
// and therefore Node 22+; on Node 20 `createClient()` throws "WebSocket not
// found" and the process dies at import with a stack trace that names neither
// cause nor fix (found by the Phase 8.4 CI proofs). Say it plainly instead.
const __nodeMajor = Number(String(process.versions.node).split('.')[0]);
if (Number.isFinite(__nodeMajor) && __nodeMajor < 22) {
  console.error(`[ENV] ZAPIT needs Node.js 22 or newer — running ${process.version}.`);
  console.error('      The Supabase realtime client requires the built-in WebSocket (see Dockerfile / .github/workflows/ci.yml).');
  process.exit(1);
}

// ─── ENV ────────────────────────────────────────────────────────
const {
  PORT                = 3000,
  NODE_ENV            = 'development',
  BACKEND_URL         = 'http://localhost:3000',
  FRONTEND_URL        = 'http://localhost:5500',
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  WA_ACCESS_TOKEN,
  WA_PHONE_NUMBER_ID,
  WA_VERIFY_TOKEN     = 'zapit_webhook_secret_2024',
  WA_APP_SECRET,
  SHARED_WA_NUMBER,
  HF_API_KEY,
  REPLICATE_API_KEY,
  OPENAI_API_KEY,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  META_APP_ID,
  META_APP_SECRET,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL  = 'zapithub@gmail.com',
  ADMIN_SECRET,
  ADMIN_USERNAMES     = 'admin',
  ADMIN_SEED_EMAIL,
  UNSPLASH_ACCESS_KEY,
  ENCRYPTION_KEY,
} = process.env;

// ─── WHATSAPP WEBHOOK SIGNING (Phase 6.2 — S-05) ─────────────────
// Meta signs every webhook delivery with the app secret. WA_APP_SECRET is the
// dedicated WhatsApp Business app secret; fall back to META_APP_SECRET when the
// same Meta app is used. Null ⇒ the POST webhook fails closed in production.
const WA_SIGNATURE_SECRET = WA_APP_SECRET || META_APP_SECRET || null;

// ─── RESERVED USERNAMES (Phase 6.1 — S-01) ───────────────────────
const RESERVED_USERNAMES = new Set([
  'admin','root','support','zapit','api','system','moderator','owner','superuser',
  'help','info','contact','service','zapithub','zapit_admin','administrator',
  'security','billing','abuse','postmaster','webmaster',
]);
function isReservedUsername(uname) {
  if (!uname || typeof uname !== 'string') return false;
  const lower = uname.toLowerCase().trim();
  if (RESERVED_USERNAMES.has(lower)) return true;
  const adminList = ADMIN_USERNAMES.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
  if (adminList.includes(lower)) return true;
  return false;
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  try { return crypto.timingSafeEqual(bufA, bufB); } catch { return false; }
}
function hasValidAdminSecret(headerVal) {
  if (!ADMIN_SECRET) return false;
  if (!headerVal || typeof headerVal !== 'string') return false;
  return safeEqual(String(headerVal), String(ADMIN_SECRET));
}
const SAFE_USER_SELECT = 'id,email,username,full_name,avatar_url,country_code,currency,timezone,language,phone,whatsapp_number,email_verified,phone_verified,referral_code,role,is_active,is_suspended,suspension_reason,created_at,last_login';
const SAFE_USER_SELECT_PUBLIC = 'id,email,username,full_name,avatar_url,country_code,currency,email_verified,role,is_active,is_suspended,created_at,last_login';

// ─── STARTUP ENV VALIDATION (Phase 1 — fail-closed) ─────────────
const __IS_PROD = NODE_ENV === 'production';
function __requireEnv(name, value, minLen = 16) {
  if (!value || value.length < minLen) {
    const msg = `[ENV] ${name} is missing or too short (min ${minLen} chars). Set a strong random value via env.`;
    if (__IS_PROD) { console.error(msg); process.exit(1); }
    else console.warn(`⚠️  ${msg} Using dev fallback (DO NOT use in production).`);
    return false;
  }
  return true;
}
const __hasJWTSecret      = __requireEnv('JWT_SECRET', JWT_SECRET, 32);
const __hasRefreshSecret  = __requireEnv('JWT_REFRESH_SECRET', JWT_REFRESH_SECRET, 32);
const __hasEncKey         = __requireEnv('ENCRYPTION_KEY', ENCRYPTION_KEY, 32);
const __effectiveJWTSecret     = JWT_SECRET || (__IS_PROD ? null : crypto.randomBytes(32).toString('hex'));
const __effectiveRefreshSecret = JWT_REFRESH_SECRET || (__IS_PROD ? null : crypto.randomBytes(32).toString('hex'));
const __effectiveEncKey        = ENCRYPTION_KEY || (__IS_PROD ? null : crypto.randomBytes(32).toString('hex'));

// Supabase must be configured — fail fast if not (no placeholder)
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  const msg = '[ENV] SUPABASE_URL and SUPABASE_SERVICE_KEY are required. Set them in your environment.';
  if (__IS_PROD) { console.error(msg); process.exit(1); }
  else console.warn('⚠️  ' + msg + ' Running in degraded mock mode (dev only).');
}
if (SUPABASE_URL && !SUPABASE_URL.startsWith('https://')) {
  console.warn('⚠️  SUPABASE_URL should be https://');
}

// ─── SUPABASE ────────────────────────────────────────────────────
const supabase = createClient(
  SUPABASE_URL        || 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_KEY || 'placeholder-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);
// Warn if placeholder is in use (dev only)
if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder')) {
  console.warn('⚠️  Supabase is running with placeholder credentials — all DB calls will fail. Set SUPABASE_URL/SERVICE_KEY.');
}

// ─── PLAN LIMITS ────────────────────────────────────────────────
// Source of truth is src/config/plans.js — this inline copy is kept for backward compat
// during Phase 2 migration. Run: node scripts/generate-pricing.mjs to keep public/pricing.json in sync.
// Future Phase 2 will remove this block and use import directly. Do not edit prices here.
const PLAN_LIMITS = __SRC_PLAN_LIMITS; // Phase 2: single source

// ─── EXPRESS SETUP ──────────────────────────────────────────────
const app = express();

// S-12/S-13: trust the platform proxy (Render = 1 hop) so req.ip is the real client.
// Set TRUST_PROXY=false when the app is exposed directly (then X-Forwarded-For is
// ignored entirely), or to the exact hop count behind other proxies.
const TRUST_PROXY_ENV = process.env.TRUST_PROXY;
app.set('trust proxy', TRUST_PROXY_ENV === undefined ? 1
  : TRUST_PROXY_ENV === 'false' ? false
  : (Number.isInteger(Number(TRUST_PROXY_ENV)) && Number(TRUST_PROXY_ENV) >= 0 ? Number(TRUST_PROXY_ENV) : 1));

// Request ID + structured logging
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});

// Security headers — strict but compatible with current inline styles/scripts
// CSP is set to report-only style for now to avoid breaking existing inline CSS/JS;
// Phase 3 will add nonces and move scripts to files for full enforcement.
app.use(helmet({
  contentSecurityPolicy: false, // Phase 3 will enable nonce-based CSP; keep off to avoid breaking inline styles
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Request-Id', req.id);
  next();
});

// CORS — strict allowlist, fail closed in production, allow preview hosts for Arena/E2B
const ALLOWED_ORIGINS = [
  FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5500',
  'http://127.0.0.1:5500', 'https://zapit.app', 'https://www.zapit.app',
].filter(Boolean);
const PREVIEW_HOST_RE = /^https:\/\/\d+-[a-z0-9-]+\.e2b\.app$/;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser / curl / webhook / health
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (PREVIEW_HOST_RE.test(origin)) return cb(null, true);
    if (NODE_ENV !== 'production') return cb(null, true); // allow in dev
    return cb(new Error('CORS: Origin not allowed'), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-secret','x-request-id'],
  exposedHeaders: ['x-request-id','Retry-After'],
}));

// Raw body for Paystack — must handle charset variants and come BEFORE json
app.use('/webhook/paystack', express.raw({ type: (req) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  return ct.includes('application/json');
}}));
// Raw body for WhatsApp — Meta's X-Hub-Signature-256 is computed over the exact
// bytes sent, so the signature must be verified against the unparsed body (S-05).
app.use('/webhook/whatsapp', express.raw({ type: () => true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = new Set([
      'image/jpeg','image/png','image/webp','video/mp4',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]);
    const allowedExt = new Set(['.jpg','.jpeg','.png','.webp','.mp4','.csv','.xlsx','.xls']);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeOk = allowedMime.has(file.mimetype);
    const extOk = !ext || allowedExt.has(ext);
    if (!mimeOk || !extOk) {
      return cb(new Error(`File type not allowed: ${file.mimetype} (${ext})`), false);
    }
    // Defer magic-byte validation to route handler via sharp (if image)
    cb(null, true);
  },
});

// ─── RATE LIMITERS ──────────────────────────────────────────────
const makeLimit = (windowMs, max, message, keyGen) =>
  rateLimit({
    windowMs, max,
    message: { success: false, error: message },
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: keyGen || ((req) => req.ip),
    handler: (req, res, next, opts) => {
      res.status(opts.statusCode).json({ success:false, error: opts.message.error || opts.message, retryAfter: res.getHeader('Retry-After') });
    }
  });

const globalLimiter  = makeLimit(15 * 60 * 1000, 300,  'Too many requests. Please slow down.');
const authLimiter    = makeLimit(15 * 60 * 1000, 20,   'Too many auth attempts. Wait 15 minutes.');
const otpLimiter     = makeLimit(60 * 1000,       3,    'Too many OTP requests. Wait a minute.');
const webhookLimiter = makeLimit(60 * 1000,       200,  'Webhook rate limit exceeded.');
const contentLimiter = makeLimit(60 * 60 * 1000,  50,   'AI generation limit reached for this hour.', (req) => req.user?.id || req.ip);
const adminLimiter   = makeLimit(15 * 60 * 1000,  50,   'Too many admin requests.');

app.use(globalLimiter);
app.use(requestLogger);

// ─── ENCRYPTION ─────────────────────────────────────────────────
// Note: scryptSync runs once at boot only; acceptable for startup. Phase 5 may move to async scrypt with warm cache.
// 32-byte key derivation with static salt is reused for all encrypt/decrypt; rotation requires re-encrypt.
const __encKeyForCipher = __effectiveEncKey || 'zapit-32-char-fallback-dev-only-key!!'.slice(0,32);
const CIPHER_KEY = crypto.scryptSync(__encKeyForCipher, 'zapit-salt-v3', 32);

function encrypt(text) {
  if (!text) return null;
  try {
    const iv        = crypto.randomBytes(16);
    const cipher    = crypto.createCipheriv('aes-256-cbc', CIPHER_KEY, iv);
    const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch { return null; }
}

function decrypt(text) {
  if (!text) return null;
  try {
    const [ivHex, enc] = text.split(':');
    const decipher     = crypto.createDecipheriv('aes-256-cbc', CIPHER_KEY, Buffer.from(ivHex, 'hex'));
    return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return null; }
}

function generateReferralCode() { return crypto.randomBytes(5).toString('hex').toUpperCase(); } // 10 chars, 40 bits — stronger
function generateOrderNumber()  { return `ZAP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
function sleep(ms)              { return new Promise(r => setTimeout(r, ms)); }
// S-15: same latency for "account exists" and "account does not exist".
function uniformDelay()         { return sleep(crypto.randomInt(150, 350)); }

// Phase 6.5: validation helpers are imported from src/utils/validation.js.
// (The removed local isValidEmail had a regex that rejected every address
// containing the letter "s".)
function requestLogger(req, _res, next) {
  const start = Date.now();
  const safeUrl = req.originalUrl.split('?')[0];
  console.log(JSON.stringify({ level:'info', reqId:req.id, method:req.method, url:safeUrl, ip:req.ip }));
  _res.on('finish', () => {
    const dur = Date.now()-start;
    const lvl = _res.statusCode >= 500 ? 'error' : _res.statusCode >= 400 ? 'warn' : 'info';
    console.log(JSON.stringify({ level:lvl, reqId:req.id, method:req.method, url:safeUrl, status:_res.statusCode, duration:dur }));
  });
  next();
}


// ─── JWT ────────────────────────────────────────────────────────
function generateTokens(userId, username, familyId) {
  // S-08: short-lived access token (15 min, env-clamped) + rotating refresh token
  // bound to a session family so a replayed refresh token can revoke the chain.
  const accessJti  = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  const accessToken  = jwt.sign({ sub: userId, username, type: 'access', jti: accessJti },  __effectiveJWTSecret,      { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh', jti: refreshJti, fam: familyId }, __effectiveRefreshSecret, { expiresIn: '30d' });
  return { accessToken, refreshToken, accessJti, refreshJti, familyId };
}

/** Create a session row (hashes only) with a graceful pre-migration fallback. */
async function createSession({ user, req, familyId }) {
  const fam    = familyId || newFamilyId();
  const tokens = generateTokens(user.id, user.username, fam);
  const base   = { userId:user.id, accessToken:tokens.accessToken, refreshToken:tokens.refreshToken, ip:req.ip, userAgent:req.headers['user-agent'] };
  let { error } = await supabase.from('sessions').insert(newSessionRow({ ...base, accessJti:tokens.accessJti, refreshJti:tokens.refreshJti, familyId:fam }));
  if (error && isMissingColumnError(error)) {
    console.warn(JSON.stringify({ level:'warn', msg:'sessions hashed columns missing — apply migration 20261008; using legacy rows', reqId:req.id }));
    ({ error } = await supabase.from('sessions').insert(legacySessionRow(base)));
  }
  if (error) throw new Error(error.message);
  return { ...tokens, refreshTokenHash: hashToken(tokens.refreshToken), accessTokenHash: hashToken(tokens.accessToken) };
}

/** S-08 reuse detection: revoke the whole family (or every session) and fail closed. */
async function revokeFamilyAndFail(res, { familyId, userId } = {}) {
  const nowIso = new Date().toISOString();
  try {
    const patch = { revoked_at:nowIso, revoked_reason:REUSE_REASON };
    if (familyId) await supabase.from('sessions').update(patch).eq('family_id', familyId);
    else if (userId) await supabase.from('sessions').update(patch).eq('user_id', userId);
  } catch (e) { console.warn(JSON.stringify({ level:'warn', msg:'family revoke failed', err:e.message })); }
  console.warn(JSON.stringify({ level:'warn', msg:'refresh token reuse detected — sessions revoked', userId:userId||null, familyId:familyId||null }));
  clearAuthCookies(res);
  return res.status(401).json({ success:false, error:'Session revoked for security reasons. Please log in again.' });
}

// ─── MIDDLEWARE: AUTH ────────────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    // S-09: accept the httpOnly cookie path as well as Bearer tokens. Cookie auth
    // is CSRF-protected with a double-submit token on every mutating request.
    const authHeader = req.headers.authorization;
    const bearer     = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookies     = parseCookies(req.headers.cookie);
    const cookieToken = cookies[AUTH_ACCESS_COOKIE] || null;
    const token       = bearer || cookieToken;

    if (!token)
      return res.status(401).json({ success: false, error: 'No token provided. Please log in.' });

    if (!bearer && isMutating(req.method) && !csrfMatches(req, cookies))
      return res.status(403).json({ success: false, error: 'CSRF check failed. Reload the page and try again.' });

    const decoded = jwt.verify(token, __effectiveJWTSecret);
    const nowIso  = new Date().toISOString();

    // S-08: sessions store only the sha256 of the access token.
    let { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, family_id')
      .eq('access_token_hash', hashToken(token))
      .gt('expires_at', nowIso)
      .is('revoked_at', null)
      .single();

    if (!session) {
      // Pre-7.2 rows (or a database where 20261008 is not applied yet) still use `token`.
      ({ data: session } = await supabase
        .from('sessions')
        .select('id, user_id')
        .eq('token', token)
        .gt('expires_at', nowIso)
        .single());
    }

    if (!session)
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });

    const { data: user } = await supabase
      .from('users')
      .select('id, email, username, full_name, country_code, currency, is_active, is_suspended')
      .eq('id', decoded.sub)
      .single();

    if (!user || !user.is_active || user.is_suspended)
      return res.status(403).json({ success: false, error: 'Account suspended or deactivated.' });

    req.user    = user;
    req.token   = token;
    req.session = session;
    req.authVia = bearer ? 'bearer' : 'cookie';
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success: false, error: 'Token expired. Please refresh your session.' });
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

// ─── MIDDLEWARE: ADMIN ───────────────────────────────────────────
async function requireAdmin(req, res, next) {
  // Phase 6.1 — harden: timingSafeEqual + DB role (not username) — fixes S-01/S-02
  if (hasValidAdminSecret(req.headers['x-admin-secret'])) {
    req.adminVia = 'secret';
    console.log(JSON.stringify({ level:'info', reqId:req.id, adminAction: `${req.method} ${req.path}`, userId: req.user?.id || 'secret', ip:req.ip, via:'secret' }));
    return next();
  }
  try {
    const { data: dbUser, error } = await supabase.from('users').select('role').eq('id', req.user?.id).single();
    if (!error && dbUser?.role === 'admin') {
      req.adminVia = 'role';
      console.log(JSON.stringify({ level:'info', reqId:req.id, adminAction: `${req.method} ${req.path}`, userId: req.user.id, ip:req.ip, via:'role' }));
      return next();
    }
  } catch (e) {
    console.warn(JSON.stringify({ level:'warn', reqId:req.id, msg:'admin role check failed', err: e.message }));
  }
  console.warn(JSON.stringify({ level:'warn', reqId:req.id, msg:'admin denied', ip:req.ip, path:req.path, userId: req.user?.id }));
  return res.status(403).json({ success: false, error: 'Admin access required.' });
}

// ─── HELPERS ────────────────────────────────────────────────────
async function getUserSubscription(userId) {
  // Phase 2 cache: 60s LRU, invalidated on paystack webhook / admin set-plan
  const cached = subscriptionCache.get(userId);
  if (cached) return cached;
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  const plan = data?.plan || 'free';
  const result = { subscription: data, plan, limits: PLAN_LIMITS[plan] || PLAN_LIMITS.free };
  subscriptionCache.set(userId, result);
  return result;
}

// Phase 7.3 (B-06): quota middleware bound to this module's client + plan lookup.
const quotaGuardFor = (metric, amount) => quotaGuard(metric, {
  supabase,
  getLimits: async (userId) => (await getUserSubscription(userId)).limits,
  amount,
});
function invalidateSubscriptionCache(userId) { if (userId) subscriptionCache.del(userId); }

// ─── EMAIL (BREVO) ───────────────────────────────────────────────
async function sendEmail({ to, toName, subject, htmlContent }) {
  if (!BREVO_API_KEY) {
    console.log(`[EMAIL MOCK] To:${to} | Subject:${subject}`);
    return { success: true, mock: true };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender:      { name: 'ZAPIT', email: BREVO_SENDER_EMAIL },
        to:          [{ email: to, name: toName || to }],
        subject,
        htmlContent,
      }),
    });
    const data = await res.json();
    return { success: res.ok, data };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

async function sendOTPEmail(email, otp, type = 'verify') {
  const subjectMap = { verify: 'Verify your ZAPIT account', reset: 'Reset your ZAPIT password', login: 'Your ZAPIT login code' };
  const actionMap  = { verify: 'Welcome! Use this code to verify your email:', reset: 'Use this code to reset your password:', login: 'Your one-time login code:' };
  return sendEmail({
    to: email,
    subject: subjectMap[type] || subjectMap.verify,
    htmlContent: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb">
      <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <h1 style="color:#6366F1;margin:0 0 8px">⚡ ZAPIT</h1>
        <p style="color:#374151;font-size:16px">${actionMap[type] || actionMap.verify}</p>
        <div style="background:#EEF2FF;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
          <span style="font-size:48px;font-weight:700;color:#6366F1;letter-spacing:8px">${otp}</span>
        </div>
        <p style="color:#6B7280;font-size:14px">This code expires in 10 minutes. Never share it with anyone.</p>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0">
        <p style="color:#9CA3AF;font-size:12px">ZAPIT — Your AI Sales Rep + Viral Content Machine 🚀</p>
      </div></body></html>`,
  });
}

// ─── PRICING ENGINE ──────────────────────────────────────────────
const COUNTRY_CURRENCY = {
  NG:'NGN', GH:'GHS', KE:'KES', ZA:'ZAR',
  US:'USD', GB:'GBP', CA:'USD', AU:'USD', DE:'EUR', FR:'EUR',
};

// S-13: never read X-Forwarded-For ourselves — Express (trust proxy=1) already
// resolves the real client address into req.ip. Reading the header directly let
// anyone spoof their country (currency arbitrage + a free geo-lookup proxy).
const DEFAULT_LOCATION = { country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' };
const geoCache = new Map(); // ip → { at, value }; bounded TTL cache (also caps ipapi.co usage)
const GEO_TTL_MS = 30 * 60 * 1000;

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(ip)) return true; // IPv6 ULA
  return false;
}

async function detectLocation(req) {
  const ip = clientIp(req);
  if (isPrivateIp(ip)) return { ...DEFAULT_LOCATION };
  const hit = geoCache.get(ip);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return hit.value;
  try {
    const r    = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { headers: { 'User-Agent':'zapit-backend/3.0' }, signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    const currency = COUNTRY_CURRENCY[data.country_code] || 'USD';
    const value = { country_code: data.country_code || 'NG', country_name: data.country_name || 'Nigeria', city: data.city || 'Lagos', currency, timezone: data.timezone || 'Africa/Lagos' };
    if (geoCache.size > 500) geoCache.clear();
    geoCache.set(ip, { at: Date.now(), value });
    return value;
  } catch {
    return { ...DEFAULT_LOCATION };
  }
}

// B-05: pricing lives in src/config/plans.js only — these aliases keep the old
// call sites but can never drift from the charge rules again.
const formatPrice           = __srcFormat;
const getPricingForLocation = __srcGetPricing;

// ─── PAYSTACK ───────────────────────────────────────────────────
// All gateway calls are time-bounded: a hanging upstream must never wedge a
// request handler or the webhook (which already acked Paystack).
// Phase 8.2: the Paystack endpoint is overridable outside production so the
// whole order loop (initialize → webhook verify → paid) can be smoke-tested
// end-to-end with `npm run smoke:order`. Production always talks to Paystack.
// Phase 8.3: same escape hatch for the WhatsApp Cloud API host (never in
// production) so the broadcast/template send path can be smoke-tested.
const BROADCAST_CRON = process.env.BROADCAST_CRON || '*/5 * * * *';
const WA_GRAPH_BASE = (process.env.NODE_ENV !== 'production' && process.env.WA_GRAPH_BASE)
  ? String(process.env.WA_GRAPH_BASE).replace(/\/+$/, '')
  : 'https://graph.facebook.com/v19.0';

const PAYSTACK_API_BASE = (process.env.NODE_ENV !== 'production' && process.env.PAYSTACK_API_BASE)
  ? String(process.env.PAYSTACK_API_BASE).replace(/\/+$/, '')
  : 'https://api.paystack.co';

async function paystackFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}

async function initializePaystack({ email, amount, currency = 'NGN', metadata, callback_url }) {
  const res = await paystackFetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: Math.round(amount * 100), currency, metadata, callback_url: callback_url || `${FRONTEND_URL}/payment-success` }),
  });
  return res.json();
}

async function verifyPaystack(reference) {
  const res = await paystackFetch(`${PAYSTACK_API_BASE}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  return res.json();
}

function verifyPaystackSig(rawBody, sig) {
  if (!PAYSTACK_SECRET_KEY || !sig) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
    .digest('hex');
  try {
    const a = Buffer.from(hash, 'utf8');
    const b = Buffer.from(String(sig), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// ─── ORDER + PAYMENT LOOP (Phase 8.2 — W-01) ─────────────────────
// The Phase 0 audit's biggest functional gap: `generateOrderNumber()` had zero
// call sites and a tenant's `paystack_secret_key` was never read, so no customer
// could actually order or pay in chat. The decision logic lives in
// src/utils/orders.js (pure); this is the I/O around it:
// message → draft → order row → Paystack link / bank reference → webhook marks
// paid → customer confirmation.

const ORDER_PRODUCT_TTL_MS = 60 * 1000;
const orderProductCache = new Map(); // userId → { at, products }

function safeDecryptValue(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

async function loadOrderProducts(userId) {
  const hit = orderProductCache.get(userId);
  if (hit && Date.now() - hit.at < ORDER_PRODUCT_TTL_MS) return hit.products;
  try {
    const { data } = await supabase.from('products')
      .select('id,name,price,sale_price,currency,stock_quantity,is_active')
      .eq('user_id', userId).limit(200);
    const products = (data || [])
      .filter(p => p && p.is_active !== false && Number(p.price) > 0)
      .map(p => ({ ...p, price: Number(p.sale_price) > 0 && Number(p.sale_price) < Number(p.price) ? Number(p.sale_price) : Number(p.price) }));
    if (orderProductCache.size > 500) orderProductCache.clear();
    orderProductCache.set(userId, { at: Date.now(), products });
    return products;
  } catch { return []; }
}

/** The send channel for a tenant, or null (W-07: never the platform token). */
function tenantSendCreds(settings) {
  try {
    return resolveSendCreds({
      connectionMethod: settings?.connection_method,
      waPhoneNumberId: settings?.wa_phone_number_id,
      waAccessToken: safeDecryptValue(settings?.wa_access_token),
    }, { phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN });
  } catch (e) { console.warn('[order send channel]', e.message); return null; }
}

/** Send a customer a message and mirror it into their conversation. */
async function notifyOrderCustomer({ userId, settings, contactId, phone, text }) {
  const creds = tenantSendCreds(settings);
  if (!creds || !phone) return false;
  try {
    await sendWAMessage({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, to: phone, message: text });
  } catch (e) { console.warn('[order notify skip]', e.message); return false; }
  try {
    let conversationId = null;
    if (contactId) {
      const { data: rows } = await supabase.from('conversations').select('id')
        .eq('user_id', userId).eq('contact_id', contactId).eq('status', 'open').limit(1);
      conversationId = (Array.isArray(rows) ? rows[0] : rows)?.id || null;
    }
    await supabase.from('messages').insert({
      conversation_id: conversationId, direction: 'outbound', type: 'text',
      content: text, status: 'sent', ai_processed: false,
    });
  } catch { /* the reply already went out; the inbox mirror is best-effort */ }
  return true;
}

async function loadOrderDraft(userId, contactId) {
  if (!contactId) return { draft: null, available: false };
  try {
    const { data, error } = await supabase.from('order_drafts').select('*')
      .eq('user_id', userId).eq('contact_id', contactId).limit(1);
    if (error) throw error;
    return { draft: (Array.isArray(data) ? data[0] : data) || null, available: true };
  } catch (e) {
    if (!/order_drafts/.test(String(e?.message || ''))) console.warn('[order draft read]', e.message);
    return { draft: null, available: false };
  }
}

async function saveOrderDraft({ userId, contactId, conversationId, draft }) {
  try {
    const { error } = await supabase.from('order_drafts').upsert({
      user_id: userId, contact_id: contactId, conversation_id: conversationId || null,
      product_id: draft.product_id || null, product_name: draft.product_name || null,
      unit_price: draft.unit_price ?? null, currency: draft.currency || null,
      quantity: draft.quantity ?? null, delivery_address: draft.delivery_address || null,
      items: draft.items || null, turns: draft.turns || 0, last_message: draft.last_message || null,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
    }, { onConflict: 'user_id,contact_id' });
    if (error) { console.warn('[order draft save]', error.message); return false; }
    return true;
  } catch (e) { console.warn('[order draft save]', e.message); return false; }
}

async function clearOrderDraft(userId, contactId) {
  if (!contactId) return;
  try { await supabase.from('order_drafts').delete().eq('user_id', userId).eq('contact_id', contactId); } catch {}
}

/** Insert the order row (with a pre-migration fallback shape). */
async function createOrderFromDraft({ businessSettings, businessUserId, contactRecord, from, customerName, draft }) {
  const totals      = computeOrderTotals({ unitPrice: draft.unit_price, quantity: draft.quantity, deliveryFee: businessSettings.delivery_fee });
  const orderNumber = generateOrderNumber();
  const reference   = orderPaymentReference(orderNumber);
  const currency    = String(draft.currency || 'NGN').toUpperCase();
  const canCharge   = isChargeableCurrency(currency) && !!safeDecryptValue(businessSettings.paystack_secret_key);
  const provider    = canCharge ? 'paystack' : (businessSettings.bank_details ? 'bank_transfer' : 'manual');
  const nowIso      = new Date().toISOString();
  const items       = [{ product_id: draft.product_id || null, name: draft.product_name, quantity: draft.quantity, unit_price: draft.unit_price, line_total: totals.subtotal }];
  const row = {
    user_id: businessUserId, order_number: orderNumber,
    customer_name: contactRecord?.name || customerName || 'Customer',
    customer_phone: from, customer_whatsapp: from,
    items, product_id: draft.product_id || null, quantity: draft.quantity, unit_price: draft.unit_price,
    subtotal: totals.subtotal, delivery_fee: totals.delivery_fee, total: totals.total, currency,
    delivery_address: draft.delivery_address,
    status: 'pending', payment_status: 'pending',
    payment_provider: provider, payment_reference: reference,
    payment_currency: currency, payment_amount: totals.total, payment_amount_minor: totals.minor,
    payment_requested_at: nowIso, source: 'whatsapp', created_at: nowIso, updated_at: nowIso,
  };
  const { data, error } = await supabase.from('orders').insert(row).select().single();
  if (!error) return data;
  if (/column|schema cache/i.test(String(error.message || ''))) {
    // Migration 20261012 not applied yet — record the legacy shape so the
    // merchant still sees the order; the payment fields degrade to totals only.
    const { data: legacy } = await supabase.from('orders').insert({
      user_id: businessUserId, order_number: orderNumber, customer_name: row.customer_name,
      customer_phone: from, customer_whatsapp: from, product_id: row.product_id,
      quantity: row.quantity, unit_price: row.unit_price, total: totals.total,
      currency, status: 'pending', payment_status: 'pending', created_at: nowIso,
    }).select().single();
    if (legacy) return { ...legacy, _legacy: true, items, delivery_address: draft.delivery_address, payment_amount_minor: totals.minor };
  }
  console.warn('[order create]', error.message);
  return null;
}

/** Initialise a Paystack transaction on the TENANT's account (their key). */
async function initializeOrderPayment({ order, settings, email }) {
  const secret = safeDecryptValue(settings?.paystack_secret_key);
  if (!secret) return null;
  const amountMinor = order.payment_amount_minor != null ? Number(order.payment_amount_minor) : Math.round(Number(order.total || 0) * 100);
  try {
    const res = await paystackFetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, amount: amountMinor, currency: order.payment_currency || order.currency || 'NGN',
        ...(validatePaymentReference(order.payment_reference) ? { reference: order.payment_reference } : {}),
        metadata: { order_id: order.id, order_number: order.order_number, user_id: order.user_id, source: 'zapit_chat_order' },
        callback_url: `${FRONTEND_URL}/payment-success?order=${encodeURIComponent(order.order_number)}`,
      }),
    }, 15000);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!json?.status || !json?.data?.authorization_url) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'order paystack init failed', order: order.order_number, err: json?.message || res.status }));
      return null;
    }
    return { link: json.data.authorization_url, reference: String(json.data.reference || order.payment_reference) };
  } catch (e) {
    console.warn('[order paystack init]', e.message);
    return null;
  }
}

/** Summary + how to pay, and create the gateway request when we can. */
async function requestOrderPayment({ order, settings, contact }) {
  const currency = String(order.payment_currency || order.currency || 'NGN').toUpperCase();
  let provider   = order.payment_provider || 'manual';
  const reference = order.payment_reference || order.order_number;
  const totals = {
    subtotal: Number(order.subtotal ?? (Number(order.unit_price || 0) * Number(order.quantity || 0))),
    delivery_fee: Number(order.delivery_fee || 0),
    total: Number(order.total || 0),
  };
  const summary = buildOrderSummary({
    draft: { product_name: order.items?.[0]?.name || order.product_name || 'your order', quantity: order.quantity, delivery_address: order.delivery_address || '' },
    orderNumber: order.order_number, totals, currency,
  });
  let link = order.payment_link || null;
  if (provider === 'paystack' && !link) {
    const initialized = await initializeOrderPayment({
      order, settings,
      email: contact?.email || `${String(order.customer_phone || order.customer_whatsapp || '').replace(/\D/g, '')}@whatsapp.customer`,
    });
    if (initialized) {
      link = initialized.link;
      try {
        await supabase.from('orders').update({ payment_link: link, payment_reference: initialized.reference, updated_at: new Date().toISOString() }).eq('id', order.id);
      } catch { /* the link still works; only the mirror failed */ }
    } else if (settings?.bank_details) {
      provider = 'bank_transfer';
      try { await supabase.from('orders').update({ payment_provider: 'bank_transfer', updated_at: new Date().toISOString() }).eq('id', order.id); } catch {}
    } else {
      provider = 'manual';
      try { await supabase.from('orders').update({ payment_provider: 'manual', updated_at: new Date().toISOString() }).eq('id', order.id); } catch {}
    }
  }
  const body = paymentInstructions({
    provider, amount: totals.total, currency, link, bankDetails: settings?.bank_details,
    orderNumber: order.order_number, reference, businessName: settings?.business_name,
  });
  return { message: `${summary}\n\n${body}`, link, provider };
}

/** Mark an order paid once the gateway has been independently verified. */
async function markOrderPaid({ order, settings, verifyData }) {
  const nowIso = new Date().toISOString();
  const updates = {
    payment_status: 'paid', paid_at: nowIso, payment_verified_at: nowIso,
    payment_amount: Number(verifyData?.amount ?? order.payment_amount_minor ?? 0) / 100,
    gateway_response: {
      reference: verifyData?.reference || order.payment_reference,
      amount: verifyData?.amount, currency: verifyData?.currency,
      channel: verifyData?.channel, gateway_response: verifyData?.gateway_response,
      paid_at: verifyData?.paid_at,
    },
    updated_at: nowIso,
  };
  // `enforce_order_transition` owns the order status machine: only the
  // pending → confirmed transition is ours to make here.
  if (['pending', 'confirmed'].includes(String(order.status || 'pending'))) updates.status = 'confirmed';
  const { data: updated, error } = await supabase.from('orders').update(updates)
    .eq('id', order.id).eq('payment_status', order.payment_status || 'pending').select();
  if (error || !(Array.isArray(updated) ? updated.length : updated)) {
    // The status guard may reject the transition — record the payment anyway.
    const { error: retryErr } = await supabase.from('orders')
      .update({ ...updates, status: undefined }).eq('id', order.id).eq('payment_status', order.payment_status || 'pending');
    if (retryErr) { console.error(JSON.stringify({ level: 'error', msg: 'order payment could not be recorded', order: order.order_number, err: retryErr.message })); return false; }
  }
  const message = settings?.payment_received_message
    ? String(settings.payment_received_message).replace('{order}', order.order_number)
    : orderConfirmedMessage(order.order_number);
  await notifyOrderCustomer({ userId: order.user_id, settings, contactId: null, phone: order.customer_whatsapp || order.customer_phone, text: message });
  console.log(JSON.stringify({ level: 'info', msg: 'order payment confirmed', order: order.order_number, userId: order.user_id, amount: updates.payment_amount }));
  return true;
}

/**
 * The Paystack webhook branch for in-chat orders. Returns true when the
 * reference belongs to one of our orders (so the subscription path below must
 * not try to interpret it), false otherwise.
 */
async function settleOrderCharge(event) {
  const data = event?.data || {};
  const reference = String(data.reference || '');
  if (!reference) return false;
  let order = null;
  try {
    const { data: rows } = await supabase.from('orders').select('*').eq('payment_reference', reference).limit(1);
    order = (Array.isArray(rows) ? rows[0] : rows) || null;
  } catch { return false; }                                   // pre-migration: not our reference
  if (!order) return false;
  if (order.payment_status === 'paid') { console.log(JSON.stringify({ level: 'info', msg: 'order payment duplicate', order: order.order_number, reference })); return true; }

  let settings = null;
  try {
    const { data: s } = await supabase.from('business_settings').select('*').eq('user_id', order.user_id).single();
    settings = s || null;
  } catch { settings = null; }

  const secret = safeDecryptValue(settings?.paystack_secret_key);
  if (!secret) {
    console.error(JSON.stringify({ level: 'error', msg: 'order payment cannot be verified — tenant Paystack key missing', order: order.order_number, reference }));
    return true;
  }
  let verify = null;
  try {
    const res = await paystackFetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    try { verify = await res.json(); } catch { verify = null; }
  } catch (e) { console.warn('[order verify]', e.message); return true; }

  const decision = evaluateOrderPayment({ order, verifyData: verify?.data, eventData: data });
  if (!decision.ok) {
    console.error(JSON.stringify({ level: 'error', msg: `order charge refused (${decision.reason}) — order NOT marked paid`, order: order.order_number, reference }));
    return true;
  }
  await markOrderPaid({ order, settings, verifyData: verify.data });
  return true;
}

/**
 * The in-chat loop itself. Returns true when it replied (so the generic AI
 * reply must not also fire), false to let processWAMessage answer.
 */
async function handleOrderFlow({ businessSettings, businessUserId, contactRecord, conv, from, customerName, msgText, send }) {
  const contactId = contactRecord?.id || null;
  const { draft: stored, available } = await loadOrderDraft(businessUserId, contactId);

  if (stored && isCancelKeyword(msgText)) {
    await clearOrderDraft(businessUserId, contactId);
    await send('No problem — I have cancelled that order. Message me any time if you change your mind. 🙂');
    return true;
  }

  const active = stored && !draftExpired(stored) ? stored : null;
  const wantsOrder = detectOrderIntent(msgText) || isOrderMenuKeyword(msgText);
  if (!active && !wantsOrder) return false;
  if (active && !wantsOrder && !isDraftActive(active)) {
    // An old draft must not hijack an unrelated question — drop it and let the
    // AI answer; the customer can start again with "order".
    await clearOrderDraft(businessUserId, contactId);
    return false;
  }

  const products = await loadOrderProducts(businessUserId);
  if (!products.length) return false;                        // nothing to sell → the AI answers

  const { draft } = applyMessageToDraft({ text: msgText, draft: active, products });
  if (!draft) return false;

  const missing = nextMissingSlot(draft);
  if (missing) {
    if (!available) return false;                            // cannot persist a multi-turn draft
    draft.last_message = String(msgText).slice(0, 300);
    if (!(await saveOrderDraft({ userId: businessUserId, contactId, conversationId: conv?.id, draft }))) return false;
    let question = questionFor(missing);
    if (missing === 'product' && products.length <= 8) {
      const lines = products.slice(0, 8).map(p => `• ${p.name} — ${String(p.currency || 'NGN').toUpperCase()} ${Number(p.price).toLocaleString('en-US')}`);
      question = `Sure! Here's what we have:\n${lines.join('\n')}\n\nWhich one would you like?`;
    }
    await send(question);
    return true;
  }

  // Complete → order row + payment request.
  const order = await createOrderFromDraft({ businessSettings, businessUserId, contactRecord, from, customerName, draft });
  if (!order) { await send('Sorry — I could not place that order just now. Please try again in a moment.'); return true; }
  await clearOrderDraft(businessUserId, contactId);
  const payment = await requestOrderPayment({ order, settings: businessSettings, contact: contactRecord });
  await send(payment.message);
  return true;
}

// ─── WHATSAPP HELPERS ───────────────────────────────────────────
// Phase 6.1 — W-07: never silently fall back to platform tokens when tenant creds are null
async function sendWAMessage({ phoneNumberId, accessToken, to, message }) {
  if (!to || !message) throw new Error('sendWAMessage: to and message are required');
  const token = accessToken;
  const numberId = phoneNumberId;
  if (!token || !numberId) {
    if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) {
      console.log(`[WA MOCK] To:${to} | ${String(message).substring(0, 80)}`);
      return { success: true, mock: true, reason: 'no credentials — mock' };
    }
    throw new Error('Missing tenant WhatsApp credentials — configure your dedicated number in Settings → WhatsApp (individual mode).');
  }
  try {
    const res = await fetch(`${WA_GRAPH_BASE}/${numberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }),
    });
    const data = await res.json();
    return { success: res.ok, data };
  } catch (err) {
    console.error('[WA ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

async function markWARead(messageId, phoneNumberId, accessToken) {
  const token = accessToken;
  const numberId = phoneNumberId;
  if (!token || !numberId) return;
  try {
    await fetch(`${WA_GRAPH_BASE}/${numberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch (e) {
    // Read receipts are cosmetic — never let them break message handling.
    console.warn('[WA read receipt]', e.message);
  }
}

// ─── SHARED-NUMBER ROUTING HELPERS (Phase 6.3 — S-06) ────────────
// Route codes make shared-number delivery deterministic: customers prefix their
// message with #CODE once and are remembered afterwards (wa_customer_tenant).

/** Pick a code not yet used by another tenant (check only; safe before INSERT). */
async function pickFreeRouteCode(db) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRouteCode();
    const { data: taken } = await db.from('business_settings').select('id').eq('wa_route_code', code).limit(1);
    if (!Array.isArray(taken) || taken.length === 0) return code;
  }
  return null;
}

/** Assign a free code to an existing tenant row, retrying on a unique-index race. */
async function assignRouteCode(db, userId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = await pickFreeRouteCode(db);
    if (!code) return null;
    const { error } = await db.from('business_settings').update({ wa_route_code: code }).eq('user_id', userId);
    if (!error) return code;
    if (error.code !== '23505') { console.error('[route code] assignment failed:', error.message || error.code); return null; }
  }
  return null;
}

/**
 * Guidance reply for a shared-number message we could not route (throttled per
 * customer, non-fatal). Only ever sent from the PLATFORM's own shared number.
 */
async function maybeSendRoutingGuidance(routing, phoneNumberId, customerPhone) {
  try {
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) return;                       // platform channel not configured
    if (routing.via !== 'unmatched' && routing.via !== 'unknown_code') return; // ambiguous/unknown number → stay silent
    if (!(await claimSharedGuidance(supabase, phoneNumberId, customerPhone))) return;
    const message = routing.via === 'unknown_code'
      ? `❌ We couldn't find a business with code #${routing.code}. Please check the code your business gave you and try again.`
      : `👋 Welcome! To reach a business on this number, start your message with their code — for example:\n\n#K7F9QA Hello\n\nAsk the business you're trying to reach for their ZAPIT code.`;
    await sendWAMessage({ phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN, to: customerPhone, message });
  } catch (e) { console.warn('[WA routing guidance skip]', e.message); }
}

// ─── AI CONTENT ENGINE ──────────────────────────────────────────
const FORBIDDEN_PHRASES = [
  'dive into','dive in','unlock','elevate','unleash','transform',
  'game-changer','revolutionary','cutting-edge','next level',
  'embark on a journey','explore the world of','discover the secrets',
  "in today's fast-paced",'level up','supercharge','skyrocket',
];

const TONE_EMOTIONS = {
  professional: 'Trust, authority, competence',
  casual:       'Relatability, friendship, comfort',
  friendly:     'Warmth, approachability, helpfulness',
  funny:        'Joy, entertainment, shareability',
  inspirational:'Hope, motivation, empowerment',
  urgent:       'FOMO, scarcity, immediate action',
};

const PLATFORM_RULES = {
  tiktok:    { hook: '3 seconds',  length: '150 words', hashtags: '5-8'   },
  instagram: { hook: '5 seconds',  length: '125 words', hashtags: '15-30' },
  facebook:  { hook: '10 seconds', length: '250 words', hashtags: '3-5'   },
  youtube:   { hook: '8 seconds',  length: '200 words', hashtags: '5-10'  },
  twitter:   { hook: '2 seconds',  length: '280 chars', hashtags: '1-3'   },
};

const HASHTAG_LIMITS = { tiktok:8, instagram:30, facebook:5, youtube:10, twitter:3 };

function removeAIFingerprints(text) {
  const subs = [
    [/\bdive into\b/gi,'explore'],[/\bunlock\b/gi,'discover'],[/\belevate\b/gi,'improve'],
    [/\bunleash\b/gi,'release'],[/\btransform\b/gi,'change'],[/\bgame-changer\b/gi,'different'],
    [/\bembark on a journey\b/gi,'start'],[/\bin today's fast-paced world\b/gi,''],
  ];
  let out = text;
  subs.forEach(([p, r]) => { out = out.replace(p, r); });
  return out;
}

function parseCaption(raw, platform) {
  const parts    = raw.split('[HASHTAGS]');
  let caption    = (parts[0] || raw).replace('[CAPTION]', '').trim();
  const hashLine = parts[1] || '';
  const hashtags = hashLine.trim().split(/\s+/).filter(h => h.startsWith('#'));
  caption = removeAIFingerprints(caption).replace(/\. /g, '.\n\n');
  const limit = HASHTAG_LIMITS[platform] || 5;
  return { caption: caption.trim(), hashtags: hashtags.slice(0, limit), word_count: caption.split(' ').length, char_count: caption.length };
}

async function generateCaption({ topic, platform = 'instagram', tone = 'professional', language = 'en', brandVoice, product }) {
  const pr      = PLATFORM_RULES[platform] || PLATFORM_RULES.tiktok;
  const emotion = TONE_EMOTIONS[tone] || 'Engagement, connection, value';
  const forbidden = FORBIDDEN_PHRASES.map(p => `❌ "${p}"`).join('\n   ');

  const brandSection = brandVoice
    ? `Tone:${brandVoice.tone} | Style:${brandVoice.writing_style} | Emoji:${brandVoice.emoji_usage} | Audience:${brandVoice.target_audience} | Forbidden:${(brandVoice.forbidden_words||[]).join(', ')} | Sample:${brandVoice.sample_captions?.[0] || 'none'}`
    : 'Use professional-friendly African tone';

  const productSection = product
    ? `Product:${product.name} | Price:${product.currency} ${product.price} | Focus on transformation/outcome not features`
    : 'No product — focus on topic value';

  const ctaByPlatform = {
    tiktok:    "Comment [WORD] and I'll send you the link",
    instagram: 'Save this for later or share with someone who needs it',
    facebook:  'Tag a friend who needs to see this',
    youtube:   'Subscribe for more and watch till the end',
    twitter:   'Retweet if this helped you',
  };

  const prompt = `You are the world's most successful social media copywriter specializing in African markets (Nigeria, Ghana, Kenya).

FORBIDDEN PHRASES — use any of these and the content FAILS:
   ${forbidden}

WRITING RULES:
✅ Use contractions (don't, can't, it's)
✅ Start sentences with And/But/Because
✅ Use African street language (wahala, omo, my guy)
✅ Reference Lagos, Nairobi, Accra where relevant
✅ Use exact numbers not vague words
✅ Mix short and long sentences for rhythm

HOOK FORMULA (First ${pr.hook}): Use ONE of:
- Pattern Interrupt: "Most people don't know this about ${topic}..."
- Story Hook: "Last week something crazy happened..."
- Question Hook: "Ever wonder why [relatable problem]?"
- Bold Statement: "This is the best [category] in Nigeria. Period."

BODY: 2-3 short paragraphs, one idea each, generous line breaks for mobile.

CTA for ${platform}: ${ctaByPlatform[platform] || 'Drive action clearly'}

EMOTIONAL TARGET — Tone:${tone} | Emotion:${emotion}

LANGUAGE: ${language === 'pidgin' ? 'Mix English + Pidgin naturally ("This thing dey work well well")' : 'African English (not American/British)'}

HASHTAGS — ${pr.hashtags} tags: 30% trending + 40% niche + 20% location (#LagosNigeria) + 10% branded. ALL at end after [HASHTAGS].

BRAND VOICE: ${brandSection}
PRODUCT: ${productSection}

TOPIC: ${topic}
PLATFORM: ${platform}
MAX LENGTH: ${pr.length}

Output EXACTLY:
[CAPTION]
your caption here

[HASHTAGS]
#tag1 #tag2

BEGIN:`;

  // 1. Try Hugging Face
  if (HF_API_KEY) {
    try {
      const res = await fetch('https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct', {
        method: 'POST',
        headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens:500, temperature:0.92, top_p:0.92, repetition_penalty:1.3, do_sample:true, return_full_text:false },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw  = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
        if (raw) return parseCaption(raw, platform);
      }
    } catch (e) { console.error('[HF CAPTION]', e.message); }
  }

  // 2. Try OpenAI fallback
  if (OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role:'system', content:'You are a viral social media copywriter for African markets. Output in [CAPTION] ... [HASHTAGS] ... format.' },
            { role:'user',   content: prompt },
          ],
          max_tokens: 500, temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw  = data.choices?.[0]?.message?.content;
        if (raw) return parseCaption(raw, platform);
      }
    } catch (e) { console.error('[OPENAI CAPTION]', e.message); }
  }

  // 3. Template fallback
  const hooks = [
    `Most people don't know this about ${topic}...`,
    `I was today years old when I learned this about ${topic}.`,
    `Nobody talks about this when it comes to ${topic}.`,
  ];
  const caption = `${hooks[Math.floor(Math.random() * hooks.length)]}\n\nEvery serious business owner in Nigeria needs to pay attention to ${topic}. This is the kind of thing that separates those who make money from those who wonder why sales are slow.\n\nSave this post. Share it with a business partner. You'll thank me later.`;
  const defaultTags = {
    tiktok:    ['#BusinessTips','#NigerianBusiness','#AfricanEntrepreneur','#HustleAfrica','#SMEAfrica'],
    instagram: ['#BusinessTips','#NigerianBusiness','#AfricanEntrepreneur','#HustleAfrica','#SMEAfrica','#LagosHustle','#GhanaBusiness','#KenyaBusiness','#AfricaRising'],
    facebook:  ['#BusinessTips','#AfricanEntrepreneur','#SMEAfrica'],
    youtube:   ['#BusinessTips','#NigerianBusiness','#AfricanEntrepreneur','#SMEAfrica','#HustleAfrica'],
    twitter:   ['#BusinessTips','#AfricaRising'],
  };
  return { caption: removeAIFingerprints(caption), hashtags: (defaultTags[platform] || defaultTags.tiktok), word_count: caption.split(' ').length, char_count: caption.length };
}

async function generateCaptionSafe(opts) {
  try {
    return await generateCaption(opts);
  } catch (err) {
    console.error('[CAPTION SAFE FALLBACK]', err.message);
    const caption = `Don't sleep on ${opts.topic}.\n\nEvery hustler in Lagos knows that staying ahead means acting fast. This is your sign.\n\nSave this, share it, and let's grow together.`;
    return { caption: removeAIFingerprints(caption), hashtags: ['#BusinessTips','#NaijaHustle','#AfricaRising','#SMEAfrica'], word_count: caption.split(' ').length, char_count: caption.length };
  }
}

async function pollReplicate(predictionId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(3000);
    try {
      const res  = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, { headers: { Authorization: `Token ${REPLICATE_API_KEY}` } });
      const pred = await res.json();
      if (pred.status === 'succeeded') return Array.isArray(pred.output) ? pred.output[0] : pred.output;
      if (pred.status === 'failed')    throw new Error('Replicate failed: ' + (pred.error || 'unknown'));
    } catch (err) {
      if (err.message.startsWith('Replicate failed:')) throw err;
    }
  }
  throw new Error(`Replicate timeout after ${maxAttempts * 3}s`);
}

async function fetchStockImage(topic) {
  if (UNSPLASH_ACCESS_KEY) {
    try {
      const res  = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(topic)}&per_page=1&orientation=squarish`, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
      const data = await res.json();
      if (data.results?.[0]?.urls?.regular) return data.results[0].urls.regular;
    } catch {}
  }
  return `https://picsum.photos/1080/1080?random=${Date.now()}`;
}

async function generateAIImage({ topic, aspectRatio = '1:1', style = 'photorealistic' }) {
  const styles = {
    photorealistic: 'Professional photography, sharp focus, natural lighting, high resolution',
    illustration:   'Digital illustration, vibrant colors, clean lines, modern design',
    minimalist:     'Minimalist design, simple composition, negative space, elegant',
    vibrant:        'Bold colors, high contrast, eye-catching, energetic composition',
  };
  const imagePrompt = `${topic}. Style: ${styles[style] || styles.photorealistic}. African context, culturally appropriate, social media optimized, no text overlays.`;
  if (REPLICATE_API_KEY) {
    try {
      const res  = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { Authorization: `Token ${REPLICATE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'black-forest-labs/flux-schnell', input: { prompt: imagePrompt, aspect_ratio: aspectRatio, num_outputs: 1, output_quality: 90 } }),
      });
      const pred = await res.json();
      if (pred.id) return await pollReplicate(pred.id, 30);
    } catch (e) { console.error('[IMAGE GEN]', e.message); }
  }
  return fetchStockImage(topic);
}

async function generateAIVideo({ topic, caption, duration = 6, aspectRatio = '9:16', style = 'modern' }) {
  const styles = {
    modern:    'Cinematic, professional lighting, vibrant colors, smooth camera movements',
    energetic: 'Fast-paced, dynamic transitions, bold colors, high energy',
    calm:      'Peaceful, slow motion, pastel colors, serene atmosphere',
    luxury:    'Premium, elegant, sophisticated, gold accents, soft focus',
  };
  const videoPrompt = `${topic}. ${styles[style] || styles.modern}. African context, mobile-optimized, scroll-stopping. Context: ${(caption || '').substring(0, 80)}.`;
  if (REPLICATE_API_KEY) {
    try {
      const res  = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { Authorization: `Token ${REPLICATE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'minimax/video-01', input: { prompt: videoPrompt, duration: Math.min(duration, 6), aspect_ratio: aspectRatio } }),
      });
      const pred = await res.json();
      if (pred.id) return await pollReplicate(pred.id, 120);
    } catch (e) { console.error('[VIDEO GEN]', e.message); }
  }
  return generateStaticVideoFallback({ topic, caption, duration });
}

async function generateStaticVideoFallback({ topic, caption, duration = 15 }) {
  try {
    const imgUrl     = await fetchStockImage(topic);
    const outputPath = `/tmp/video_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`;
    const safeCaption = (caption || topic).replace(/[^\p{L}\p{N} .,!?'":;()\-]/gu, '').replace(/\n/g, ' ').substring(0, 80);
    // Use spawn with arg array to avoid shell injection
    const { spawn } = await import('child_process');
    const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.001,1.3)':d=${duration * 25}:s=1080x1920,drawtext=text='${safeCaption.replace(/:/g,'\\:')}':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.6:boxborderw=8`;
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-y','-loop','1','-i', String(imgUrl), '-vf', vf, '-t', String(duration), '-c:v','libx264','-pix_fmt','yuv420p','-r','25', outputPath], { timeout: 60000 });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0,500)}`));
      });
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('ffmpeg timeout')); }, 62000);
    });
    return outputPath;
  } catch { return null; }
}

async function uploadToStorage(sourceUrlOrPath, userId, type = 'image') {
  if (!sourceUrlOrPath) return null;
  try {
    let fileBuffer, contentType;
    if (sourceUrlOrPath.startsWith('/tmp/')) {
      if (!fs.existsSync(sourceUrlOrPath)) return null;
      fileBuffer   = fs.readFileSync(sourceUrlOrPath);
      contentType  = type === 'video' ? 'video/mp4' : 'image/jpeg';
      // Validate image magic bytes with sharp if image
      if (type === 'image') {
        try { await sharp(fileBuffer).metadata(); } catch { console.warn('[uploadToStorage] invalid image buffer'); return null; }
      }
    } else {
      const r = await fetch(sourceUrlOrPath);
      if (!r.ok) return sourceUrlOrPath;
      fileBuffer  = Buffer.from(await r.arrayBuffer());
      if (fileBuffer.length > 10 * 1024 * 1024) { console.warn('[uploadToStorage] file too large'); return sourceUrlOrPath; }
      contentType = r.headers.get('content-type') || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      if (type === 'image' && fileBuffer.length > 0) {
        try { await sharp(fileBuffer).metadata(); } catch { console.warn('[uploadToStorage] fetched image invalid'); }
      }
    }
    const ext      = type === 'video' ? 'mp4' : 'jpg';
    const fileName = `${userId}/${type}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('content-media').upload(fileName, fileBuffer, { contentType, cacheControl: '3600', upsert: false });
    if (error) return sourceUrlOrPath;
    const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
    return publicUrl;
  } catch { return sourceUrlOrPath; }
}

// ─── WHATSAPP BOT BRAIN ─────────────────────────────────────────
async function processWAMessage({ businessUserId, customerPhone, customerMessage, businessSettings, conversationId }) {
  const msgLower = customerMessage.toLowerCase().trim();

  // 1. Knowledge base keyword match
  const { data: kbEntries } = await supabase.from('knowledge_base').select('*').eq('user_id', businessUserId).eq('is_active', true);
  if (kbEntries) {
    for (const entry of kbEntries) {
      if (msgLower.includes(entry.trigger.toLowerCase())) {
        await supabase.from('knowledge_base').update({ hit_count: (entry.hit_count || 0) + 1, last_used: new Date().toISOString() }).eq('id', entry.id);
        return { response: entry.response, source: 'knowledge_base', confidence: 1.0 };
      }
    }
  }

  // 2. Fetch products for context
  const { data: products } = await supabase.from('products').select('name, price, currency, description, stock_quantity').eq('user_id', businessUserId).eq('is_active', true).limit(20);
  const productList = products?.length
    ? products.map(p => `${p.name} — ${p.currency} ${p.price}${p.stock_quantity != null ? ` (${p.stock_quantity} in stock)` : ''}`).join('\n')
    : 'Contact us for our current offerings.';

  const bizName   = businessSettings?.business_name || 'our business';
  const lang      = businessSettings?.language_preference || 'en';
  const langNote  = lang === 'pidgin' ? 'Mix English + Pidgin naturally' : lang === 'yo' ? 'Use Yoruba mixed with English' : 'Use simple clear English';
  const payments  = (businessSettings?.payment_methods || ['bank_transfer']).join(', ');
  const delivery  = businessSettings?.delivery_days || 'Contact us for delivery info';

  const systemPrompt = `You are a helpful ${businessSettings?.bot_personality || 'professional'} AI sales assistant for ${bizName}.

Job: Answer questions, help place orders, be friendly and concise. Never be rude. Respond in ${langNote}.

Business: ${bizName} | Category: ${businessSettings?.business_category || 'General'}
${businessSettings?.business_description ? `About: ${businessSettings.business_description}` : ''}

Products:
${productList}

Payment: ${payments}
Delivery: ${delivery}

RULES:
- Keep replies under 200 words
- If customer wants to buy, ask for name, address, quantity
- Give prices directly when asked
- If unsure, offer to connect to a human
- End with a clear next step

Customer: "${customerMessage}"

Reply (warm, helpful, conversational):`;

  let aiResponse = null;

  if (HF_API_KEY) {
    try {
      const res = await fetch('https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct', {
        method: 'POST',
        headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: systemPrompt, parameters: { max_new_tokens:300, temperature:0.7, top_p:0.9, repetition_penalty:1.1, do_sample:true, return_full_text:false } }),
      });
      if (res.ok) {
        const data = await res.json();
        aiResponse = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
      }
    } catch (e) { console.error('[WA BOT HF]', e.message); }
  }

  if (!aiResponse && OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model:'gpt-4o-mini', messages:[{ role:'system', content:`Sales assistant for ${bizName}. Be concise and friendly.` },{ role:'user', content:systemPrompt }], max_tokens:300, temperature:0.7 }),
      });
      if (res.ok) { const d = await res.json(); aiResponse = d.choices?.[0]?.message?.content; }
    } catch (e) { console.error('[WA BOT OAI]', e.message); }
  }

  if (!aiResponse) {
    const fallback = businessSettings?.away_message || `Thanks for reaching out to ${bizName}! 🙏\n\nWe've received your message and will get back to you shortly.\n\nFor urgent inquiries, please call us directly.`;
    return { response: fallback, source: 'fallback', confidence: 0.0 };
  }

  // Log AI interaction
  const { data: aiLog } = await supabase.from('ai_logs').insert({
    user_id: businessUserId, customer_message: customerMessage, customer_phone: customerPhone,
    ai_response: aiResponse.trim(), ai_model: HF_API_KEY ? 'qwen2.5-72b' : 'gpt-4o-mini',
    ai_confidence: 0.85, conversation_id: conversationId,
  }).select().single();

  // ─── AUTO-LEARN ──────────────────────────────────────────────
  // After every confident AI reply, check if the trigger already
  // exists in this subscriber's KB. If not, save it automatically
  // so the bot gets faster and more accurate with every conversation
  // without the subscriber having to do anything manually.
  try {
    // Extract the first 3–6 meaningful words as a trigger key
    const stopWords = new Set(['i','a','an','the','is','are','do','does','can','you','we','my','me','to','of','and','or','for','in','on','at','please','hi','hello','hey','what','how','where','when','why','who']);
    const triggerWords = msgLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
      .slice(0, 4);

    if (triggerWords.length >= 1) {
      const autoTrigger = triggerWords.join(' ').trim().substring(0, 80);

      // Check if a KB entry with a similar trigger already exists
      const { data: existingKb } = await supabase
        .from('knowledge_base')
        .select('id, trigger')
        .eq('user_id', businessUserId)
        .eq('is_active', true);

      const alreadyExists = existingKb && existingKb.some(entry => {
        const entryTrigger = entry.trigger.toLowerCase();
        // Match if trigger contains any of our new trigger words
        return triggerWords.some(word => entryTrigger.includes(word)) ||
               autoTrigger.includes(entryTrigger);
      });

      if (!alreadyExists && autoTrigger.length >= 3) {
        // Check subscriber's KB limit before auto-saving
        const { count: kbCount } = await supabase
          .from('knowledge_base')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', businessUserId);

        const { limits: subLimits } = await getUserSubscription(businessUserId);
        const kbLimit = subLimits?.knowledge_base_limit || 20;

        // Throttle: max 3 auto-learn per user per day
        let autoToday = 0;
        try {
          const since = new Date(new Date().setHours(0,0,0,0)).toISOString();
          const { count } = await supabase.from('knowledge_base').select('id',{count:'exact',head:true}).eq('user_id', businessUserId).eq('auto_learned', true).gte('created_at', since);
          autoToday = count || 0;
        } catch {}
        if (autoToday >= 3) {
          console.log(JSON.stringify({ level:'info', msg:'auto-learn throttled', userId: businessUserId, autoToday }));
        } else if ((kbCount || 0) < Math.floor(kbLimit * 0.9)) {
          // Only auto-save if under 90% of limit (leave headroom for manual entries)
          await supabase.from('knowledge_base').insert({
            user_id:    businessUserId,
            trigger:    autoTrigger,
            response:   aiResponse.trim(),
            category:   'Auto-Learned',
            language:   lang || 'en',
            is_active:  false, // Phase 4: needs approval — not active until user promotes
            needs_approval: true,
            auto_learned: true,
            hit_count:  0,
          });

          // Mark the AI log as auto-promoted
          if (aiLog?.id) {
            await supabase.from('ai_logs')
              .update({ promoted_to_kb: true, promoted_at: new Date().toISOString() })
              .eq('id', aiLog.id)
              ;
          }
        }
      }
    }
  } catch (autoLearnErr) {
    // Auto-learn is non-critical — never let it break the bot reply
    console.error('[AUTO-LEARN]', autoLearnErr.message);
  }
  // ─────────────────────────────────────────────────────────────

  return { response: aiResponse.trim(), source: 'ai', confidence: 0.85 };
}

// ─── SOCIAL PUBLISHING ──────────────────────────────────────────
async function publishToInstagram(account, content) {
  const token     = decrypt(account.access_token);
  const accountId = account.account_id;
  const caption   = `${content.caption || ''}\n\n${(content.hashtags || []).join(' ')}`.trim();
  const isVideo   = !!content.video_url;
  const mediaUrl  = isVideo ? content.video_url : content.image_url;
  if (!mediaUrl) throw new Error('No media URL for Instagram');

  const params = new URLSearchParams({ caption, access_token: token, ...(isVideo ? { video_url: mediaUrl, media_type:'REELS' } : { image_url: mediaUrl }) });
  const cRes  = await fetch(`https://graph.facebook.com/v18.0/${accountId}/media?${params}`, { method:'POST' });
  const cData = await cRes.json();
  if (!cData.id) throw new Error('Instagram container error: ' + JSON.stringify(cData));

  if (isVideo) await sleep(30000);

  const pRes  = await fetch(`https://graph.facebook.com/v18.0/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: cData.id, access_token: token }),
  });
  const pData = await pRes.json();
  if (!pData.id) throw new Error('Instagram publish error: ' + JSON.stringify(pData));
  return { post_id: pData.id, post_url: `https://www.instagram.com/p/${pData.id}/` };
}

async function publishToFacebook(account, content) {
  const token   = decrypt(account.access_token);
  const pageId  = account.account_id;
  const message = `${content.caption || ''}\n\n${(content.hashtags || []).join(' ')}`.trim();
  const params  = new URLSearchParams({ message, access_token: token });
  if (content.image_url) params.append('url', content.image_url);
  const endpoint = content.image_url ? `https://graph.facebook.com/v18.0/${pageId}/photos` : `https://graph.facebook.com/v18.0/${pageId}/feed`;
  const res   = await fetch(`${endpoint}?${params}`, { method:'POST' });
  const data  = await res.json();
  if (!data.id && !data.post_id) throw new Error('Facebook publish error: ' + JSON.stringify(data));
  const postId = data.post_id || data.id;
  return { post_id: postId, post_url: `https://www.facebook.com/${postId}` };
}

async function publishToTikTok(account, content) {
  const token = decrypt(account.access_token);
  const res   = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info:   { title:(content.caption || '').substring(0, 150), privacy_level:'PUBLIC_TO_EVERYONE', disable_duet:false, disable_comment:false, disable_stitch:false },
      source_info: { source:'PULL_FROM_URL', video_url: content.video_url || content.image_url },
    }),
  });
  const data = await res.json();
  if (data.error?.code && data.error.code !== 'ok') throw new Error('TikTok error: ' + data.error.message);
  return { post_id: data.data?.publish_id || 'pending', post_url: null };
}

async function publishToYouTube(account, content) {
  const token = decrypt(account.access_token);
  if (!content.video_url) throw new Error('No video URL for YouTube');
  const vRes = await fetch(content.video_url);
  if (!vRes.ok) throw new Error('Could not fetch video for YouTube upload');
  const videoBuffer = Buffer.from(await vRes.arrayBuffer());
  const metaBody = JSON.stringify({
    snippet: { title:(content.caption || 'New Short').substring(0,100), description:`${content.caption || ''}\n\n${(content.hashtags||[]).join(' ')}`, tags: content.hashtags || [], categoryId:'22' },
    status:  { privacyStatus:'public' },
  });
  const uploadRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body: metaBody,
  });
  const uploadData = await uploadRes.json();
  if (!uploadData.id) throw new Error('YouTube upload error: ' + JSON.stringify(uploadData));
  return { post_id: uploadData.id, post_url: `https://www.youtube.com/shorts/${uploadData.id}` };
}

async function publishContent(post, content) {
  const results = {};
  const errors  = {};
  for (const platform of (post.platforms || [])) {
    const { data: account } = await supabase.from('connected_accounts').select('*').eq('user_id', post.user_id).eq('platform', platform).eq('is_active', true).single();
    if (!account) { errors[platform] = 'Account not connected'; continue; }
    try {
      if      (platform === 'instagram') results[platform] = await publishToInstagram(account, content);
      else if (platform === 'facebook')  results[platform] = await publishToFacebook(account, content);
      else if (platform === 'tiktok')    results[platform] = await publishToTikTok(account, content);
      else if (platform === 'youtube')   results[platform] = await publishToYouTube(account, content);
    } catch (err) {
      errors[platform] = err.message;
      console.error(`[PUBLISH] ${platform} error:`, err.message);
    }
  }
  return { results, errors };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 1: AUTH ROUTES (12) ─────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /auth/register
app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, username, password, full_name, referral_code, country_code } = req.body;
    const valErrs = validateBody({
      email:    { required:true, type:'string', validate:v=>isValidEmail(v)?null:'Valid email is required.' },
      username: { required:true, type:'string', validate:v=>isValidUsername(v)?null:'Username 3-30 chars, letters/numbers/underscore.' },
      password: { required:true, type:'string' },
    }, req.body);
    if (valErrs.length) return res.status(400).json({ success:false, error: valErrs[0] });
    if (!email || !username || !password)
      return res.status(400).json({ success:false, error:'Email, username and password are required.' });
    const pwdErr = isStrongPassword(password);
    if (pwdErr) return res.status(400).json({ success:false, error: pwdErr });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ success:false, error:'Username must be 3-30 characters: letters, numbers, underscores only.' });
    if (isReservedUsername(username))
      return res.status(400).json({ success:false, error:'This username is reserved. Please choose another.' });

    const [{ data: existEmail }, { data: existUser }] = await Promise.all([
      supabase.from('users').select('id').eq('email', email.toLowerCase()).single(),
      supabase.from('users').select('id').eq('username', username.toLowerCase()).single(),
    ]);
    if (existEmail || existUser) {
      // S-15: one neutral message — never disclose WHICH identifier is taken.
      return res.status(409).json({ success:false, error:'We could not create an account with these details. If you already have an account, log in or reset your password — otherwise try a different email and username.' });
    }

    let referrerId = null;
    if (referral_code) {
      const { data: ref } = await supabase.from('users').select('id').eq('referral_code', referral_code.toUpperCase()).single();
      if (ref) referrerId = ref.id;
    }

    const location      = await detectLocation(req);
    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error: uErr } = await supabase.from('users').insert({
      email:         email.toLowerCase(),
      username:      username.toLowerCase(),
      password_hash,
      full_name:     full_name || username,
      referral_code: generateReferralCode(),
      referred_by:   referrerId,
      country_code:  (country_code && COUNTRY_CURRENCY[String(country_code).toUpperCase()]) ? String(country_code).toUpperCase() : location.country_code,
      currency:      location.currency,
      timezone:      location.timezone,
      email_verified: false,
      is_active:     true,
      is_suspended:  false,
    }).select().single();
    if (uErr) throw uErr;

    await supabase.from('subscriptions').insert({ user_id:user.id, plan:'free', status:'active', billing_cycle:'free', amount_paid:0, currency:location.currency });

    if (referrerId) {
      // Prevent self-referral (same user) — already impossible via email uniqueness, but double-check
      if (String(referrerId) === String(user.id)) {
        console.warn(JSON.stringify({ level:'warn', msg:'self-referral blocked', userId:user.id }));
      } else {
        const holdUntil = new Date(Date.now() + 14*24*60*60*1000).toISOString();
        await supabase.from('referrals').insert({ referrer_id:referrerId, referred_id:user.id, referred_signed_up:true, status:'pending', hold_until: holdUntil, ip_address: req.ip });
      }
    }

    const otp = generateOTP();
    await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:hashOTP(otp), type:'email_verify', expires_at:new Date(Date.now() + OTP_TTL_MS).toISOString() });
    await sendOTPEmail(email.toLowerCase(), otp, 'verify');

    const tokens = await createSession({ user, req });
    setAuthCookies(res, { ...tokens, accessMaxAge:ACCESS_TOKEN_TTL_SEC });

    return res.status(201).json({
      success: true,
      message: 'Account created! Check your email for a verification code.',
      data: {
        user: { id:user.id, email:user.email, username:user.username, full_name:user.full_name, email_verified:false },
        access_token:  tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in:    ACCESS_TOKEN_TTL_SEC,
      },
    });
  } catch (err) {
    console.error('[REGISTER]', err);
    return res.status(500).json({ success:false, error:'Registration failed. Please try again.' });
  }
});

// POST /auth/login
app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success:false, error:'Email and password are required.' });
    if (!isValidEmail(email)) return res.status(400).json({ success:false, error:'Valid email is required.' });
    if (String(password).length > 128) return res.status(400).json({ success:false, error:'Password too long.' });

    const { data: user } = await supabase.from('users').select(SAFE_USER_SELECT + ',password_hash').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ success:false, error:'Invalid email or password.' });
    if (user.is_suspended)  return res.status(403).json({ success:false, error:`Account suspended: ${user.suspension_reason || 'Contact support.'}` });
    if (!user.is_active)    return res.status(403).json({ success:false, error:'Account deactivated. Contact support.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success:false, error:'Invalid email or password.' });

    const tokens = await createSession({ user, req });
    setAuthCookies(res, { ...tokens, accessMaxAge:ACCESS_TOKEN_TTL_SEC });
    await supabase.from('users').update({ last_login:new Date().toISOString() }).eq('id', user.id);

    const { plan } = await getUserSubscription(user.id);
    return res.json({
      success: true,
      data: {
        user: { id:user.id, email:user.email, username:user.username, full_name:user.full_name, avatar_url:user.avatar_url, country_code:user.country_code, currency:user.currency, email_verified:user.email_verified, plan },
        access_token:  tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in:    ACCESS_TOKEN_TTL_SEC,
      },
    });
  } catch (err) {
    console.error('[LOGIN]', err);
    return res.status(500).json({ success:false, error:'Login failed. Please try again.' });
  }
});

// POST /auth/logout
app.post('/auth/logout', authenticate, async (req, res) => {
  // S-08: revoke (audit trail) when the hashed schema is present, delete otherwise.
  const nowIso = new Date().toISOString();
  const revoked = req.session?.id
    ? await supabase.from('sessions').update({ revoked_at:nowIso, revoked_reason:'logout' }).eq('id', req.session.id)
    : { error:true };
  if (revoked.error) {
    const legacy = await supabase.from('sessions').delete().eq('token', req.token);
    if (legacy.error) await supabase.from('sessions').update({ revoked_at:nowIso, revoked_reason:'logout' }).eq('access_token_hash', hashToken(req.token));
  }
  clearAuthCookies(res);
  return res.json({ success:true, message:'Logged out successfully.' });
});

// POST /auth/logout-all
app.post('/auth/logout-all', authenticate, async (req, res) => {
  const nowIso = new Date().toISOString();
  const revoked = await supabase.from('sessions').update({ revoked_at:nowIso, revoked_reason:'logout_all' }).eq('user_id', req.user.id);
  if (revoked.error) await supabase.from('sessions').delete().eq('user_id', req.user.id);
  clearAuthCookies(res);
  return res.json({ success:true, message:'All sessions terminated.' });
});

// POST /auth/verify-email
app.post('/auth/verify-email', otpLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success:false, error:'Email and code are required.' });

    if (!isValidEmail(email)) return res.status(400).json({ success:false, error:'Valid email is required.' });

    // S-15: read the newest code for this address (select('*') keeps this
    // working before the `attempts` migration is applied) and decide in one place.
    const { data: record } = await supabase.from('otp_verifications').select('*')
      .eq('email', email.toLowerCase()).eq('type','email_verify')
      .order('created_at', { ascending:false }).limit(1).single();

    const decision = verifyOTPRecord({ record, codeHash: hashOTP(String(code)) });
    if (decision.reason === 'locked') {
      return res.status(429).json({ success:false, error:'Too many failed attempts for this code. Request a new one.' });
    }
    if (!decision.ok) {
      if (record && !record.verified) {
        try { await supabase.from('otp_verifications').update({ attempts: attemptsAfterFailure(record) }).eq('id', record.id); } catch {}
      }
      return res.status(400).json({ success:false, error:'Invalid or expired code. Please request a new one.' });
    }

    await supabase.from('otp_verifications').update({ verified:true }).eq('id', record.id);
    await supabase.from('users').update({ email_verified:true }).eq('email', email.toLowerCase());
    return res.json({ success:true, message:'Email verified! Your account is now active.' });
  } catch {
    return res.status(500).json({ success:false, error:'Verification failed. Please try again.' });
  }
});

// POST /auth/resend-otp
app.post('/auth/resend-otp', otpLimiter, async (req, res) => {
  try {
    const { email, type = 'email_verify' } = req.body;
    if (!email) return res.status(400).json({ success:false, error:'Email is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ success:false, error:'Valid email is required.' });
    if (!['email_verify','password_reset'].includes(type)) return res.status(400).json({ success:false, error:'Invalid OTP type.' });
    await supabase.from('otp_verifications').update({ verified:true }).eq('email', email.toLowerCase()).eq('type', type).eq('verified',false);
    const otp = generateOTP();
    await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:hashOTP(otp), type, expires_at:new Date(Date.now()+OTP_TTL_MS).toISOString() });
    await sendOTPEmail(email.toLowerCase(), otp, type === 'email_verify' ? 'verify' : 'reset');
    return res.json({ success:true, message:'Verification code sent! Check your email.' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to send code. Please try again.' });
  }
});

// POST /auth/forgot-password
app.post('/auth/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success:false, error:'Email is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ success:false, error:'Valid email is required.' });
    const { data: user } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (user) {
      const otp = generateOTP();
      await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:hashOTP(otp), type:'password_reset', expires_at:new Date(Date.now()+OTP_TTL_MS).toISOString() });
      // Deliver in the background: the response must not take longer for a
      // registered address than for an unknown one (S-15 timing oracle).
      sendOTPEmail(email.toLowerCase(), otp, 'reset').then(undefined, e => console.warn('[otp email]', e.message));
    }
    await uniformDelay();
    return res.json({ success:true, message:"If this email exists, a reset code has been sent." });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to process request.' });
  }
});

// POST /auth/reset-password
app.post('/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) return res.status(400).json({ success:false, error:'Email, code and new password are required.' });
    const pwdErr2 = isStrongPassword(new_password);
    if (pwdErr2) return res.status(400).json({ success:false, error: pwdErr2 });

    if (!isValidEmail(email)) return res.status(400).json({ success:false, error:'Valid email is required.' });

    const { data: record } = await supabase.from('otp_verifications').select('*')
      .eq('email', email.toLowerCase()).eq('type','password_reset')
      .order('created_at',{ ascending:false }).limit(1).single();

    const decision = verifyOTPRecord({ record, codeHash: hashOTP(String(code)) });
    if (decision.reason === 'locked') {
      return res.status(429).json({ success:false, error:'Too many failed attempts for this code. Request a new one.' });
    }
    if (!decision.ok) {
      if (record && !record.verified) {
        try { await supabase.from('otp_verifications').update({ attempts: attemptsAfterFailure(record) }).eq('id', record.id); } catch {}
      }
      return res.status(400).json({ success:false, error:'Invalid or expired reset code.' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash, updated_at:new Date().toISOString() }).eq('email', email.toLowerCase());
    await supabase.from('otp_verifications').update({ verified:true }).eq('id', record.id);
    const { data: user } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (user) await supabase.from('sessions').delete().eq('user_id', user.id);
    return res.json({ success:true, message:'Password reset successfully. Please log in.' });
  } catch {
    return res.status(500).json({ success:false, error:'Password reset failed.' });
  }
});

// GET /auth/me
app.get('/auth/me', authenticate, async (req, res) => {
  try {
    const { data: user } = await supabase.from('users')
      .select('id,email,username,full_name,avatar_url,country_code,currency,timezone,language,phone,whatsapp_number,email_verified,phone_verified,referral_code,created_at,last_login')
      .eq('id', req.user.id).single();
    const { subscription, plan, limits } = await getUserSubscription(req.user.id);
    return res.json({ success:true, data:{ user:{ ...user, plan }, subscription, limits } });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to fetch user info.' });
  }
});

// PATCH /auth/update-profile — Phase 6.1 S-22: explicit select (no password_hash)
app.patch('/auth/update-profile', authenticate, async (req, res) => {
  try {
    const allowed = ['full_name','phone','whatsapp_number','timezone','language','avatar_url'];
    const updates = { updated_at:new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select(SAFE_USER_SELECT_PUBLIC).single();
    if (error) throw error;
    return res.json({ success:true, data:{ user:data }, message:'Profile updated!' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to update profile.' });
  }
});

// PATCH /auth/change-password
app.patch('/auth/change-password', authenticate, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ success:false, error:'Old and new passwords are required.' });
    const pwdErr3 = isStrongPassword(new_password);
    if (pwdErr3) return res.status(400).json({ success:false, error: pwdErr3 });
    const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();
    if (!(await bcrypt.compare(old_password, user.password_hash))) return res.status(401).json({ success:false, error:'Current password is incorrect.' });
    await supabase.from('users').update({ password_hash:await bcrypt.hash(new_password, 12), updated_at:new Date().toISOString() }).eq('id', req.user.id);
    const revokeOthers = await supabase.from('sessions').update({ revoked_at:new Date().toISOString(), revoked_reason:'password_change' }).eq('user_id', req.user.id).neq('access_token_hash', hashToken(req.token));
    if (revokeOthers.error) await supabase.from('sessions').delete().eq('user_id', req.user.id).neq('token', req.token);
    return res.json({ success:true, message:'Password changed successfully.' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to change password.' });
  }
});

// POST /auth/refresh-token
app.post('/auth/refresh-token', async (req, res) => {
  try {
    const presented = req.body?.refresh_token || parseCookies(req.headers.cookie)[AUTH_REFRESH_COOKIE] || null;
    if (!presented) return res.status(400).json({ success:false, error:'Refresh token is required.' });
    const refresh_token = presented;

    let decoded;
    try { decoded = jwt.verify(refresh_token, __effectiveRefreshSecret); }
    catch { return res.status(401).json({ success:false, error:'Invalid or expired refresh token.' }); }

    const rtHash = hashToken(refresh_token);

    // 1) hashed row first; the legacy raw column keeps pre-20261008 deployments working
    let { data: session } = await supabase.from('sessions').select('*').eq('refresh_token_hash', rtHash).single();
    if (!session) { ({ data: session } = await supabase.from('sessions').select('*').eq('refresh_token', refresh_token).single()); }

    // 2) a spent token means theft — revoke the family, never just refuse this request
    if (session && isSessionReuse(session)) return revokeFamilyAndFail(res, { familyId:session.family_id, userId:session.user_id });
    if (!session) {
      const { data: byJti } = await supabase.from('sessions').select('id, user_id, family_id, revoked_at, rotated_at').eq('refresh_jti', decoded.jti).limit(1);
      const hit = Array.isArray(byJti) ? byJti[0] : byJti;
      if (hit && isSessionReuse(hit)) return revokeFamilyAndFail(res, { familyId:hit.family_id, userId:hit.user_id });
      return res.status(401).json({ success:false, error:'Invalid refresh token.' });
    }
    if (!isSessionActive(session)) return res.status(401).json({ success:false, error:'Refresh token expired. Please log in again.' });

    const { data: user } = await supabase.from('users').select('id,username,is_active,is_suspended').eq('id', decoded.sub).single();
    if (!user || !user.is_active || user.is_suspended) return res.status(403).json({ success:false, error:'Account not available.' });

    // 3) rotate: a fresh row continues the family, the spent row is marked used
    const tokens = await createSession({ user, req, familyId: session.family_id || decoded.fam || newFamilyId() });
    const spent  = await supabase.from('sessions').update({
      rotated_at:new Date().toISOString(), revoked_at:new Date().toISOString(),
      revoked_reason:'rotated', replaced_by_hash:tokens.refreshTokenHash,
    }).eq('id', session.id);
    if (spent.error) await supabase.from('sessions').delete().eq('id', session.id);   // legacy schema: one row per session
    setAuthCookies(res, { ...tokens, accessMaxAge:ACCESS_TOKEN_TTL_SEC });
    return res.json({ success:true, data:{ access_token:tokens.accessToken, refresh_token:tokens.refreshToken, expires_in:ACCESS_TOKEN_TTL_SEC } });
  } catch (err) {
    console.warn(JSON.stringify({ level:'warn', msg:'refresh failed', err:err.message }));
    return res.status(401).json({ success:false, error:'Invalid or expired refresh token.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 2: ONBOARDING ROUTES (8) ────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /onboarding/status
app.get('/onboarding/status', authenticate, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data:biz }, { count:prodCount }, { count:socialCount }] = await Promise.all([
      supabase.from('business_settings').select('*').eq('user_id', uid).single(),
      supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id', uid),
      supabase.from('connected_accounts').select('id',{ count:'exact', head:true }).eq('user_id', uid),
    ]);
    const steps = {
      business_info:        !!biz?.business_name,
      whatsapp_connected:   !!(biz?.wa_phone_number_id || biz?.connection_method === 'shared'),
      payment_setup:        !!(biz?.paystack_public_key || biz?.bank_details),
      products_added:       (prodCount || 0) > 0,
      social_connected:     (socialCount || 0) > 0,
      onboarding_complete:  !!biz?.onboarding_complete,
    };
    const completed  = Object.values(steps).filter(Boolean).length;
    const total      = Object.keys(steps).length;
    return res.json({ success:true, data:{ steps, percentage:Math.round((completed/total)*100), completed, total } });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to fetch onboarding status.' });
  }
});

// POST /onboarding/business-info
app.post('/onboarding/business-info', authenticate, async (req, res) => {
  try {
    const { business_name, business_category, business_description, language_preference, bot_personality } = req.body;
    const bName = sanitizeStr(business_name, 120);
    if (!bName) return res.status(400).json({ success:false, error:'Business name is required.' });
    if (business_description && String(business_description).length > 2000) return res.status(400).json({ success:false, error:'Business description too long (max 2000).' });
    const payload = { user_id:req.user.id, business_name: bName, business_category:sanitizeStr(business_category||'General',60), business_description: sanitizeStr(business_description, 2000), language_preference:sanitizeStr(language_preference||'en',20), bot_personality:sanitizeStr(bot_personality||'professional',30), updated_at:new Date().toISOString() };
    const { data:existing } = await supabase.from('business_settings').select('id').eq('user_id', req.user.id).single();
    const result = existing
      ? await supabase.from('business_settings').update(payload).eq('user_id', req.user.id).select().single()
      : await supabase.from('business_settings').insert(payload).select().single();
    if (result.error) throw result.error;
    return res.json({ success:true, data:result.data, message:'Business info saved!' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to save business info.' });
  }
});

// POST /onboarding/whatsapp
app.post('/onboarding/whatsapp', authenticate, async (req, res) => {
  try {
    const { connection_method='shared', wa_phone_number_id, wa_business_account_id, wa_access_token } = req.body;
    const updates = { connection_method, updated_at:new Date().toISOString() };
    if (connection_method === 'individual') {
      if (!wa_phone_number_id || !wa_access_token)
        return res.status(400).json({ success:false, error:'Phone Number ID and Access Token are required for individual connection.' });
      updates.wa_phone_number_id        = wa_phone_number_id;
      updates.wa_business_account_id    = wa_business_account_id;
      updates.wa_access_token           = encrypt(wa_access_token);
    } else {
      // S-06: NEVER store the platform's number/token on a tenant row. Shared mode is
      // routed by route code + sticky map; the platform sends only on its own number.
      updates.wa_phone_number_id     = null;
      updates.wa_access_token        = null;
      updates.wa_business_account_id = null;
    }
    const { data:existing } = await supabase.from('business_settings').select('id,wa_route_code').eq('user_id', req.user.id).single();
    let routeCode = existing?.wa_route_code || null;
    if (connection_method === 'shared' && !routeCode) {
      routeCode = existing
        ? await assignRouteCode(supabase, req.user.id)   // race-safe: unique index + retry
        : await pickFreeRouteCode(supabase);             // new row: insert carries the code
      if (!routeCode) return res.status(500).json({ success:false, error:'Could not allocate a routing code. Please retry.' });
      updates.wa_route_code = routeCode;
    }
    if (existing) await supabase.from('business_settings').update(updates).eq('user_id', req.user.id);
    else await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id, business_name:'My Business' });
    return res.json({
      success:true,
      message: connection_method==='shared'
        ? `Connected! Shared number: ${SHARED_WA_NUMBER}. Your routing code is #${routeCode}`
        : 'Your WhatsApp Business number is now connected.',
      data:{ connection_method, shared_number: connection_method==='shared'?SHARED_WA_NUMBER:null, route_code: connection_method==='shared' ? routeCode : null },
    });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to connect WhatsApp.' });
  }
});

// POST /onboarding/payment-setup
app.post('/onboarding/payment-setup', authenticate, async (req, res) => {
  try {
    const { paystack_public_key, paystack_secret_key, bank_details, payment_methods } = req.body;
    const updates = { updated_at:new Date().toISOString() };
    if (paystack_public_key) updates.paystack_public_key = paystack_public_key;
    if (paystack_secret_key) updates.paystack_secret_key = encrypt(paystack_secret_key);
    if (bank_details)        updates.bank_details        = bank_details;
    if (payment_methods)     updates.payment_methods     = payment_methods;
    const { data:existing } = await supabase.from('business_settings').select('id').eq('user_id', req.user.id).single();
    if (existing) await supabase.from('business_settings').update(updates).eq('user_id', req.user.id);
    else await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id, business_name:'My Business' });
    return res.json({ success:true, message:'Payment settings saved!' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to save payment settings.' });
  }
});

// POST /onboarding/products
app.post('/onboarding/products', authenticate, async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || !products.length) return res.status(400).json({ success:false, error:'At least one product is required.' });
    const { limits } = await getUserSubscription(req.user.id);
    const { count } = await supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id', req.user.id);
    if ((count||0) + products.length > limits.products_limit)
      return res.status(403).json({ success:false, error:`Product limit (${limits.products_limit}) would be exceeded. Upgrade your plan.` });
    const { data, error } = await supabase.from('products').insert(products.map(p => ({ ...p, user_id:req.user.id }))).select();
    if (error) throw error;
    return res.json({ success:true, data, message:`${data.length} product(s) added!` });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to add products.' });
  }
});

// POST /onboarding/social-connect
app.post('/onboarding/social-connect', authenticate, async (req, res) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ success:false, error:'Platform is required.' });
  return res.json({ success:true, data:{ auth_url:`${BACKEND_URL}/social/connect/${platform}`, platform }, message:`Visit the URL to connect ${platform}.` });
});

// POST /onboarding/apply-template
app.post('/onboarding/apply-template', authenticate, async (req, res) => {
  try {
    const { template_code } = req.body;
    if (!template_code) return res.status(400).json({ success:false, error:'template_code is required.' });
    const { data:tpl } = await supabase.from('business_type_templates').select('*').eq('code', template_code).single();
    if (!tpl) return res.status(404).json({ success:false, error:'Template not found.' });
    if (tpl.sample_products?.length)    await supabase.from('products').insert(tpl.sample_products.map(p => ({ ...p, user_id:req.user.id })));
    if (tpl.sample_kb_entries?.length)  await supabase.from('knowledge_base').insert(tpl.sample_kb_entries.map(e => ({ ...e, user_id:req.user.id })));
    if (tpl.sample_settings)            await supabase.from('business_settings').upsert({ user_id:req.user.id, business_name:'My Business', ...tpl.sample_settings });
    return res.json({ success:true, message:`Template "${tpl.name}" applied! Products and keywords pre-loaded.` });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to apply template.' });
  }
});

// POST /onboarding/complete
app.post('/onboarding/complete', authenticate, async (req, res) => {
  try {
    await supabase.from('business_settings').update({ onboarding_complete:true, updated_at:new Date().toISOString() }).eq('user_id', req.user.id);
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id', req.user.id).single();
    const { data:user }     = await supabase.from('users').select('whatsapp_number').eq('id', req.user.id).single();
    if (settings && user?.whatsapp_number) {
      try {
        const creds = resolveSendCreds({
          connectionMethod: settings.connection_method,
          waPhoneNumberId: settings.wa_phone_number_id,
          waAccessToken: settings.wa_access_token ? decrypt(settings.wa_access_token) : null,
        }, { phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN });
        await sendWAMessage({
          phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken,
          to:user.whatsapp_number,
          message:`🎉 Congratulations! Your ZAPIT bot is now LIVE for ${settings.business_name}. Your AI sales rep is ready to handle customers 24/7. Sleep well! 😴`,
        });
      } catch (e) { console.warn('[onboarding notify skip]', e.message); } // never fail onboarding over a notification
    }
    return res.json({ success:true, message:'Setup complete! Your AI sales rep is now live! 🚀' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to complete onboarding.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 3: WHATSAPP ROUTES (18+) ────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /whatsapp/settings
app.get('/whatsapp/settings', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('business_settings').select('*').eq('user_id', req.user.id).single();
    if (data) { data.wa_access_token = data.wa_access_token ? '[ENCRYPTED]' : null; data.paystack_secret_key = data.paystack_secret_key ? '[ENCRYPTED]' : null; }
    return res.json({ success:true, data: data || {} });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch settings.' }); }
});

// PATCH /whatsapp/settings
app.patch('/whatsapp/settings', authenticate, async (req, res) => {
  try {
    const allowed = ['business_name','business_category','business_description','business_logo_url','auto_reply','welcome_message','away_message','order_confirmation_message','payment_received_message','language_preference','bot_personality','delivery_areas','delivery_fee','delivery_days','bank_details','payment_methods'];
    const updates = { updated_at:new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (req.body.paystack_secret_key && req.body.paystack_secret_key !== '[ENCRYPTED]') updates.paystack_secret_key = encrypt(req.body.paystack_secret_key);
    if (req.body.paystack_public_key)  updates.paystack_public_key = req.body.paystack_public_key;
    if (req.body.wa_access_token && req.body.wa_access_token !== '[ENCRYPTED]') updates.wa_access_token = encrypt(req.body.wa_access_token);

    const { data:current } = await supabase.from('business_settings')
      .select('id,wa_phone_number_id,connection_method,wa_access_token,wa_route_code').eq('user_id', req.user.id).single();

    // S-06/W-07: switching between the shared platform number and a dedicated number is an
    // explicit, guarded transition — the raw column is never mass-assignable.
    if (req.body.wa_phone_number_id !== undefined) {
      const numId = String(req.body.wa_phone_number_id || '').trim();
      if (!numId) {
        // Disconnect → back to the shared number. Tenant rows NEVER keep platform creds.
        updates.wa_phone_number_id     = null;
        updates.connection_method      = 'shared';
        updates.wa_access_token        = null;
        updates.wa_business_account_id = null;
        if (!current?.wa_route_code) {
          const rc = current ? await assignRouteCode(supabase, req.user.id) : await pickFreeRouteCode(supabase);
          if (!rc) return res.status(500).json({ success:false, error:'Could not allocate a routing code. Please retry.' });
          updates.wa_route_code = rc;
        }
      } else {
        if (!/^\d{5,30}$/.test(numId)) return res.status(400).json({ success:false, error:'Invalid WhatsApp Phone Number ID.' });
        if (WA_PHONE_NUMBER_ID && numId === String(WA_PHONE_NUMBER_ID))
          return res.status(400).json({ success:false, error:"That number belongs to ZAPIT's shared service — use the shared connection instead." });
        const hasToken = (req.body.wa_access_token && req.body.wa_access_token !== '[ENCRYPTED]') || current?.wa_access_token;
        if (!hasToken) return res.status(400).json({ success:false, error:'An Access Token is required to connect a dedicated number.' });
        updates.wa_phone_number_id = numId;
        updates.connection_method  = 'individual';
        if (req.body.wa_business_account_id !== undefined) updates.wa_business_account_id = String(req.body.wa_business_account_id||'').trim() || null;
      }
    }

    let write;
    if (current) {
      write = await supabase.from('business_settings').update(updates).eq('user_id', req.user.id);
      if (write.error?.code === '23505' && /wa_route_code/.test(write.error.message || '')) {
        const rc = await assignRouteCode(supabase, req.user.id);
        if (rc) { updates.wa_route_code = rc; write = await supabase.from('business_settings').update(updates).eq('user_id', req.user.id); }
      }
    } else {
      write = await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id });
      for (let i = 0; i < 3 && write.error?.code === '23505' && /wa_route_code/.test(write.error.message || ''); i++) {
        const rc = await pickFreeRouteCode(supabase);
        if (!rc) break;
        updates.wa_route_code = rc;
        write = await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id });
      }
    }
    if (write.error) {
      if (write.error.code === '23505') return res.status(409).json({ success:false, error:'That WhatsApp number is already linked to another ZAPIT business.' });
      return res.status(500).json({ success:false, error:'Failed to update settings.' });
    }
    return res.json({
      success:true, message:'Settings updated!',
      data:{
        connection_method:  updates.connection_method  ?? current?.connection_method  ?? 'shared',
        wa_phone_number_id: updates.wa_phone_number_id !== undefined ? updates.wa_phone_number_id : (current?.wa_phone_number_id ?? null),
        route_code:         updates.wa_route_code      ?? current?.wa_route_code      ?? null,
      },
    });
  } catch { return res.status(500).json({ success:false, error:'Failed to update settings.' }); }
});

// POST /whatsapp/test-connection — Phase 6.1 W-07: strict tenant creds (no platform fallback)
app.post('/whatsapp/test-connection', authenticate, async (req, res) => {
  try {
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id', req.user.id).single();
    const { data:user }     = await supabase.from('users').select('whatsapp_number,phone').eq('id', req.user.id).single();
    const to = req.body.phone || user?.whatsapp_number || user?.phone;
    if (!to) return res.status(400).json({ success:false, error:'Please provide a phone number to test.' });
    // S-06: shared-mode tenants use ZAPIT's platform number — there is nothing for them to test,
    // and we must never imply they need (or may paste) platform credentials.
    if ((settings?.connection_method || 'shared') === 'shared') {
      return res.json({
        success:true,
        data:{ channel:'platform-shared', shared_number:SHARED_WA_NUMBER, route_code:settings?.wa_route_code||null },
        message:`You are connected to ZAPIT's shared WhatsApp number${SHARED_WA_NUMBER?` (${SHARED_WA_NUMBER})`:''} — no credentials needed. Ask new customers to start with #${settings?.wa_route_code||'YOURCODE'}.`,
      });
    }
    if (!settings?.wa_phone_number_id || !settings?.wa_access_token) {
      return res.status(400).json({ success:false, error:'Missing tenant WhatsApp credentials — configure your dedicated number in Settings → WhatsApp (individual mode).' });
    }
    const decrypted = decrypt(settings.wa_access_token);
    if (!decrypted) return res.status(400).json({ success:false, error:'Failed to decrypt WhatsApp token — re-save your credentials.' });
    const result = await sendWAMessage({ phoneNumberId: settings.wa_phone_number_id, accessToken: decrypted, to, message:`✅ WhatsApp connection test successful!\n\nYour ZAPIT bot for *${settings?.business_name||'your business'}* is live! 🚀` });
    return result.success
      ? res.json({ success:true, message:'Test message sent! Check your WhatsApp.' })
      : res.status(400).json({ success:false, error:'Failed to send test message. Check your credentials.' });
  } catch (err) {
    if (String(err.message).includes('Missing tenant')) return res.status(400).json({ success:false, error: err.message });
    return res.status(500).json({ success:false, error:'Connection test failed.' });
  }
});

// GET /whatsapp/qr-code — shared number + this tenant's routing code (S-06)
app.get('/whatsapp/qr-code', authenticate, async (req, res) => {
  try {
    let { data:settings } = await supabase.from('business_settings').select('id,wa_route_code,connection_method').eq('user_id', req.user.id).limit(1);
    settings = Array.isArray(settings) ? settings[0] : settings;
    let routeCode = settings?.wa_route_code || null;
    if (settings && !routeCode) routeCode = await assignRouteCode(supabase, req.user.id);
    const instructions = routeCode ? [
      `1. Give customers your code: #${routeCode}`,
      `2. They text "${'#' + routeCode} hello" to ${SHARED_WA_NUMBER || 'our shared number'}`,
      '3. They are remembered after the first message — no code needed again',
      '4. Upgrade for your own dedicated WhatsApp number',
    ] : [
      '1. Share the shared number with your customers',
      '2. The AI bot responds instantly on your behalf',
      '3. Upgrade for your own dedicated WhatsApp number',
    ];
    return res.json({ success:true, data:{
      shared_number: SHARED_WA_NUMBER,
      route_code: routeCode,
      connection_method: settings?.connection_method || 'shared',
      message: routeCode
        ? 'Use this shared number with your customers. Give them your routing code so messages reach your business.'
        : 'Use this shared number with your customers. No Meta account needed on Free plan.',
      instructions,
    } });
  } catch { return res.status(500).json({ success:false, error:'Failed to load shared number info.' }); }
});

// GET /whatsapp/products
app.get('/whatsapp/products', authenticate, async (req, res) => {
  try {
    const { page=1, limit=20, search, category } = req.query;
    const offset = (Number(page)-1) * Number(limit);
    let q = supabase.from('products').select('*',{ count:'exact' }).eq('user_id', req.user.id).range(offset, offset+Number(limit)-1).order('created_at',{ ascending:false });
    if (search)   q = q.ilike('name', `%${search}%`);
    if (category) q = q.eq('category', category);
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page:Number(page), limit:Number(limit), pages:Math.ceil((count||0)/Number(limit)) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch products.' }); }
});

// POST /whatsapp/products
app.post('/whatsapp/products', authenticate, async (req, res) => {
  try {
    let { name, description, price, sale_price, currency='NGN', type='physical', stock_quantity, category, image_url } = req.body;
    name = sanitizeStr(name, 120);
    if (description) description = sanitizeStr(description, 1000);
    if (category) category = sanitizeStr(category, 60);
    if (!name || price === undefined) return res.status(400).json({ success:false, error:'Product name and price are required.' });
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 10000000) return res.status(400).json({ success:false, error:'Invalid price.' });
    if (sale_price != null && (!Number.isFinite(Number(sale_price)) || Number(sale_price) < 0)) return res.status(400).json({ success:false, error:'Invalid sale_price.' });
    if (stock_quantity != null && (!Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0)) return res.status(400).json({ success:false, error:'Invalid stock_quantity.' });
    const cleanCurrency = sanitizeStr(currency||'NGN',10);
    const cleanType = ['physical','digital','service'].includes(type) ? type : 'physical';
    const { limits } = await getUserSubscription(req.user.id);
    const { count }  = await supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id', req.user.id);
    if ((count||0) >= limits.products_limit) return res.status(403).json({ success:false, error:`Product limit (${limits.products_limit}) reached. Upgrade to add more.` });
    const { data, error } = await supabase.from('products').insert({ user_id:req.user.id, name, description, price: priceNum, sale_price: sale_price?Number(sale_price):null, currency: cleanCurrency, type: cleanType, stock_quantity: stock_quantity?Number(stock_quantity):null, category, image_url: image_url ? sanitizeStr(image_url, 500) : null }).select().single();
    if (error) throw error;
    // Atomic TOCTOU guard: re-check count after insert, rollback if limit exceeded (defense in depth until DB constraint is live)
    try {
      const { count: afterCount } = await supabase.from('products').select('id',{count:'exact',head:true}).eq('user_id', req.user.id);
      const { limits: afterLimits } = await getUserSubscription(req.user.id);
      if ((afterCount||0) > afterLimits.products_limit) {
        await supabase.from('products').delete().eq('id', data.id);
        invalidateSubscriptionCache(req.user.id);
        return res.status(403).json({ success:false, error: `Product limit (${afterLimits.products_limit}) exceeded — upgrade required. This insert was rolled back.` });
      }
    } catch {}
    return res.status(201).json({ success:true, data, message:'Product added!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to add product.' }); }
});

// PATCH /whatsapp/products/:id
app.patch('/whatsapp/products/:id', authenticate, async (req, res) => {
  try {
    const { data:existing } = await supabase.from('products').select('id').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!existing) return res.status(404).json({ success:false, error:'Product not found.' });
    // S-16: explicit allow-list — user_id, id and unknown columns can never be written.
    const { values, errors } = pickFields(req.body, {
      name:           { type:'string', max:120, min:1 },
      description:    { type:'string', max:1000, nullable:true },
      price:          { type:'number', min:0, max:10000000 },
      sale_price:     { type:'number', min:0, max:10000000, nullable:true },
      currency:       { type:'string', max:10, min:3 },
      type:           { type:'string', max:20, enum:['physical','digital','service'] },
      stock_quantity: { type:'number', integer:true, min:0, nullable:true },
      category:       { type:'string', max:60, nullable:true },
      image_url:      { type:'string', max:500, nullable:true },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    const updates = { ...values, updated_at:new Date().toISOString() };
    const { data, error } = await supabase.from('products').update(updates).eq('id',req.params.id).select().single();
    if (error) throw error;
    return res.json({ success:true, data, message:'Product updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update product.' }); }
});

// DELETE /whatsapp/products/:id
app.delete('/whatsapp/products/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('products').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Product deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete product.' }); }
});

// POST /whatsapp/products/import
app.post('/whatsapp/products/import', authenticate, upload.single('file'), async (req, res) => {
  // Validate file extension even if mimetype spoofed
  if (req.file) {
    const ext = path.extname(req.file.originalname||'').toLowerCase();
    if (!['.csv','.xlsx','.xls'].includes(ext)) return res.status(400).json({ success:false, error:'Only CSV or Excel files allowed.' });
  }
  try {
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.excel_import_enabled) return res.status(403).json({ success:false, error:'Excel import requires Growth plan or above.' });
    if (!req.file) return res.status(400).json({ success:false, error:'Please upload a CSV file.' });
    const lines   = req.file.buffer.toString('utf8').split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/['"]/g,'').toLowerCase());
    const products = [];
    for (let i=1; i<lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/['"]/g,''));
      const obj  = {};
      headers.forEach((h,idx) => { obj[h] = vals[idx]||''; });
      if (obj.name && obj.price) products.push({ user_id:req.user.id, name:obj.name, description:obj.description||'', price:parseFloat(obj.price)||0, currency:obj.currency||'NGN', category:obj.category||'General', stock_quantity:obj.stock_quantity?parseInt(obj.stock_quantity):null, type:obj.type||'physical' });
    }
    if (!products.length) return res.status(400).json({ success:false, error:'No valid products found. Ensure columns: name, price.' });
    const { count } = await supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id);
    if ((count||0)+products.length > limits.products_limit) return res.status(403).json({ success:false, error:`Import would exceed your limit of ${limits.products_limit}.` });
    const { data, error } = await supabase.from('products').insert(products).select();
    if (error) throw error;
    return res.json({ success:true, data, message:`Successfully imported ${data.length} products!` });
  } catch { return res.status(500).json({ success:false, error:'Import failed. Check file format.' }); }
});

// GET /whatsapp/products/export
app.get('/whatsapp/products/export', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('products').select('name,description,price,sale_price,currency,category,type,stock_quantity,sku,is_active').eq('user_id',req.user.id);
    const header = 'name,description,price,sale_price,currency,category,type,stock_quantity,sku,is_active\n';
    const rows   = (data||[]).map(p => [p.name,p.description||'',p.price,p.sale_price||'',p.currency,p.category||'',p.type,p.stock_quantity||'',p.sku||'',p.is_active].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="zapit-products.csv"');
    return res.send(header+rows);
  } catch { return res.status(500).json({ success:false, error:'Export failed.' }); }
});

// GET /whatsapp/orders
app.get('/whatsapp/orders', authenticate, async (req, res) => {
  try {
    let { page=1, limit=20, status, payment_status, search } = req.query;
    const pg = parsePagination({ page, limit }, { page:1, limit:20, maxLimit:100 });
    page = pg.page; limit = pg.limit; const offset = pg.offset;
    let q = supabase.from('orders').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+limit-1).order('created_at',{ ascending:false });
    if (status)         q = q.eq('status', sanitizeStr(String(status),20));
    if (payment_status) q = q.eq('payment_status', sanitizeStr(String(payment_status),20));
    if (req.query.source) q = q.eq('source', sanitizeStr(String(req.query.source),20));
    if (search)         { const safe = sanitizeStr(String(search), 60).replace(/[%_]/g, ''); if (safe) q = q.or(`customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%,order_number.ilike.%${safe}%`); }
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page:Number(page), limit:Number(limit), pages:Math.ceil((count||0)/Number(limit)) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch orders.' }); }
});

// GET /whatsapp/orders/:id
app.get('/whatsapp/orders/:id', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (error||!data) return res.status(404).json({ success:false, error:'Order not found.' });
    return res.json({ success:true, data });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch order.' }); }
});

// PATCH /whatsapp/orders/:id
app.patch('/whatsapp/orders/:id', authenticate, async (req, res) => {
  try {
    const { data:existing } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!existing) return res.status(404).json({ success:false, error:'Order not found.' });
    // S-16: operational fields only — payment_status, paid_at, total, order_number
    // and customer_phone are NOT writable through this route.
    const { values, errors } = pickFields(req.body, {
      status:          { type:'string', max:20, enum:['pending','confirmed','processing','shipped','delivered','cancelled','refunded'] },
      delivery_status: { type:'string', max:24, enum:['pending','packed','shipped','out_for_delivery','delivered','returned'] },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    const updates = { ...values, updated_at:new Date().toISOString() };
    const { data, error } = await supabase.from('orders').update(updates).eq('id',req.params.id).select().single();
    if (error) throw error;
    const statusChanged   = values.status !== undefined && values.status !== existing.status;
    const deliveryChanged = values.delivery_status !== undefined && values.delivery_status !== existing.delivery_status;
    if ((statusChanged || deliveryChanged) && existing.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      let msg = '';
      if (values.status==='confirmed')                msg = `✅ Order ${existing.order_number} confirmed! We're processing it now.`;
      if (values.delivery_status==='shipped')         msg = `🚚 Order ${existing.order_number} is on its way!`;
      if (values.delivery_status==='delivered')       msg = `🎉 Order ${existing.order_number} delivered! Thank you for shopping with us.`;
      if (msg && s) {
        try {
          const creds = resolveSendCreds({ connectionMethod:s.connection_method, waPhoneNumberId:s.wa_phone_number_id, waAccessToken:s.wa_access_token?decrypt(s.wa_access_token):null }, { phoneNumberId:WA_PHONE_NUMBER_ID, accessToken:WA_ACCESS_TOKEN });
          await sendWAMessage({ phoneNumberId:creds.phoneNumberId, accessToken:creds.accessToken, to:existing.customer_whatsapp, message:msg });
        } catch (e) { console.warn('[order notify skip]', e.message); } // status change already saved
      }
    }
    return res.json({ success:true, data, message:'Order updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update order.' }); }
});

// POST /whatsapp/orders/:id/confirm-payment
app.post('/whatsapp/orders/:id/confirm-payment', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    const nowIso = new Date().toISOString();
    // Phase 8.2: a manual confirmation is a verification too — record when and
    // by which rail (the dashboard's Confirm-payment button).
    await supabase.from('orders').update({
      payment_status:'paid', paid_at:nowIso, payment_verified_at:nowIso,
      payment_provider: order.payment_provider || 'manual',
      updated_at:nowIso,
    }).eq('id',req.params.id).eq('user_id',req.user.id);
    if (order.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      const msg = s?.payment_received_message
        ? String(s.payment_received_message).replace('{order}', order.order_number)
        : orderConfirmedMessage(order.order_number);
      if (s) {
        try {
          const creds = resolveSendCreds({ connectionMethod:s.connection_method, waPhoneNumberId:s.wa_phone_number_id, waAccessToken:s.wa_access_token?decrypt(s.wa_access_token):null }, { phoneNumberId:WA_PHONE_NUMBER_ID, accessToken:WA_ACCESS_TOKEN });
          await sendWAMessage({ phoneNumberId:creds.phoneNumberId, accessToken:creds.accessToken, to:order.customer_whatsapp, message:msg });
        } catch (e) { console.warn('[payment notify skip]', e.message); } // payment already recorded
      }
    }
    return res.json({ success:true, message:'Payment confirmed and customer notified!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to confirm payment.' }); }
});

// POST /whatsapp/orders/:id/payment-link   (Phase 8.2 — W-01)
// Re-sends (and, when needed, re-creates) the payment request — the recovery
// path for a customer who closed WhatsApp right after ordering.
app.post('/whatsapp/orders/:id/payment-link', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    if (order.payment_status === 'paid') return res.status(409).json({ success:false, error:'Order is already paid.' });
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
    if (!settings) return res.status(400).json({ success:false, error:'Set up your business settings first.' });
    const payment = await requestOrderPayment({ order, settings, contact:null });
    const sent = await notifyOrderCustomer({
      userId:req.user.id, settings, contactId:order.contact_id || null,
      phone:order.customer_whatsapp || order.customer_phone, text:payment.message,
    });
    return res.json({ success:true, data:{ provider:payment.provider, link:payment.link, sent },
      message: sent ? 'Payment request sent to the customer.' : 'Payment request prepared, but WhatsApp delivery failed.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to create the payment request.' }); }
});

// POST /whatsapp/orders/:id/verify-payment   (Phase 8.2 — W-01)
// Merchant-triggered verification against THEIR Paystack account. The webhook
// does this automatically; this is for a missed callback.
app.post('/whatsapp/orders/:id/verify-payment', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    if (order.payment_status === 'paid') return res.json({ success:true, data:{ already_paid:true, order } });
    if (!order.payment_reference) return res.status(400).json({ success:false, error:'This order has no payment reference.' });
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
    const secret = safeDecryptValue(settings?.paystack_secret_key);
    if (!secret) return res.status(400).json({ success:false, error:'Add your Paystack secret key to verify payments automatically.' });
    let verify = null;
    try {
      const r = await paystackFetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(order.payment_reference)}`, { headers:{ Authorization:`Bearer ${secret}` } });
      try { verify = await r.json(); } catch { verify = null; }
    } catch { return res.status(502).json({ success:false, error:'Could not reach Paystack. Try again shortly.' }); }
    const decision = evaluateOrderPayment({ order, verifyData:verify?.data, eventData:null });
    if (!decision.ok) return res.status(409).json({ success:false, error:`Payment not confirmed (${decision.reason}).`, reason:decision.reason });
    await markOrderPaid({ order, settings, verifyData:verify.data });
    const { data:fresh } = await supabase.from('orders').select('*').eq('id',order.id).single();
    return res.json({ success:true, data:fresh, message:'Payment verified and order confirmed.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to verify the payment.' }); }
});

// POST /whatsapp/orders/:id/cancel
app.post('/whatsapp/orders/:id/cancel', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    await supabase.from('orders').update({ status:'cancelled', updated_at:new Date().toISOString() }).eq('id',req.params.id);
    if (order.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      if (s) {
        try {
          const creds = resolveSendCreds({ connectionMethod:s.connection_method, waPhoneNumberId:s.wa_phone_number_id, waAccessToken:s.wa_access_token?decrypt(s.wa_access_token):null }, { phoneNumberId:WA_PHONE_NUMBER_ID, accessToken:WA_ACCESS_TOKEN });
          await sendWAMessage({ phoneNumberId:creds.phoneNumberId, accessToken:creds.accessToken, to:order.customer_whatsapp, message:`We're sorry — order ${order.order_number} has been cancelled. ${req.body.reason||'Please contact us if you have questions.'}` });
        } catch (e) { console.warn('[cancel notify skip]', e.message); } // cancellation already saved
      }
    }
    return res.json({ success:true, message:'Order cancelled.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to cancel order.' }); }
});

// DELETE /whatsapp/orders/:id  (soft delete)
app.delete('/whatsapp/orders/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('orders').update({ status:'deleted', updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Order deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete order.' }); }
});

// GET /whatsapp/contacts
app.get('/whatsapp/contacts', authenticate, async (req, res) => {
  try {
    let { page=1, limit=20, search, segment } = req.query;
    const pg = parsePagination({ page, limit }, { page:1, limit:20, maxLimit:100 });
    page = pg.page; limit = pg.limit; const offset = pg.offset;
    let q = supabase.from('contacts').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+limit-1).order('last_message_date',{ ascending:false });
    if (search)  { const safe = sanitizeStr(String(search), 60).replace(/[%_]/g, ''); if (safe) q = q.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`); }
    if (segment) q = q.eq('segment', sanitizeStr(String(segment),20));
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page, limit } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch contacts.' }); }
});

// GET /whatsapp/contacts/:id
app.get('/whatsapp/contacts/:id', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('contacts').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!data) return res.status(404).json({ success:false, error:'Contact not found.' });
    const { data:orders } = await supabase.from('orders').select('id,order_number,total,status,created_at').eq('user_id',req.user.id).eq('customer_phone',data.phone).order('created_at',{ ascending:false }).limit(10);
    return res.json({ success:true, data:{ ...data, orders:orders||[] } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch contact.' }); }
});

// PATCH /whatsapp/contacts/:id
app.patch('/whatsapp/contacts/:id', authenticate, async (req, res) => {
  try {
    // S-16: allow-list — counters (message_count, total_orders) are never client-writable.
    const { values, errors } = pickFields(req.body, {
      name:       { type:'string', max:120, nullable:true },
      segment:    { type:'string', max:20, enum:['lead','customer','vip','inactive'] },
      is_blocked: { type:'boolean' },
      opted_out:  { type:'boolean' },
      notes:      { type:'string', max:1000, nullable:true },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    await supabase.from('contacts').update({ ...values, updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Contact updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update contact.' }); }
});

// DELETE /whatsapp/contacts/:id
app.delete('/whatsapp/contacts/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('contacts').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Contact deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete contact.' }); }
});

// GET /whatsapp/knowledge-base
app.get('/whatsapp/knowledge-base', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('knowledge_base').select('*').eq('user_id',req.user.id).order('hit_count',{ ascending:false });
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch knowledge base.' }); }
});

// POST /whatsapp/knowledge-base
app.post('/whatsapp/knowledge-base', authenticate, async (req, res) => {
  try {
    const { trigger, response, category, language='en' } = req.body;
    if (!trigger||!response) return res.status(400).json({ success:false, error:'Trigger and response are required.' });
    const { limits } = await getUserSubscription(req.user.id);
    const { count }  = await supabase.from('knowledge_base').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id);
    if ((count||0) >= limits.knowledge_base_limit) return res.status(403).json({ success:false, error:`KB limit (${limits.knowledge_base_limit}) reached. Upgrade to add more.` });
    const { data, error } = await supabase.from('knowledge_base').insert({ user_id:req.user.id, trigger:trigger.toLowerCase().trim(), response, category, language }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Keyword response added!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to add KB entry.' }); }
});

// PATCH /whatsapp/knowledge-base/:id
app.patch('/whatsapp/knowledge-base/:id', authenticate, async (req, res) => {
  try {
    // S-16: system columns (auto_learned, needs_approval) are not client-writable.
    const { values, errors } = pickFields(req.body, {
      trigger:   { type:'string', max:200, min:1, lowercase:true },
      response:  { type:'string', max:2000, min:1 },
      category:  { type:'string', max:60, nullable:true },
      language:  { type:'string', max:10 },
      is_active: { type:'boolean' },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    const updates = { ...values, updated_at:new Date().toISOString() };
    const { data, error } = await supabase.from('knowledge_base').update(updates).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
    if (error) throw error;
    return res.json({ success:true, data, message:'Entry updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update entry.' }); }
});

// DELETE /whatsapp/knowledge-base/:id
app.delete('/whatsapp/knowledge-base/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('knowledge_base').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Entry deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete entry.' }); }
});

// PATCH /whatsapp/knowledge-base/:id/toggle
app.patch('/whatsapp/knowledge-base/:id/toggle', authenticate, async (req, res) => {
  try {
    const { data:entry } = await supabase.from('knowledge_base').select('is_active').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!entry) return res.status(404).json({ success:false, error:'Entry not found.' });
    await supabase.from('knowledge_base').update({ is_active:!entry.is_active, updated_at:new Date().toISOString() }).eq('id',req.params.id);
    return res.json({ success:true, message:`Entry ${entry.is_active?'disabled':'enabled'}.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to toggle entry.' }); }
});

// GET /whatsapp/ai-logs
app.get('/whatsapp/ai-logs', authenticate, async (req, res) => {
  try {
    const { page=1, limit=20 } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    const { data, count } = await supabase.from('ai_logs').select('*',{ count:'exact' }).eq('user_id',req.user.id).eq('promoted_to_kb',false).range(offset,offset+Number(limit)-1).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[], meta:{ total:count, page:Number(page), limit:Number(limit) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch AI logs.' }); }
});

// POST /whatsapp/ai-logs/:id/promote
app.post('/whatsapp/ai-logs/:id/promote', authenticate, async (req, res) => {
  try {
    const { data:log } = await supabase.from('ai_logs').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!log) return res.status(404).json({ success:false, error:'Log not found.' });
    await supabase.from('knowledge_base').insert({ user_id:req.user.id, trigger:req.body.trigger||log.customer_message.toLowerCase().substring(0,100), response:req.body.response||log.ai_response, category:'AI Promoted', language:'en' });
    await supabase.from('ai_logs').update({ promoted_to_kb:true, promoted_at:new Date().toISOString() }).eq('id',req.params.id);
    return res.json({ success:true, message:'Promoted to knowledge base!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to promote.' }); }
});

// DELETE /whatsapp/ai-logs/:id
app.delete('/whatsapp/ai-logs/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('ai_logs').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Log deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete log.' }); }
});

// ─── PHASE 8.3 (W-03): TEMPLATES + BROADCAST RUNS ───────────────
// Free-form WhatsApp messages are only allowed inside the 24h window that
// follows a customer's last inbound message; outside it a business must send an
// approved template. Broadcasts also stored a `scheduled_for` that nothing ever
// executed. These helpers add the template send path and the run executor.

/** Cloud API template message (same auth/endpoint as the text sender). */
async function sendWATemplate({ phoneNumberId, accessToken, to, template, params = [] }) {
  if (!phoneNumberId || !accessToken) throw new Error('sendWATemplate: missing credentials');
  if (!template?.name) throw new Error('sendWATemplate: template name is required');
  const res = await fetch(`${WA_GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(templatePayload(template, to, params)),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { success: res.ok, data };
}

/** The audience a broadcast targets: opt-out/blocked always excluded. */
async function loadBroadcastAudience({ userId, target_segment = 'all', limit = 1000 }) {
  let q = supabase.from('contacts')
    .select('id,name,phone,last_message_date,opted_out,is_blocked')
    .eq('user_id', userId).eq('opted_out', false).eq('is_blocked', false)
    .order('last_message_date', { ascending: false }).limit(limit);
  if (target_segment && target_segment !== 'all') q = q.eq('segment', target_segment);
  const { data } = await q;
  return data || [];
}

async function loadTenantTemplate(userId, templateId) {
  if (!templateId) return null;
  try {
    const { data } = await supabase.from('wa_templates').select('*')
      .eq('id', templateId).eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

async function loadBroadcastSettings(userId) {
  try {
    const { data } = await supabase.from('business_settings').select('*').eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

/**
 * Send one broadcast run: free text inside the window, template outside, and an
 * honest record of who was skipped and why.
 */
async function runBroadcast({ broadcast, settings, contacts, message, template }) {
  const plan = planBroadcast({ contacts, message, template, now: new Date() });
  let creds = null;
  try {
    creds = resolveSendCreds({
      connectionMethod: settings?.connection_method,
      waPhoneNumberId: settings?.wa_phone_number_id,
      waAccessToken: settings?.wa_access_token ? decrypt(settings.wa_access_token) : null,
    }, { phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN });
  } catch (e) { creds = null; }

  let sent = 0, failed = 0;
  for (const item of plan.send) {
    let r;
    try {
      if (!creds) throw new Error('Missing tenant WhatsApp credentials');
      if (item.mode === 'template') {
        const params = (template.variables || []).map(() => item.contact.name || 'there');
        r = await sendWATemplate({
          phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken,
          to: item.contact.phone, template, params: params.length ? params : [item.contact.name || 'there'],
        });
      } else {
        r = await sendWAMessage({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, to: item.contact.phone, message: item.text });
      }
    } catch (e) { r = { success: false, error: e.message }; }
    if (r?.success) sent++;
    else {
      failed++;
      console.warn(JSON.stringify({ level:'warn', msg:'broadcast send failed', mode:item.mode, to:item.contact.phone, err:r?.error || r?.data?.error?.message || 'gateway refused' }));
    }
    await sleep(120);                                    // ~8 msg/sec rate limit
  }

  const results = {
    sent, failed,
    skipped_window: plan.counts.skipped_window,
    by_mode: { text: plan.counts.text, template: plan.counts.template },
    skipped_reasons: plan.counts.skipped_window ? ['outside_24h_window'] : [],
    summary: broadcastOutcomeMessage({ counts: plan.counts, sent, failed }),
  };
  await supabase.from('broadcasts').update({
    status: 'sent', sent_count: sent, failed_count: failed,
    skipped_count: plan.counts.skipped_window, results,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', broadcast.id);
  return { plan, results };
}
// GET /whatsapp/templates   (Phase 8.3 — W-03)
app.get('/whatsapp/templates', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('wa_templates').select('*').eq('user_id', req.user.id).order('created_at', { ascending:false });
    return res.json({ success:true, data:data || [] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch templates.' }); }
});

// POST /whatsapp/templates
// Our record of a Meta-approved template: name + language + body. The body's
// `{{1}}`… placeholders are filled with the recipient's name on send.
app.post('/whatsapp/templates', authenticate, async (req, res) => {
  try {
    const { ok, errors, value } = validateTemplate(req.body || {});
    if (!ok) return res.status(400).json({ success:false, error:errors[0], errors });
    const { data, error } = await supabase.from('wa_templates').upsert({
      user_id:req.user.id, name:value.name, language:value.language, category:value.category,
      body:value.body, variables:value.variables, status:value.status,
      updated_at:new Date().toISOString(),
    }, { onConflict:'user_id,name,language' }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Template saved.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to save the template.' }); }
});

// DELETE /whatsapp/templates/:id
app.delete('/whatsapp/templates/:id', authenticate, async (req, res) => {
  try {
    const { error } = await supabase.from('wa_templates').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    return res.json({ success:true, message:'Template deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete the template.' }); }
});

// GET /whatsapp/broadcasts
app.get('/whatsapp/broadcasts', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('broadcasts').select('*').eq('user_id',req.user.id).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch broadcasts.' }); }
});

// POST /whatsapp/broadcasts
// Phase 8.3 (W-03): recipients inside the 24h window get the free-text message;
// recipients outside it need an approved template, otherwise they are skipped
// and reported (they used to be free-texted and silently rejected by Meta).
app.post('/whatsapp/broadcasts', authenticate, async (req, res) => {
  try {
    let { name, message, target_segment='all', scheduled_for, template_id } = req.body;
    name = sanitizeStr(name, 120);
    message = sanitizeStr(message, 2000);
    target_segment = sanitizeStr(target_segment, 30);
    if (!name||!message) return res.status(400).json({ success:false, error:'Name and message are required.' });
    if (message.length > 2000) return res.status(400).json({ success:false, error:'Message too long (max 2000).' });
    const allowedSegments = new Set(['all','lead','customer','vip']);
    if (!allowedSegments.has(target_segment)) return res.status(400).json({ success:false, error:'Invalid target_segment.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (limits.whatsapp_broadcasts === 0) return res.status(403).json({ success:false, error:'Broadcasts require Creator plan or above.' });
    // B-06: broadcasts are metered monthly too (they were gated by plan only).
    const broadcastQuota = await consumeQuota(supabase, { userId:req.user.id, metric:METRICS.BROADCAST, amount:1, limit:limits.whatsapp_broadcasts });
    if (!broadcastQuota.allowed) return res.status(403).json(quotaExceededBody(METRICS.BROADCAST, broadcastQuota));
    try {
      const since = new Date(new Date().setHours(0,0,0,0)).toISOString();
      const { count: todayCount } = await supabase.from('broadcasts').select('id',{count:'exact',head:true}).eq('user_id', req.user.id).gte('created_at', since);
      if ((todayCount||0) >= 5) return res.status(429).json({ success:false, error:'Daily broadcast limit (5/day) reached. Try tomorrow.' });
    } catch {}
    const settings = await loadBroadcastSettings(req.user.id);
    const template = await loadTenantTemplate(req.user.id, template_id);
    if (template_id && !template) return res.status(400).json({ success:false, error:'Template not found.' });
    const contacts = await loadBroadcastAudience({ userId:req.user.id, target_segment });
    if (!contacts.length) return res.status(400).json({ success:false, error:'No contacts to send to.' });

    const { data:broadcast, error:bErr } = await supabase.from('broadcasts').insert({
      user_id:req.user.id, name, message, target_segment,
      scheduled_for:scheduled_for||new Date().toISOString(),
      status:scheduled_for?'scheduled':'sending',
      template_id: template?.id || null, total_recipients:contacts.length,
    }).select().single();
    if (bErr) throw bErr;

    // A scheduled run is planned at send time — the window moves.
    if (scheduled_for) return res.status(201).json({ success:true, data:broadcast, message:'Broadcast scheduled!' });

    const plan = planBroadcast({ contacts, message, template, now:new Date() });
    if (!plan.send.length) {
      await supabase.from('broadcasts').update({
        status:'failed', skipped_count:plan.counts.skipped_window,
        results:{ summary:broadcastOutcomeMessage({ counts:plan.counts, sent:0, failed:0 }), skipped_reasons:['outside_24h_window'] },
        completed_at:new Date().toISOString(), updated_at:new Date().toISOString(),
      }).eq('id',broadcast.id);
      return res.status(400).json({
        success:false,
        error:`All ${plan.counts.total} recipients are outside the 24h window. Attach an approved template (POST /whatsapp/templates) to reach them.`,
        data:{ counts:plan.counts },
      });
    }
    const { results } = await runBroadcast({ broadcast, settings, contacts, message, template });
    const { data:fresh } = await supabase.from('broadcasts').select('*').eq('id',broadcast.id).single();
    return res.status(201).json({
      success:true, data:fresh || broadcast,
      message: results.summary,
      counts: { total:results.by_mode.text + results.by_mode.template + results.skipped_window, ...results.by_mode, skipped_window:results.skipped_window },
    });
  } catch { return res.status(500).json({ success:false, error:'Failed to create broadcast.' }); }
});

// GET /whatsapp/broadcasts/:id
app.get('/whatsapp/broadcasts/:id', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('broadcasts').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!data) return res.status(404).json({ success:false, error:'Broadcast not found.' });
    return res.json({ success:true, data });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch broadcast.' }); }
});

// DELETE /whatsapp/broadcasts/:id
app.delete('/whatsapp/broadcasts/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('broadcasts').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Broadcast deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete broadcast.' }); }
});

// GET /whatsapp/conversations
app.get('/whatsapp/conversations', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('conversations').select('*, contacts(name,phone,profile_pic_url)').eq('user_id',req.user.id).eq('status','open').order('last_message_at',{ ascending:false }).limit(50);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch conversations.' }); }
});

// GET /whatsapp/conversations/:id
app.get('/whatsapp/conversations/:id', authenticate, async (req, res) => {
  try {
    const { data:conv } = await supabase.from('conversations').select('*,contacts(*)').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!conv) return res.status(404).json({ success:false, error:'Conversation not found.' });
    const { data:msgs } = await supabase.from('messages').select('*').eq('conversation_id',req.params.id).order('created_at',{ ascending:true }).limit(100);
    return res.json({ success:true, data:{ conversation:conv, messages:msgs||[] } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch conversation.' }); }
});

// POST /whatsapp/conversations/:id/reply
app.post('/whatsapp/conversations/:id/reply', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success:false, error:'Message is required.' });
    const { data:conv }     = await supabase.from('conversations').select('*,contacts(phone)').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!conv) return res.status(404).json({ success:false, error:'Conversation not found.' });
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
    let result;
    try {
      const creds = resolveSendCreds({
        connectionMethod: settings?.connection_method,
        waPhoneNumberId: settings?.wa_phone_number_id,
        waAccessToken: settings?.wa_access_token ? decrypt(settings.wa_access_token) : null,
      }, { phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN });
      result = await sendWAMessage({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, to:conv.contacts?.phone, message });
    } catch (e) {
      return res.status(400).json({ success:false, error: e.message });
    }
    let pausedUntil = null;
    if (result.success) {
      await supabase.from('messages').insert({ conversation_id:req.params.id, direction:'outbound', type:'text', content:message, status:'sent' });
      // W-04: a human is answering — the bot stops replying in this conversation.
      const takeover = takeoverFields(new Date());
      const { error:takeErr } = await supabase.from('conversations').update(takeover).eq('id',req.params.id);
      if (takeErr) {
        console.warn('[WA takeover unavailable]', takeErr.message);
        await supabase.from('conversations').update({ last_message_at:takeover.last_message_at }).eq('id',req.params.id);
      } else {
        pausedUntil = takeover.bot_paused_until;
      }
    }
    return res.json({ success:result.success, data:{ human_takeover:Boolean(pausedUntil), bot_paused_until:pausedUntil }, message:result.success?'Reply sent! The bot will stay quiet in this chat for 24h.':'Failed to send reply.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to send reply.' }); }
});

// POST /whatsapp/conversations/:id/resume  — hand the chat back to the bot (W-04)
app.post('/whatsapp/conversations/:id/resume', authenticate, async (req, res) => {
  try {
    const { data:conv } = await supabase.from('conversations').select('id').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!conv) return res.status(404).json({ success:false, error:'Conversation not found.' });
    const { error } = await supabase.from('conversations').update(resumeFields(new Date())).eq('id',req.params.id).eq('user_id',req.user.id);
    if (error) {
      console.warn('[WA resume unavailable]', error.message);
      return res.json({ success:true, data:{ human_takeover:false, degraded:true }, message:'Bot replies are already active (apply migration 20261011 to make takeover sticky).' });
    }
    return res.json({ success:true, data:{ human_takeover:false }, message:'The bot will answer this chat again.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to resume the conversation.' }); }
});

// ─── WHATSAPP WEBHOOKS ─────────────────────────────────────────

// GET /webhook/whatsapp  — Meta verification (constant-time, fail-closed)
app.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (verifyWebhookVerifyToken(mode, token, WA_VERIFY_TOKEN)) {
    console.log('[WA WEBHOOK] Verified!');
    return res.type('text/plain').status(200).send(String(challenge ?? ''));
  }
  console.warn(JSON.stringify({ level:'warn', msg:'wa webhook verify rejected', requestId:req.id, ip:req.ip }));
  return res.status(403).send('Forbidden');
});

// POST /webhook/whatsapp  — Incoming messages
app.post('/webhook/whatsapp', webhookLimiter, async (req, res) => {
  // ── 1. Authenticity (S-05): verify Meta's HMAC over the exact raw bytes ──
  const raw = Buffer.isBuffer(req.body) ? req.body
            : (typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : null);
  if (!raw || raw.length === 0) return res.status(400).json({ success:false, error:'Empty body.' });

  if (!WA_SIGNATURE_SECRET) {
    if (NODE_ENV === 'production') {
      console.error(JSON.stringify({ level:'error', msg:'wa webhook rejected: app secret not configured', requestId:req.id }));
      return res.status(503).json({ success:false, error:'Webhook not configured.' });
    }
    console.warn('[WA WEBHOOK] WA_APP_SECRET/META_APP_SECRET not set — signature check skipped (non-production only)');
  } else if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], WA_SIGNATURE_SECRET)) {
    console.warn(JSON.stringify({ level:'warn', msg:'wa webhook invalid signature', requestId:req.id, ip:req.ip }));
    return res.status(401).json({ success:false, error:'Invalid signature.' });
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).json({ success:false, error:'Invalid JSON.' }); }

  // ── 2. Acknowledge Meta immediately (only after authenticity is proven) ──
  res.status(200).json({ success:true });

  try {
    if (body?.object !== 'whatsapp_business_account') return;
    // W-04: one delivery can carry several entries/changes/messages — Meta
    // batches them under load. Every message is processed, each deduped by wamid.
    const inbound = extractInboundMessages(body);
    if (!inbound.length) return;
    // Sequential on purpose: draft state, counters and takeover flags must stay
    // consistent when a burst arrives together.
    for (const item of inbound) {
      try { await handleInboundMessage(item); }
      catch (err) { console.error(JSON.stringify({ level:'error', msg:'wa inbound message failed', msgId:item.msgId, error:err.message })); }
    }
  } catch (err) { console.error('[WA WEBHOOK ERROR]', err.message); }
});

/**
 * Handle exactly one inbound WhatsApp message (Phase 8.1 — W-02/W-04).
 * Routing → contact/conversation state → opt-out/opt-in → human takeover →
 * welcome (once) → AI reply. Never throws to the webhook: Meta has already been
 * acknowledged, so a single bad message must not abort the rest of the burst.
 */
async function handleInboundMessage({ message, contact:waContact, phoneNumberId, customerName, from, msgId }) {
  const now        = new Date();
  const nowIso     = now.toISOString();
  const msgType    = message.type;
  const msgTextRaw = messageTextOf(message);
  if (!msgTextRaw) return;

  // ── Replay/retry protection: one delivery per wamid (S-05) ──
  const claimed = await claimWebhookEvent(supabase, 'whatsapp', msgId, { from, type:msgType });
  if (!claimed) {
    console.log(JSON.stringify({ level:'info', msg:'wa duplicate delivery skipped', msgId }));
    return;
  }

  let msgText = msgTextRaw;

  // ── Deterministic tenant resolution (S-06) ──
  const routing = await resolveTenantForInbound({
    db: supabase, phoneNumberId, platformPhoneNumberId: WA_PHONE_NUMBER_ID,
    customerPhone: from, messageText: msgText,
  });
  if (routing.via === 'ambiguous_individual' || routing.via === 'ambiguous_code') {
    console.error(JSON.stringify({ level:'error', msg:'wa routing ambiguous — message refused', via:routing.via, phoneNumberId, from, code:routing.code }));
    return;
  }
  if (!routing.tenant) {
    console.warn(JSON.stringify({ level:'warn', msg:'wa routing: no tenant', via:routing.via, phoneNumberId, from, code:routing.code }));
    await maybeSendRoutingGuidance(routing, phoneNumberId, from);
    return;
  }

  const businessSettings = routing.tenant;
  const businessUserId   = businessSettings.user_id;
  msgText = routing.body || msgText;
  if (routing.via === 'code') {
    await upsertWaCustomerTenant(supabase, { platformPhoneNumberId: phoneNumberId, customerPhone: from, userId: businessUserId });
  }

  // ── Contact upsert — the count is computed, never re-read stale (W-02) ──
  let { data:contactRecord } = await supabase.from('contacts')
    .select('*').eq('user_id',businessUserId).eq('phone',from).single();
  let messageCount = 1;
  if (!contactRecord) {
    const { data:nc } = await supabase.from('contacts').insert({ user_id:businessUserId, name:customerName, phone:from, whatsapp_id:from, first_message_date:nowIso, last_message_date:nowIso, message_count:1, segment:'lead' }).select().single();
    contactRecord = nc;
  } else {
    messageCount = (contactRecord.message_count||0) + 1;
    const { data:updated } = await supabase.from('contacts')
      .update({ last_message_date:nowIso, message_count:messageCount, name:contactRecord.name||customerName })
      .eq('id',contactRecord.id).select().single();
    contactRecord = updated || { ...contactRecord, message_count:messageCount };
  }

  // ── Conversation upsert (carries the takeover state) ──
  let { data:conv } = await supabase.from('conversations')
    .select('*').eq('user_id',businessUserId).eq('contact_id',contactRecord?.id).eq('status','open').single();
  if (!conv) {
    const { data:nc } = await supabase.from('conversations').insert({ user_id:businessUserId, contact_id:contactRecord?.id, whatsapp_conversation_id:`${from}_${businessUserId}`, last_message_at:nowIso }).select().single();
    conv = nc;
  } else {
    await supabase.from('conversations').update({ last_message_at:nowIso }).eq('id',conv.id);
  }

  // ── Log inbound message ──
  await supabase.from('messages').insert({ conversation_id:conv?.id, whatsapp_message_id:msgId, direction:'inbound', type:msgType, content:msgText, status:'received' });

  // ── Explicit send channel (S-06/W-07): tenant number, or the platform shared number ──
  let creds = null;
  try {
    creds = resolveSendCreds({
      connectionMethod: businessSettings.connection_method,
      waPhoneNumberId: businessSettings.wa_phone_number_id,
      waAccessToken: businessSettings.wa_access_token ? decrypt(businessSettings.wa_access_token) : null,
    }, { phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN });
  } catch (e) { console.warn('[WA send channel unavailable]', e.message); }

  const send = async (text, { aiProcessed = false } = {}) => {
    if (!creds) return false;
    try {
      await sendWAMessage({ phoneNumberId:creds.phoneNumberId, accessToken:creds.accessToken, to:from, message:text });
      await supabase.from('messages').insert({ conversation_id:conv?.id, direction:'outbound', type:'text', content:text, status:'sent', ai_processed:aiProcessed });
      return true;
    } catch (e) { console.warn('[WA send skip]', e.message); return false; }
  };

  // ── Opt-out / opt-in keywords (W-04) ─────────────────────────
  // Honoured even when auto-reply is off: these are compliance messages, not bot
  // replies, so they never consume the reply quota.
  const keyword = classifyOptKeyword(msgText);
  if (keyword.type === 'opt_out') {
    const alreadyOut = contactRecord?.opted_out === true;
    await supabase.from('contacts').update(optOutFields(now, `keyword_${keyword.keyword}`)).eq('id',contactRecord.id);
    if (!alreadyOut) await send(STOP_CONFIRMATION);
    console.log(JSON.stringify({ level:'info', msg:'wa contact opted out', userId:businessUserId, alreadyOut }));
    if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
    return;
  }
  if (keyword.type === 'opt_in') {
    const wasOut = contactRecord?.opted_out === true;
    await supabase.from('contacts').update(optInFields(now)).eq('id',contactRecord.id);
    if (wasOut) await send(START_CONFIRMATION);
    console.log(JSON.stringify({ level:'info', msg:'wa contact opted in', userId:businessUserId, wasOut }));
    if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
    return;
  }
  if (contactRecord?.is_blocked || contactRecord?.opted_out) return;

  // Auto-reply off → the inbox still records the message, but nothing is sent.
  if (businessSettings.auto_reply === false) {
    console.log(JSON.stringify({ level:'info', msg:'wa auto_reply off — inbound stored only', userId:businessUserId }));
    return;
  }

  // ── Human takeover (W-04): the business is handling this chat; stay silent ──
  if (isBotPaused(conv, now)) {
    console.log(JSON.stringify({ level:'info', msg:'wa human takeover — bot paused, inbound stored', userId:businessUserId, conversationId:conv?.id }));
    if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
    return;
  }

  // ── Reply quota — B-06: atomic monthly counter ──
  const { limits } = await getUserSubscription(businessUserId);
  const replyQuota = await consumeQuota(supabase, { userId:businessUserId, metric:METRICS.REPLY, amount:1, limit:limits.whatsapp_replies });
  if (!replyQuota.allowed) {
    console.log(JSON.stringify({ level:'warn', msg:'wa reply quota reached — inbound stored only', userId:businessUserId, used:replyQuota.used, limit:limits.whatsapp_replies }));
    return;
  }

  // ── Welcome exactly once (W-02), then still answer a real question ──
  if (shouldWelcome({ welcomeMessage: businessSettings.welcome_message, contact: contactRecord })) {
    const welcome = String(businessSettings.welcome_message).replace('{name}', customerName);
    if (await send(welcome)) {
      await supabase.from('contacts').update({ welcomed_at:nowIso }).eq('id',contactRecord.id);
    }
    if (isGreetingOnly(msgText)) {                       // the greeting *is* the opener
      if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
      return;
    }
  }

  // ── Phase 8.2 (W-01): the order + payment loop ──
  // Runs before the generic reply; returns true when it answered (so the AI
  // does not talk over an order confirmation). Never blocks the AI reply.
  try {
    if (await handleOrderFlow({ businessSettings, businessUserId, contactRecord, conv, from, customerName, msgText, send })) {
      await supabase.from('business_settings').update({ reply_count:(businessSettings.reply_count||0)+1 }).eq('user_id',businessUserId);
      if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
      return;
    }
  } catch (e) { console.warn('[order flow]', e.message); }

  // ── Generate & send the AI reply ──
  const { response:aiReply } = await processWAMessage({ businessUserId, customerPhone:from, customerMessage:msgText, businessSettings, conversationId:conv?.id });
  await send(aiReply, { aiProcessed:true });
  await supabase.from('business_settings').update({ reply_count:(businessSettings.reply_count||0)+1 }).eq('user_id',businessUserId);
  if (creds) await markWARead(msgId, creds.phoneNumberId, creds.accessToken);
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 4: SOCIAL MEDIA / CONTENT ROUTES (22) ───────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /social/platforms
app.get('/social/platforms', authenticate, async (req, res) => {
  const platforms = [
    { id:'tiktok',    name:'TikTok',          supported:true,  content_types:['video'] },
    { id:'instagram', name:'Instagram',        supported:true,  content_types:['video','image','carousel'] },
    { id:'facebook',  name:'Facebook',         supported:true,  content_types:['video','image','text'] },
    { id:'youtube',   name:'YouTube Shorts',   supported:true,  content_types:['video'] },
    { id:'twitter',   name:'X (Twitter)',      supported:false, content_types:['text','image'] },
  ];
  const { data:connected } = await supabase.from('connected_accounts').select('platform,account_name,is_active').eq('user_id',req.user.id);
  const map = Object.fromEntries((connected||[]).map(a => [a.platform, a]));
  return res.json({ success:true, data:platforms.map(p => ({ ...p, connected:!!map[p.id], account_name:map[p.id]?.account_name||null })) });
});

// POST /social/connect/:platform
const SOCIAL_PROVIDERS = {
  instagram: { id:'instagram', clientId:META_APP_ID,       clientSecret:META_APP_SECRET,       scope:'instagram_basic,instagram_content_publish,pages_show_list,pages_manage_posts,pages_read_engagement' },
  facebook:  { id:'facebook',  clientId:META_APP_ID,       clientSecret:META_APP_SECRET,       scope:'instagram_basic,instagram_content_publish,pages_show_list,pages_manage_posts,pages_read_engagement' },
  tiktok:    { id:'tiktok',    clientId:TIKTOK_CLIENT_KEY, clientSecret:TIKTOK_CLIENT_SECRET, scope:'video.upload,video.publish' },
  youtube:   { id:'youtube',   clientId:YOUTUBE_CLIENT_ID, clientSecret:YOUTUBE_CLIENT_SECRET, scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube' },
};

app.post('/social/connect/:platform', authenticate, async (req, res) => {
  const { platform } = req.params;
  const provider = SOCIAL_PROVIDERS[platform];
  if (!provider) return res.status(400).json({ success:false, error:'Platform not supported yet.' });
  if (!provider.clientId || !provider.clientSecret)
    return res.status(400).json({ success:false, error:`${platform} is not configured on this server.` });

  // S-07: random opaque handle stored server-side (hash only) + PKCE S256.
  const state = newOAuthState();
  const { verifier, challenge, method } = newPkcePair();
  const redir = `${BACKEND_URL}/social/callback/${platform}`;
  const { error:stateErr } = await supabase.from('oauth_states').insert({
    user_id:req.user.id, platform, state_hash:hashState(state),
    code_verifier:encrypt(verifier), redirect_uri:redir,
    expires_at:new Date(Date.now()+OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (stateErr) {
    console.error('[OAUTH state store]', stateErr.message);
    return res.status(503).json({ success:false, error:'Social connect is temporarily unavailable. Please try again shortly.' });
  }
  // Best-effort housekeeping — must never block or fail the connect flow.
  supabase.from('oauth_states').delete().lt('expires_at', new Date(Date.now()-24*60*60*1000).toISOString()).then(()=>{}, ()=>{});

  const authUrl = buildAuthorizeUrl(provider, { state, challenge, method, redirectUri:redir });
  if (!authUrl) return res.status(400).json({ success:false, error:'Platform not supported yet.' });
  return res.json({ success:true, data:{ auth_url:authUrl, platform, expires_in:Math.round(OAUTH_STATE_TTL_MS/1000), pkce:method }, message:`Open this URL to connect ${platform}` });
});

// GET /social/callback/:platform
app.get('/social/callback/:platform', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error:oErr } = req.query;
  const fail = (e) => res.redirect(`${FRONTEND_URL}/settings/social?error=${encodeURIComponent(e)}`);
  if (oErr) return fail(`provider_${sanitizeProviderError(oErr)}`);
  if (!code||!state) return fail('missing_params');
  if (!SOCIAL_PROVIDERS[platform]) return fail('unsupported_platform');
  try {
    // S-07: the state is an opaque handle. Identity comes from the DB row — never
    // from the callback URL — and the row can be redeemed exactly once.
    const { data:stateRow } = await supabase.from('oauth_states').select('*').eq('state_hash', hashState(String(state))).single();
    const decision = stateDecision({ record: stateRow, platform });
    if (!decision.ok) {
      console.warn(JSON.stringify({ level:'warn', msg:'oauth state rejected', platform, reason:decision.reason }));
      return fail(`state_${decision.reason}`);
    }
    const { data:redeemed } = await supabase.from('oauth_states')
      .update({ used_at:new Date().toISOString() }).eq('id', stateRow.id).is('used_at', null).select('id');
    if (!redeemed || !redeemed.length) return fail('state_used');
    const userId       = stateRow.user_id;
    const codeVerifier = stateRow.code_verifier ? decrypt(stateRow.code_verifier) : null;
    const pkceParam    = codeVerifier ? `&code_verifier=${encodeURIComponent(codeVerifier)}` : '';
    let accessToken='', refreshToken='', expiresAt='', accountId='', accountName='', profilePicUrl='';

    if (platform==='instagram'||platform==='facebook') {
      const tr   = await (await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(`${BACKEND_URL}/social/callback/${platform}`)}&code=${code}${pkceParam}`)).json();
      accessToken = tr.access_token||'';
      const me   = await (await fetch(`https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,picture`)).json();
      accountId  = me.id; accountName = me.name; profilePicUrl = me.picture?.data?.url||'';
    } else if (platform==='tiktok') {
      const ttBody = { client_key:TIKTOK_CLIENT_KEY||'', client_secret:TIKTOK_CLIENT_SECRET||'', code:String(code), grant_type:'authorization_code', redirect_uri:`${BACKEND_URL}/social/callback/tiktok` };
      if (codeVerifier) ttBody.code_verifier = codeVerifier;   // S-07 PKCE
      const tr   = await (await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(ttBody) })).json();
      accessToken = tr.data?.access_token||''; refreshToken = tr.data?.refresh_token||'';
      expiresAt   = new Date(Date.now()+(tr.data?.expires_in||86400)*1000).toISOString();
      accountId   = tr.data?.open_id||''; accountName = 'TikTok Account';
    } else if (platform==='youtube') {
      const ytBody = { client_id:YOUTUBE_CLIENT_ID||'', client_secret:YOUTUBE_CLIENT_SECRET||'', redirect_uri:`${BACKEND_URL}/social/callback/youtube`, code:String(code), grant_type:'authorization_code' };
      if (codeVerifier) ytBody.code_verifier = codeVerifier;   // S-07 PKCE
      const tr   = await (await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(ytBody) })).json();
      accessToken = tr.access_token||''; refreshToken = tr.refresh_token||'';
      expiresAt   = new Date(Date.now()+(tr.expires_in||3600)*1000).toISOString();
      const ch   = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers:{ Authorization:`Bearer ${accessToken}` } })).json();
      accountId   = ch.items?.[0]?.id||''; accountName = ch.items?.[0]?.snippet?.title||'YouTube Channel';
    }

    if (!accessToken||!accountId) throw new Error('OAuth failed — missing token or account ID');

    const { limits } = await getUserSubscription(userId);
    const { count }  = await supabase.from('connected_accounts').select('id',{ count:'exact', head:true }).eq('user_id',userId);
    if ((count||0) >= limits.max_social_platforms) return res.redirect(`${FRONTEND_URL}/settings/social?error=platform_limit`);

    await supabase.from('connected_accounts').upsert({ user_id:userId, platform, account_id:accountId, account_name:accountName, profile_pic_url:profilePicUrl, access_token:encrypt(accessToken), refresh_token:refreshToken?encrypt(refreshToken):null, token_expires_at:expiresAt||null, is_active:true, connected_at:new Date().toISOString(), updated_at:new Date().toISOString() }, { onConflict:'user_id,platform,account_id' });
    return res.redirect(`${FRONTEND_URL}/settings/social?success=${platform}`);
  } catch (err) {
    console.error('[OAUTH ERROR]', err.message);
    return res.redirect(`${FRONTEND_URL}/settings/social?error=auth_failed`);
  }
});

// DELETE /social/disconnect/:platform
app.delete('/social/disconnect/:platform', authenticate, async (req, res) => {
  try {
    await supabase.from('connected_accounts').delete().eq('user_id',req.user.id).eq('platform',req.params.platform);
    return res.json({ success:true, message:`${req.params.platform} disconnected.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to disconnect.' }); }
});

// GET /social/accounts
app.get('/social/accounts', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('connected_accounts').select('id,platform,account_name,account_id,profile_pic_url,is_active,last_posted_at,total_posts,connected_at').eq('user_id',req.user.id);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch accounts.' }); }
});

// PATCH /social/accounts/:id
app.patch('/social/accounts/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('connected_accounts').update({ is_active:req.body.is_active, updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Account updated.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update account.' }); }
});

// POST /content/generate/text
app.post('/content/generate/text', authenticate, contentLimiter, quotaGuardFor(METRICS.TEXT), async (req, res) => {
  try {
    const { topic, platform='instagram', tone='professional', language='en', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { data:bv }  = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    let product = null;
    if (product_id) { const { data:p } = await supabase.from('products').select('*').eq('id',product_id).eq('user_id',req.user.id).single(); product = p; }
    const result = await generateCaptionSafe({ topic, platform, tone, language, brandVoice:bv, product });
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'text', topic, product_id, caption:result.caption, hashtags:result.hashtags, generation_status:'completed', ai_model:'qwen2.5-72b' }).select().single();
    return res.json({ success:true, data:{ ...item, ...result }, message:'Caption generated! 🎉' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate text.' }); }
});

// POST /content/generate/image
app.post('/content/generate/image', authenticate, contentLimiter, quotaGuardFor(METRICS.IMAGE), async (req, res) => {
  try {
    const { topic, platform='instagram', tone='professional', language='en', aspect_ratio='1:1', style='photorealistic', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.ai_image_enabled) return res.status(403).json({ success:false, error:'AI image generation is not available on your plan.' });
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    let product = null;
    if (product_id) { const { data:p } = await supabase.from('products').select('*').eq('id',product_id).eq('user_id',req.user.id).single(); product = p; }
    const [captionResult, imageUrl] = await Promise.all([ generateCaptionSafe({ topic, platform, tone, language, brandVoice:bv, product }), generateAIImage({ topic, aspectRatio:aspect_ratio, style }) ]);
    const storedUrl = await uploadToStorage(imageUrl, req.user.id, 'image');
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'image', topic, product_id, image_url:storedUrl||imageUrl, caption:captionResult.caption, hashtags:captionResult.hashtags, aspect_ratio, generation_status:'completed' }).select().single();
    return res.json({ success:true, data:{ ...item, ...captionResult }, message:'Image generated! 🖼️' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate image.' }); }
});

// POST /content/generate/video
app.post('/content/generate/video', authenticate, contentLimiter, quotaGuardFor(METRICS.VIDEO), async (req, res) => {
  try {
    const { topic, platform='tiktok', tone='professional', language='en', duration=6, aspect_ratio='9:16', style='modern', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.ai_video_enabled) return res.status(403).json({ success:false, error:'AI video generation requires Creator plan or above.' });
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    let product = null;
    if (product_id) { const { data:p } = await supabase.from('products').select('*').eq('id',product_id).eq('user_id',req.user.id).single(); product = p; }
    const captionResult = await generateCaptionSafe({ topic, platform, tone, language, brandVoice:bv, product });
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'video', topic, product_id, caption:captionResult.caption, hashtags:captionResult.hashtags, aspect_ratio, duration_seconds:duration, generation_status:'generating' }).select().single();
    res.json({ success:true, data:{ ...item, ...captionResult }, message:'Video generation started! Takes 1-3 minutes. Refresh shortly.' });
    // Generate asynchronously
    (async () => {
      try {
        const videoUrl   = await generateAIVideo({ topic, caption:captionResult.caption, duration, aspectRatio:aspect_ratio, style });
        const storedUrl  = videoUrl ? await uploadToStorage(videoUrl, req.user.id, 'video') : null;
        const thumbUrl   = await fetchStockImage(topic);
        await supabase.from('content_items').update({ video_url:storedUrl||videoUrl, thumbnail_url:thumbUrl, generation_status:'completed' }).eq('id',item.id);
        if (videoUrl?.startsWith('/tmp/') && fs.existsSync(videoUrl)) fs.unlinkSync(videoUrl);
      } catch (e) {
        await supabase.from('content_items').update({ generation_status:'failed', generation_error:e.message }).eq('id',item.id);
      }
    })();
  } catch { return res.status(500).json({ success:false, error:'Failed to start video generation.' }); }
});

// POST /content/generate/carousel
app.post('/content/generate/carousel', authenticate, contentLimiter, quotaGuardFor(METRICS.IMAGE, (req) => Math.min(Math.max(Number(req.body?.slides) || 5, 1), 10)), async (req, res) => {
  try {
    const { topic, platform='instagram', language='en', slides=5, product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const captionResult = await generateCaptionSafe({ topic, platform, tone:'professional', language });
    const count   = Math.min(Number(slides),10);
    const images  = await Promise.all(Array.from({ length:count }, (_,i) => generateAIImage({ topic:`${topic} - slide ${i+1}`, style:'photorealistic' })));
    const stored  = await Promise.all(images.map(u => uploadToStorage(u, req.user.id, 'image')));
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'carousel', topic, product_id, images:stored.filter(Boolean), caption:captionResult.caption, hashtags:captionResult.hashtags, generation_status:'completed' }).select().single();
    return res.json({ success:true, data:{ ...item, ...captionResult }, message:`Carousel with ${count} slides generated!` });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate carousel.' }); }
});

// POST /content/generate/caption
app.post('/content/generate/caption', authenticate, contentLimiter, async (req, res) => {
  try {
    const { topic, platform='instagram', tone='professional', language='en', context } = req.body;
    if (!topic&&!context) return res.status(400).json({ success:false, error:'Topic or context is required.' });
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    const result = await generateCaptionSafe({ topic:topic||context, platform, tone, language, brandVoice:bv });
    return res.json({ success:true, data:result, message:'Caption generated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate caption.' }); }
});

// POST /content/regenerate/:id
app.post('/content/regenerate/:id', authenticate, contentLimiter, async (req, res) => {
  try {
    const { data:item } = await supabase.from('content_items').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!item) return res.status(404).json({ success:false, error:'Content not found.' });
    // B-06: a regeneration costs the same quota as a generation for that type.
    const metric = metricForContentType(item.type);
    if (metric) {
      const { limits } = await getUserSubscription(req.user.id);
      const q = await consumeQuota(supabase, { userId:req.user.id, metric, amount:1, limit:limits[metric] });
      if (!q.allowed) return res.status(403).json(quotaExceededBody(metric, q));
    }
    const { platform='instagram', tone='professional', language='en' } = req.body;
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    const result = await generateCaptionSafe({ topic:item.topic, platform, tone, language, brandVoice:bv });
    const { data:updated } = await supabase.from('content_items').update({ caption:result.caption, hashtags:result.hashtags, updated_at:new Date().toISOString() }).eq('id',req.params.id).select().single();
    return res.json({ success:true, data:{ ...updated, ...result }, message:'Regenerated with a fresh variation!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to regenerate.' }); }
});

// GET /content/library
app.get('/content/library', authenticate, async (req, res) => {
  try {
    let { page=1, limit=20, type, status } = req.query;
    const pg = parsePagination({ page, limit }, { page:1, limit:20, maxLimit:100 });
    page = pg.page; limit = pg.limit; const offset = pg.offset;
    let q = supabase.from('content_items').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+limit-1).order('created_at',{ ascending:false });
    if (type)   q = q.eq('type', sanitizeStr(String(type),20));
    if (status) q = q.eq('generation_status', sanitizeStr(String(status),20));
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data:data||[], meta:{ total:count, page:Number(page), limit:Number(limit) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch library.' }); }
});

// GET /content/library/:id
app.get('/content/library/:id', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('content_items').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!data) return res.status(404).json({ success:false, error:'Content not found.' });
    return res.json({ success:true, data });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch content.' }); }
});

// PATCH /content/library/:id
app.patch('/content/library/:id', authenticate, async (req, res) => {
  try {
    const { caption, hashtags } = req.body;
    const { data } = await supabase.from('content_items').update({ caption, hashtags, updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
    return res.json({ success:true, data, message:'Content updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update content.' }); }
});

// DELETE /content/library/:id
app.delete('/content/library/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('content_items').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Content deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete content.' }); }
});

// POST /content/upload
app.post('/content/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, error:'No file uploaded.' });
    // Per-user daily upload quota (20/day) — prevents abuse
    try {
      const since = new Date(new Date().setHours(0,0,0,0)).toISOString();
      const { count: upCount } = await supabase.from('content_items').select('id',{count:'exact',head:true}).eq('user_id', req.user.id).gte('created_at', since);
      if ((upCount||0) >= 50) return res.status(429).json({ success:false, error:'Daily upload limit reached. Try again tomorrow.' });
    } catch {}
    // Additional magic-byte validation with sharp for images
    if (String(req.file.mimetype).startsWith('image/')) {
      try { await sharp(req.file.buffer).metadata(); }
      catch { return res.status(400).json({ success:false, error:'Invalid or corrupted image file.' }); }
    }
    const isVideo  = req.file.mimetype.startsWith('video/');
    const isImage  = req.file.mimetype.startsWith('image/');
    const ext      = isVideo ? 'mp4' : 'jpg';
    const fileName = `${req.user.id}/uploads/${Date.now()}.${ext}`;
    let buf = req.file.buffer;
    if (isImage) buf = await sharp(req.file.buffer).resize({ width:1920, withoutEnlargement:true }).jpeg({ quality:85 }).toBuffer();
    const { error } = await supabase.storage.from('content-media').upload(fileName, buf, { contentType:req.file.mimetype, cacheControl:'3600' });
    if (error) throw error;
    const { data:{ publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:isVideo?'video':'image', topic:req.body.topic||'Uploaded media', [isVideo?'video_url':'image_url']:publicUrl, generation_status:'completed' }).select().single();
    return res.json({ success:true, data:{ ...item, url:publicUrl }, message:'File uploaded!' });
  } catch { return res.status(500).json({ success:false, error:'Upload failed.' }); }
});

// POST /content/schedule
app.post('/content/schedule', authenticate, async (req, res) => {
  try {
    let { content_id, platforms, scheduled_for, timezone='Africa/Lagos' } = req.body;
    if (!content_id||!platforms?.length||!scheduled_for) return res.status(400).json({ success:false, error:'content_id, platforms and scheduled_for are required.' });
    if (!Array.isArray(platforms) || platforms.length === 0 || platforms.length > 4) return res.status(400).json({ success:false, error:'platforms must be 1-4 items.' });
    const allowedPlatforms = new Set(['instagram','facebook','tiktok','youtube']);
    if (platforms.some(p => !allowedPlatforms.has(String(p).toLowerCase()))) return res.status(400).json({ success:false, error:'Invalid platform.' });
    platforms = platforms.map(p => String(p).toLowerCase());
    const schedDate = new Date(scheduled_for);
    if (isNaN(schedDate.getTime())) return res.status(400).json({ success:false, error:'Invalid scheduled_for date.' });
    if (schedDate.getTime() < Date.now() - 60000) return res.status(400).json({ success:false, error:'scheduled_for must be in the future.' });
    timezone = sanitizeStr(timezone, 60);
    const { data:content } = await supabase.from('content_items').select('*').eq('id',content_id).eq('user_id',req.user.id).single();
    if (!content) return res.status(404).json({ success:false, error:'Content not found.' });
    const { limits } = await getUserSubscription(req.user.id);
    const { count }  = await supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id).eq('status','scheduled');
    if ((count||0) >= limits.scheduled_posts_limit) return res.status(403).json({ success:false, error:`Scheduled post limit (${limits.scheduled_posts_limit}) reached.` });
    const daysAhead = (new Date(scheduled_for).getTime()-Date.now())/(1000*60*60*24);
    if (daysAhead > limits.schedule_days_ahead) return res.status(403).json({ success:false, error:`Your plan allows scheduling up to ${limits.schedule_days_ahead} days ahead.` });
    const { data:post, error } = await supabase.from('posts').insert({ user_id:req.user.id, content_id, platforms, scheduled_for, timezone, status:'scheduled' }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data:post, message:'Post scheduled!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to schedule post.' }); }
});

// POST /content/schedule/bulk
app.post('/content/schedule/bulk', authenticate, async (req, res) => {
  try {
    const { content_ids, platforms, days=7, times_per_day=1, start_date, timezone='Africa/Lagos' } = req.body;
    if (!content_ids?.length||!platforms?.length) return res.status(400).json({ success:false, error:'content_ids and platforms are required.' });
    const { limits }   = await getUserSubscription(req.user.id);
    const startDate    = start_date ? new Date(start_date) : new Date();
    const optimalHours = [9,13,18,20];
    const toInsert     = [];
    let ci = 0;
    for (let d=0; d<Math.min(Number(days),limits.schedule_days_ahead); d++) {
      for (let t=0; t<Number(times_per_day)&&ci<content_ids.length; t++) {
        const dt = new Date(startDate);
        dt.setDate(dt.getDate()+d);
        dt.setHours(optimalHours[t%optimalHours.length],0,0,0);
        toInsert.push({ user_id:req.user.id, content_id:content_ids[ci%content_ids.length], platforms, scheduled_for:dt.toISOString(), timezone, status:'scheduled' });
        ci++;
      }
    }
    const { data, error } = await supabase.from('posts').insert(toInsert).select();
    if (error) throw error;
    return res.json({ success:true, data, message:`${data.length} posts scheduled across ${days} days!` });
  } catch { return res.status(500).json({ success:false, error:'Failed to bulk schedule.' }); }
});

// GET /content/scheduled
app.get('/content/scheduled', authenticate, async (req, res) => {
  try {
    let { page=1, limit=20 } = req.query;
    const pg = parsePagination({ page, limit }, { page:1, limit:20, maxLimit:100 });
    page = pg.page; limit = pg.limit; const offset = pg.offset;
    const { data, count, error } = await supabase.from('posts').select('*,content_items(topic,type,image_url,video_url,thumbnail_url)', { count:'exact' }).eq('user_id',req.user.id).in('status',['scheduled','posting']).range(offset, offset+limit-1).order('scheduled_for',{ ascending:true });
    if (error) throw error;
    return res.json({ success:true, data:data||[], pagination:{ page, limit, total: count||0 } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch scheduled posts.' }); }
});

// PATCH /content/scheduled/:id
app.patch('/content/scheduled/:id', authenticate, async (req, res) => {
  try {
    const { scheduled_for, platforms } = req.body;
    const { data } = await supabase.from('posts').update({ scheduled_for, platforms, updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
    return res.json({ success:true, data, message:'Post rescheduled!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to reschedule.' }); }
});

// DELETE /content/scheduled/:id
app.delete('/content/scheduled/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('posts').update({ status:'cancelled' }).eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Scheduled post cancelled.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to cancel post.' }); }
});

// POST /content/publish-now
app.post('/content/publish-now', authenticate, async (req, res) => {
  try {
    const { content_id, platforms } = req.body;
    if (!content_id||!platforms?.length) return res.status(400).json({ success:false, error:'content_id and platforms are required.' });
    const { data:content } = await supabase.from('content_items').select('*').eq('id',content_id).eq('user_id',req.user.id).single();
    if (!content) return res.status(404).json({ success:false, error:'Content not found.' });
    const { data:post } = await supabase.from('posts').insert({ user_id:req.user.id, content_id, platforms, scheduled_for:new Date().toISOString(), timezone:'Africa/Lagos', status:'posting' }).select().single();
    const { results, errors } = await publishContent({ ...post, user_id:req.user.id }, content);
    const successCount = platforms.length - Object.keys(errors).length;
    const updateData = { status:successCount>0?'published':'failed', published_at:new Date().toISOString(), error_log:Object.keys(errors).length?errors:null };
    if (results.instagram) { updateData.instagram_post_id=results.instagram.post_id; updateData.instagram_post_url=results.instagram.post_url; }
    if (results.facebook)  { updateData.facebook_post_id=results.facebook.post_id;   updateData.facebook_post_url=results.facebook.post_url; }
    if (results.tiktok)    { updateData.tiktok_post_id=results.tiktok.post_id;        updateData.tiktok_post_url=results.tiktok.post_url; }
    if (results.youtube)   { updateData.youtube_post_id=results.youtube.post_id;      updateData.youtube_post_url=results.youtube.post_url; }
    await supabase.from('posts').update(updateData).eq('id',post.id);
    return res.json({ success:successCount>0, data:{ results, errors }, message:successCount>0?`Published to ${successCount} platform(s)!`:'Publishing failed. Check connected accounts.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to publish.' }); }
});

// GET /content/calendar
app.get('/content/calendar', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const m   = req.query.month ? parseInt(String(req.query.month))-1 : now.getMonth();
    const y   = req.query.year  ? parseInt(String(req.query.year))   : now.getFullYear();
    const { data } = await supabase.from('posts').select('*,content_items(topic,type,image_url,thumbnail_url)').eq('user_id',req.user.id).gte('scheduled_for',new Date(y,m,1).toISOString()).lte('scheduled_for',new Date(y,m+1,0,23,59,59).toISOString()).order('scheduled_for',{ ascending:true });
    return res.json({ success:true, data:data||[], meta:{ month:m+1, year:y } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch calendar.' }); }
});

// POST /content/calendar/automation
app.post('/content/calendar/automation', authenticate, async (req, res) => {
  try {
    const { name, frequency, platforms, content_type='image', topics, tone, language, timezone, days_of_week, times_of_day } = req.body;
    if (!name||!frequency||!platforms?.length) return res.status(400).json({ success:false, error:'name, frequency and platforms are required.' });
    const { data, error } = await supabase.from('content_calendar').insert({ user_id:req.user.id, name, frequency, days_of_week, times_of_day, timezone:timezone||'Africa/Lagos', topics:topics||[], platforms, content_type, tone:tone||'professional', language:language||'en', is_active:true }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Content automation created!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to create automation.' }); }
});

// GET /content/calendar/automations
app.get('/content/calendar/automations', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('content_calendar').select('*').eq('user_id',req.user.id).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch automations.' }); }
});

// PATCH /content/calendar/automations/:id
app.patch('/content/calendar/automations/:id', authenticate, async (req, res) => {
  try {
    // S-16: allow-list — next_generation_at / counters stay server-owned.
    const { values, errors } = pickFields(req.body, {
      name:         { type:'string', max:120, min:1 },
      frequency:    { type:'string', max:20, enum:['daily','3x_week','weekly'] },
      platforms:    { type:'array', of:'string', maxItems:6, enum:['instagram','tiktok','facebook','youtube','twitter'] },
      content_type: { type:'string', max:20, enum:['image','video','text','carousel'] },
      topics:       { type:'array', of:'string', itemMax:120, maxItems:10 },
      tone:         { type:'string', max:30, enum:['professional','casual','friendly','funny','inspirational','urgent'] },
      language:     { type:'string', max:10, enum:['en','pidgin'] },
      timezone:     { type:'string', max:60 },
      days_of_week: { type:'array', of:'string', itemMax:3, maxItems:7 },
      times_of_day: { type:'array', of:'string', itemMax:5, maxItems:6 },
      is_active:    { type:'boolean' },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (values.times_of_day && values.times_of_day.some(t => !/^\d{1,2}:\d{2}$/.test(t)))
      return res.status(400).json({ success:false, error:'times_of_day must use HH:MM format.' });
    if (values.platforms && !values.platforms.length)
      return res.status(400).json({ success:false, error:'Select at least one platform.' });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    await supabase.from('content_calendar').update({ ...values, updated_at:new Date().toISOString() }).eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Automation updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update automation.' }); }
});

// DELETE /content/calendar/automations/:id
app.delete('/content/calendar/automations/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('content_calendar').delete().eq('id',req.params.id).eq('user_id',req.user.id);
    return res.json({ success:true, message:'Automation deleted.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to delete automation.' }); }
});

// GET /content/brand-voice
app.get('/content/brand-voice', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    return res.json({ success:true, data:data||null });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch brand voice.' }); }
});

// PATCH /content/brand-voice
app.patch('/content/brand-voice', authenticate, async (req, res) => {
  try {
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.brand_voice_enabled) return res.status(403).json({ success:false, error:'Brand Voice is available on Creator plan and above.' });
    // S-16: allow-list — no user_id / id / unknown columns from the body.
    const { values, errors } = pickFields(req.body, {
      tone:            { type:'string', max:30, enum:['professional','casual','friendly','funny','inspirational','urgent'] },
      writing_style:   { type:'string', max:120, nullable:true },
      emoji_usage:     { type:'string', max:20, enum:['none','minimal','moderate','heavy'] },
      target_audience: { type:'string', max:200, nullable:true },
      forbidden_words: { type:'array', of:'string', itemMax:60, maxItems:50 },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to save.' });
    const payload = { ...values, user_id:req.user.id, updated_at:new Date().toISOString() };
    const { data:existing } = await supabase.from('brand_voice').select('id').eq('user_id',req.user.id).single();
    const result = existing
      ? await supabase.from('brand_voice').update(payload).eq('user_id',req.user.id).select().single()
      : await supabase.from('brand_voice').insert(payload).select().single();
    if (result.error) throw result.error;
    return res.json({ success:true, data:result.data, message:'Brand voice saved!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to save brand voice.' }); }
});

// POST /content/brand-voice/samples
app.post('/content/brand-voice/samples', authenticate, async (req, res) => {
  try {
    await supabase.from('brand_voice').upsert({ user_id:req.user.id, sample_captions:req.body.sample_captions||[], updated_at:new Date().toISOString() }, { onConflict:'user_id' });
    return res.json({ success:true, message:'Samples saved! AI will learn your style.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to save samples.' }); }
});

// GET /content/templates
app.get('/content/templates', authenticate, async (req, res) => {
  try {
    const { industry, category } = req.query;
    let q = supabase.from('content_templates').select('*').eq('is_active',true);
    if (industry) q = q.eq('industry',industry);
    if (category) q = q.eq('category',category);
    const { data } = await q.order('total_uses',{ ascending:false }).limit(50);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch templates.' }); }
});

// GET /content/templates/:id
app.get('/content/templates/:id', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('content_templates').select('*').eq('id',req.params.id).single();
    if (!data) return res.status(404).json({ success:false, error:'Template not found.' });
    return res.json({ success:true, data });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch template.' }); }
});

// POST /content/templates/:id/use
app.post('/content/templates/:id/use', authenticate, contentLimiter, async (req, res) => {
  try {
    const { data:tpl } = await supabase.from('content_templates').select('*').eq('id',req.params.id).single();
    if (!tpl) return res.status(404).json({ success:false, error:'Template not found.' });
    const { topic, platform='instagram', language='en' } = req.body;
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single();
    const result = await generateCaptionSafe({ topic:topic||tpl.name, platform, tone:'professional', language, brandVoice:bv });
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'image', topic:topic||tpl.name, caption:result.caption, hashtags:result.hashtags||tpl.hashtag_groups?.[0]||[], generation_status:'completed' }).select().single();
    await supabase.from('content_templates').update({ total_uses:(tpl.total_uses||0)+1 }).eq('id',req.params.id);
    return res.json({ success:true, data:{ ...item, ...result }, message:'Content created from template!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to use template.' }); }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 5: ANALYTICS ROUTES (8) ─────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /analytics/overview
app.get('/analytics/overview', authenticate, async (req, res) => {
  try {
    const uid = req.user.id;
    const cacheKey = `overview:${uid}`;
    const cached = analyticsCache.get(cacheKey);
    if (cached) { res.setHeader('X-Cache','HIT'); return res.json({ success:true, data:cached }); }
    const [
      { count:contacts },  { count:orders },
      { count:content },   { count:published },
      { data:recent },     revenue,
    ] = await Promise.all([
      supabase.from('contacts').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('orders').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('content_items').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',uid).eq('status','published'),
      supabase.from('orders').select('order_number,total,currency,status,created_at').eq('user_id',uid).order('created_at',{ ascending:false }).limit(5),
      // D-05: exact totals (SQL aggregate, or every row paged) — never one capped page.
      revenueTotals(supabase, { userId: uid }),
    ]);
    const headline  = headlineCurrency(revenue.byCurrency, req.user.currency);
    const mine      = revenue.byCurrency[headline] || { orders:0, paid:0, revenue:0 };
    const { subscription, plan } = await getUserSubscription(uid);
    const payload = {
      whatsapp:{
        total_contacts:contacts||0,
        total_orders:orders||0,
        paid_orders:mine.paid,
        total_revenue:mine.revenue,
        currency:headline,
        by_currency:revenue.byCurrency,
        mixed_currency:Object.keys(revenue.byCurrency).length > 1,
        revenue_source:revenue.source,
      },
      content:{ total_generated:content||0, total_published:published||0 },
      subscription:{ plan, expires_at:subscription?.expires_at },
      recent_orders:recent||[],
    };
    analyticsCache.set(cacheKey, payload);
    res.setHeader('X-Cache', 'MISS');
    return res.json({ success:true, data: payload });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch analytics.' }); }
});

// GET /analytics/whatsapp
app.get('/analytics/whatsapp', authenticate, async (req, res) => {
  try {
    const days      = req.query.period==='7d' ? 7 : 30;
    const startDate = new Date(Date.now()-days*24*60*60*1000).toISOString();
    const uid       = req.user.id;
    const [{ count:newContacts },{ data:settings }, totals] = await Promise.all([
      supabase.from('contacts').select('id',{ count:'exact', head:true }).eq('user_id',uid).gte('created_at',startDate),
      supabase.from('business_settings').select('reply_count').eq('user_id',uid).single(),
      // D-05: period totals per currency, computed in SQL (or fully paged).
      revenueTotals(supabase, { userId:uid, since:startDate }),
    ]);
    const headline = headlineCurrency(totals.byCurrency, req.user.currency);
    const mine     = totals.byCurrency[headline] || { orders:0, paid:0, revenue:0 };
    return res.json({ success:true, data:{ period:`Last ${days} days`, new_contacts:newContacts||0, total_messages:settings?.reply_count||0, total_orders:mine.orders, paid_orders:mine.paid, revenue:mine.revenue, currency:headline, by_currency:totals.byCurrency, mixed_currency:Object.keys(totals.byCurrency).length>1, conversion_rate:mine.orders>0?Math.round((mine.paid/mine.orders)*100):0, source:totals.source } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch WhatsApp analytics.' }); }
});

// GET /analytics/content
app.get('/analytics/content', authenticate, async (req, res) => {
  try {
    const days      = req.query.period==='7d' ? 7 : 30;
    const startDate = new Date(Date.now()-days*24*60*60*1000).toISOString();
    const uid       = req.user.id;
    const [{ count:generated },{ count:pubCount }, types] = await Promise.all([
      supabase.from('content_items').select('id',{ count:'exact', head:true }).eq('user_id',uid).gte('created_at',startDate),
      supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',uid).eq('status','published').gte('published_at',startDate),
      // D-05: the type histogram counted at most 1,000 rows before.
      contentByType(supabase, { userId:uid, since:startDate }),
    ]);
    const byType = { video:0, image:0, text:0, carousel:0 };
    for (const [k,v] of Object.entries(types.byType)) byType[k] = v;
    return res.json({ success:true, data:{ period:`Last ${days} days`, total_generated:generated||0, total_published:pubCount||0, by_type:byType, source:types.source } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch content analytics.' }); }
});

// GET /analytics/social/:platform
app.get('/analytics/social/:platform', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('post_analytics')
      .select('*,posts!inner(user_id,published_at)')
      .eq('platform',req.params.platform)
      .eq('posts.user_id',req.user.id)
      .order('synced_at',{ ascending:false }).limit(50);
    const totals = (data||[]).reduce((a,i) => ({ views:a.views+(i.views||0), likes:a.likes+(i.likes||0), comments:a.comments+(i.comments||0), shares:a.shares+(i.shares||0) }), { views:0, likes:0, comments:0, shares:0 });
    return res.json({ success:true, data:{ platform:req.params.platform, totals, posts:data||[] } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch platform analytics.' }); }
});

// GET /analytics/revenue
app.get('/analytics/revenue', authenticate, async (req, res) => {
  try {
    const days      = parseInt(String(req.query.period||'30'))||30;
    const startDate = new Date(Date.now()-days*24*60*60*1000).toISOString();
    // D-05: totals + daily series are aggregated in SQL (or fully paged) and are
    // never a mixed-currency sum — each currency is reported on its own.
    const totals   = await revenueTotals(supabase, { userId:req.user.id, since:startDate });
    const headline = headlineCurrency(totals.byCurrency, req.user.currency);
    const mine     = totals.byCurrency[headline] || { orders:0, paid:0, revenue:0 };
    const days_    = await revenueByDay(supabase, { userId:req.user.id, since:startDate, currency:headline });
    const avg      = mine.paid>0 ? mine.revenue/mine.paid : 0;
    return res.json({ success:true, data:{ total_revenue:mine.revenue, total_orders:mine.paid, average_order_value:Math.round(avg), by_day:days_.byDay, currency:headline, by_currency:totals.byCurrency, mixed_currency:Object.keys(totals.byCurrency).length>1, source:(totals.source==='rpc'&&days_.source==='rpc')?'rpc':'paged', truncated:Boolean(totals.truncated||days_.truncated) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch revenue analytics.' }); }
});

// GET /analytics/growth
app.get('/analytics/growth', authenticate, async (req, res) => {
  try {
    const [{ data:accounts }, segments] = await Promise.all([
      supabase.from('connected_accounts').select('platform,total_posts,last_posted_at').eq('user_id',req.user.id),
      // D-05: the segment split + total were computed from one capped page.
      contactsBySegment(supabase, { userId:req.user.id }),
    ]);
    const bySegment = { lead:0, customer:0, vip:0 };
    for (const [k,v] of Object.entries(segments.bySegment)) bySegment[k] = v;
    return res.json({ success:true, data:{ social_accounts:accounts||[], contacts_by_segment:bySegment, total_contacts:segments.total, source:segments.source } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch growth analytics.' }); }
});

// GET /analytics/best-times
app.get('/analytics/best-times', authenticate, (_req, res) => {
  return res.json({ success:true, data:{
    tiktok:    [{ day:'Tuesday',   times:['7am','8am','7pm']   },{ day:'Thursday', times:['9am','12pm','7pm'] },{ day:'Saturday', times:['11am','7pm','8pm'] }],
    instagram: [{ day:'Monday',    times:['6am','12pm','8pm']  },{ day:'Wednesday',times:['11am','1pm','7pm'] },{ day:'Friday',   times:['10am','12pm','3pm']}],
    facebook:  [{ day:'Wednesday', times:['8am','12pm','2pm']  },{ day:'Thursday', times:['1pm','2pm','3pm']  },{ day:'Friday',   times:['10am','11am','12pm']}],
    youtube:   [{ day:'Friday',    times:['12pm','3pm','5pm']  },{ day:'Saturday', times:['9am','11am','3pm'] },{ day:'Sunday',   times:['10am','12pm','4pm'] }],
  }, note:'Optimal times for Nigerian/African audience (WAT timezone)' });
});

// GET /analytics/export
app.get('/analytics/export', authenticate, async (req, res) => {
  try {
    // D-05: an export must contain every row — page through them (up to the cap)
    // instead of silently shipping the first 1,000.
    const [ordersPage, contactsPage] = await Promise.all([
      fetchAllRows(() => supabase.from('orders').select('order_number,customer_name,total,currency,payment_status,status,created_at').eq('user_id',req.user.id)),
      fetchAllRows(() => supabase.from('contacts').select('name,phone,segment,total_orders,total_spent').eq('user_id',req.user.id)),
    ]);
    if (ordersPage.error || contactsPage.error) throw (ordersPage.error || contactsPage.error);
    const orders   = ordersPage.rows;
    const contacts = contactsPage.rows;
    const csv = [
      '=== ORDERS ===', 'order_number,customer,total,payment,status,date,currency',
      ...orders.map(o => `${o.order_number},${o.customer_name||''},${o.total},${o.payment_status},${o.status},${(o.created_at||'').substring(0,10)},${o.currency||''}`),
      '\n=== CONTACTS ===', 'name,phone,segment,orders,spent',
      ...contacts.map(c => `${c.name||''},${c.phone},${c.segment||''},${c.total_orders||0},${c.total_spent||0}`),
      ...(ordersPage.truncated || contactsPage.truncated
        ? ['', `# NOTE: export capped at ${ANALYTICS_MAX_ROWS.toLocaleString('en-US')} rows per section — narrow the range before exporting.`]
        : []),
    ].join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="zapit-analytics.csv"');
    return res.send(csv);
  } catch { return res.status(500).json({ success:false, error:'Export failed.' }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 6: SUBSCRIPTION & BILLING (6) ───────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /subscription/current
app.get('/subscription/current', authenticate, async (req, res) => {
  try {
    const { subscription, plan, limits } = await getUserSubscription(req.user.id);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [{ count:replies },{ count:contactsC },{ count:products },{ count:contentC },{ count:scheduled }] = await Promise.all([
      supabase.from('ai_logs').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id).gte('created_at',monthStart),
      supabase.from('contacts').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id),
      supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id),
      supabase.from('content_items').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id).gte('created_at',monthStart),
      supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',req.user.id).eq('status','scheduled'),
    ]);
    // B-06: expose the real monthly counters when migration 20261009 is applied.
    const monthly = await usageSnapshot(supabase, { userId:req.user.id });
    return res.json({ success:true, data:{ subscription, plan, limits, usage:{ whatsapp_replies:{ used:monthly?.whatsapp_replies ?? (replies||0), limit:limits.whatsapp_replies }, contacts:{ used:contactsC||0, limit:limits.whatsapp_contacts }, products:{ used:products||0, limit:limits.products_limit }, content_generated:{ used:contentC||0, limit:limits.text_posts+limits.image_generations+limits.video_generations }, scheduled_posts:{ used:scheduled||0, limit:limits.scheduled_posts_limit }, monthly:monthly||undefined } } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch subscription.' }); }
});

// GET /subscription/plans
app.get('/subscription/plans', authenticate, async (req, res) => {
  try {
    const location = await detectLocation(req);
    return res.json({ success:true, data:getPricingForLocation(location) });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch plans.' }); }
});

// POST /subscription/upgrade
app.post('/subscription/upgrade', authenticate, async (req, res) => {
  try {
    const { plan, billing_cycle='monthly' } = req.body;
    if (!plan||!PLAN_LIMITS[plan]||plan==='free') return res.status(400).json({ success:false, error:'Invalid plan. Choose: creator, growth, or agency.' });
    if (!PAYSTACK_SECRET_KEY) return res.status(400).json({ success:false, error:'Payment gateway not configured. Contact support.' });
    const { data:user }  = await supabase.from('users').select('email,full_name,currency').eq('id',req.user.id).single();
    const location       = await detectLocation(req);
    const requested      = String(user.currency || location.currency || 'NGN').toUpperCase();
    // B-05: the charge currency is resolved once — GBP/EUR fall back to a USD
    // charge reported as USD, never a USD amount wearing a £/€ symbol.
    const charge = resolveCharge({ plan, currency: requested, billingCycle: billing_cycle });
    if (!charge) return res.status(400).json({ success:false, error:'This plan is not priced for your currency yet. Contact support.' });
    const { amount, currency, amountMinor } = charge;
    const result = await initializePaystack({ email:user.email, amount, currency, metadata:{ user_id:req.user.id, plan, billing_cycle:charge.billingCycle, currency, requested_currency:charge.requested_currency, amount_minor:amountMinor, custom_fields:[{ display_name:'Plan', variable_name:'plan', value:plan }] }, callback_url:`${FRONTEND_URL}/pricing.html?plan=${plan}` });
    if (!result.status) throw new Error(result.message||'Payment init failed');
    return res.json({ success:true, data:{ payment_url:result.data.authorization_url, reference:result.data.reference, amount, currency, requested_currency:charge.requested_currency, currency_converted:charge.converted, billing_cycle:charge.billingCycle, plan }, message: charge.converted ? `Billed in USD — ${charge.requested_currency} is not supported by our payment provider.` : 'Redirecting to payment...' });
  } catch (err) {
    return res.status(500).json({ success:false, error:err.message||'Failed to initialize payment.' });
  }
});

// POST /subscription/cancel — B-02: access is kept until the paid period ends
app.post('/subscription/cancel', authenticate, async (req, res) => {
  try {
    const { data:sub } = await supabase.from('subscriptions').select('*').eq('user_id',req.user.id).eq('status','active').limit(1);
    const current = Array.isArray(sub) ? sub[0] : sub;
    if (!current) return res.status(404).json({ success:false, error:'No active subscription found.' });
    const fields = cancelSubscriptionPlan(current);
    await supabase.from('subscriptions').update({ status:fields.status, cancelled_at:fields.cancelled_at, cancel_at:fields.cancel_at, auto_renew:fields.auto_renew }).eq('id',current.id);
    invalidateSubscriptionCache(req.user.id);
    return res.json({
      success:true,
      data:{ access_until:fields.access_until, plan:current.plan },
      message:fields.access_until
        ? `Subscription cancelled. You'll keep full access until ${new Date(fields.access_until).toDateString()}, then move to the Free plan.`
        : "Subscription cancelled. You're now on the Free plan.",
    });
  } catch { return res.status(500).json({ success:false, error:'Failed to cancel subscription.' }); }
});

// POST /subscription/reactivate — B-01: never grants free time; pays again when the period is over
app.post('/subscription/reactivate', authenticate, async (req, res) => {
  try {
    const { data:rows } = await supabase.from('subscriptions').select('*').eq('user_id',req.user.id).neq('plan','free').order('created_at',{ ascending:false }).limit(1);
    const sub = Array.isArray(rows) ? rows[0] : rows;
    const decision = reactivateDecision(sub);

    if (decision.mode === 'already_active') {
      return res.json({ success:true, data:{ resumed:false, already_active:true, plan:sub.plan, access_until:decision.access_until, payment_required:false }, message:`Your ${sub.plan} plan is already active.` });
    }

    if (decision.mode === 'resume') {
      await supabase.from('subscriptions').update({ status:'active', cancelled_at:null, cancel_at:null, auto_renew:true }).eq('id',sub.id);
      invalidateSubscriptionCache(req.user.id);
      return res.json({
        success:true,
        data:{ resumed:true, plan:sub.plan, access_until:decision.access_until, payment_required:false },
        message:decision.access_until
          ? `Subscription resumed! Your ${sub.plan} plan keeps running until ${new Date(decision.access_until).toDateString()}.`
          : 'Subscription resumed! Welcome back!',
      });
    }

    if (decision.mode === 'not_found') return res.status(404).json({ success:false, error:'No subscription to reactivate. Choose a plan to subscribe.' });
    // Paid period is over (or no paid time left) → require a NEW verified payment.
    if (!PAYSTACK_SECRET_KEY) return res.status(400).json({ success:false, error:'Payment gateway not configured. Contact support.' });
    const { data:user } = await supabase.from('users').select('email,full_name,currency').eq('id',req.user.id).single();
    const cycle    = normalizeCycle(sub.billing_cycle || 'monthly');
    const requested = String(sub.currency || user?.currency || 'NGN').toUpperCase();
    // B-05: reactivation charges the resolved currency too (a legacy GBP row can
    // never produce a GBP charge — it resolves to the USD price).
    const charge   = resolveCharge({ plan: sub.plan, currency: requested, billingCycle: cycle });
    if (!charge) return res.status(400).json({ success:false, error:'This plan cannot be repurchased automatically. Contact support.' });
    const amount   = charge.amount;
    const currency = charge.currency;
    const result   = await initializePaystack({
      email:user?.email || '', amount, currency,
      metadata:{ user_id:req.user.id, plan:sub.plan, billing_cycle:cycle, currency, requested_currency:charge.requested_currency, amount_minor:charge.amountMinor, reactivation:true },
      callback_url:`${FRONTEND_URL}/payment-success`,
    });
    if (!result.status) throw new Error(result.message || 'Payment init failed');
    return res.status(402).json({
      success:false,
      data:{ payment_required:true, payment_url:result.data.authorization_url, reference:result.data.reference, amount, currency, plan:sub.plan, billing_cycle:cycle },
      error:'Your paid period has ended. Complete a new payment to reactivate.',
    });
  } catch (err) { return res.status(500).json({ success:false, error:err.message||'Failed to reactivate.' }); }
});

// GET /subscription/invoices — B-04: append-only ledger first, subscriptions as legacy fallback
app.get('/subscription/invoices', authenticate, async (req, res) => {
  try {
    // D-05: paginated + exact count; the legacy fallback used to be capped at 1,000
    // rows with no way to tell that older invoices existed.
    const pg = parsePagination({ page:req.query.page, limit:req.query.limit }, { page:1, limit:20, maxLimit:100 });
    const from = (pg.page - 1) * pg.limit, to = from + pg.limit - 1;
    const ledger = await supabase.from('transactions')
      .select('id,paystack_reference,plan,billing_cycle,amount_paid,currency,status,created_at', { count:'exact' })
      .eq('user_id',req.user.id).order('created_at',{ ascending:false }).range(from, to);
    if (ledger.data?.length) {
      return res.json({ success:true, data:ledger.data, meta:{ total:ledger.count ?? ledger.data.length, page:pg.page, limit:pg.limit, has_more:(ledger.count ?? 0) > to + 1 } });
    }
    const legacy = await supabase.from('subscriptions')
      .select('id,plan,status,amount_paid,currency,billing_cycle,starts_at,expires_at,paystack_reference', { count:'exact' })
      .eq('user_id',req.user.id).order('created_at',{ ascending:false }).range(from, to);
    return res.json({ success:true, data:legacy.data||[], meta:{ total:legacy.count ?? (legacy.data||[]).length, page:pg.page, limit:pg.limit, has_more:(legacy.count ?? 0) > to + 1 } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch invoices.' }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 7: REFERRALS (5) ────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /referrals/stats
app.get('/referrals/stats', authenticate, async (req, res) => {
  try {
    const [{ data:stats },{ data:user }] = await Promise.all([
      supabase.from('affiliate_stats').select('*').eq('user_id',req.user.id).single(),
      supabase.from('users').select('referral_code').eq('id',req.user.id).single(),
    ]);
    return res.json({ success:true, data:{ referral_code:user?.referral_code, referral_link:`${FRONTEND_URL}?ref=${user?.referral_code}`, stats:stats||{ total_referrals:0, successful_referrals:0, total_earnings:0 } } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch referral stats.' }); }
});

// GET /referrals/code
app.get('/referrals/code', authenticate, async (req, res) => {
  try {
    const { data:user } = await supabase.from('users').select('referral_code').eq('id',req.user.id).single();
    return res.json({ success:true, data:{ code:user?.referral_code, link:`${FRONTEND_URL}?ref=${user?.referral_code}`, reward:'Get 1 free month for every 3 successful referrals!' } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch referral code.' }); }
});

// POST /referrals/apply
app.post('/referrals/apply', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success:false, error:'Referral code is required.' });
    const { data:referrer } = await supabase.from('users').select('id').eq('referral_code',code.toUpperCase()).single();
    if (!referrer) return res.status(404).json({ success:false, error:'Invalid referral code.' });
    if (referrer.id===req.user.id) return res.status(400).json({ success:false, error:'You cannot use your own referral code.' });
    await supabase.from('referrals').upsert({ referrer_id:referrer.id, referred_id:req.user.id, referred_signed_up:true, status:'pending' },{ onConflict:'referrer_id,referred_id' });
    await supabase.from('users').update({ referred_by:referrer.id }).eq('id',req.user.id);
    return res.json({ success:true, message:'Referral code applied! Your referrer earns a reward when you upgrade.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to apply referral code.' }); }
});

// GET /referrals/history
app.get('/referrals/history', authenticate, async (req, res) => {
  try {
    // D-05: the referral list was an unbounded read (PostgREST caps it at 1,000).
    const pg = parsePagination({ page:req.query.page, limit:req.query.limit }, { page:1, limit:20, maxLimit:100 });
    const from = (pg.page - 1) * pg.limit, to = from + pg.limit - 1;
    const { data, count } = await supabase.from('referrals').select('*,users!referred_id(email,full_name,created_at)', { count:'exact' }).eq('referrer_id',req.user.id).order('created_at',{ ascending:false }).range(from, to);
    return res.json({ success:true, data:data||[], meta:{ total:count ?? (data||[]).length, page:pg.page, limit:pg.limit, has_more:(count ?? 0) > to + 1 } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch referral history.' }); }
});

// POST /referrals/payout-request
app.post('/referrals/payout-request', authenticate, async (req, res) => {
  try {
    const { payout_method, payout_details } = req.body;
    await supabase.from('affiliate_stats').upsert({ user_id:req.user.id, payout_method, payout_details, updated_at:new Date().toISOString() },{ onConflict:'user_id' });
    return res.json({ success:true, message:'Payout request submitted! We process within 3-5 business days.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to submit payout request.' }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 8: TEMPLATES & LIBRARY (6) ──────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /templates/business
app.get('/templates/business', async (_req, res) => {
  try {
    const { data } = await supabase.from('business_type_templates').select('id,code,name,category,description,icon').eq('is_active',true).order('name');
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch templates.' }); }
});

// GET /templates/business/:code
app.get('/templates/business/:code', async (req, res) => {
  try {
    const { data } = await supabase.from('business_type_templates').select('*').eq('code',req.params.code).single();
    if (!data) return res.status(404).json({ success:false, error:'Template not found.' });
    return res.json({ success:true, data });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch template.' }); }
});

// POST /templates/business/:code/apply
app.post('/templates/business/:code/apply', authenticate, async (req, res) => {
  try {
    const { data:tpl } = await supabase.from('business_type_templates').select('*').eq('code',req.params.code).single();
    if (!tpl) return res.status(404).json({ success:false, error:'Template not found.' });

    // Apply sample products — validate required fields before inserting
    if (Array.isArray(tpl.sample_products) && tpl.sample_products.length) {
      const validProducts = tpl.sample_products
        .filter(p => p && p.name && p.price != null)
        .map(p => ({
          user_id:     req.user.id,
          name:        String(p.name),
          description: p.description ? String(p.description) : null,
          price:       Number(p.price),
          currency:    p.currency || 'NGN',
          category:    p.category || null,
          type:        p.type || 'physical',
          is_active:   true,
        }));
      if (validProducts.length) {
        await supabase.from('products').insert(validProducts).then(undefined, e => console.error('[TEMPLATE PRODUCTS]', e.message));
      }
    }

    // Apply sample KB entries — validate required fields
    if (Array.isArray(tpl.sample_kb_entries) && tpl.sample_kb_entries.length) {
      const validKb = tpl.sample_kb_entries
        .filter(e => e && e.trigger && e.response)
        .map(e => ({
          user_id:   req.user.id,
          trigger:   String(e.trigger).toLowerCase(),
          response:  String(e.response),
          category:  e.category || 'General',
          language:  e.language || 'en',
          is_active: true,
        }));
      if (validKb.length) {
        await supabase.from('knowledge_base').insert(validKb).then(undefined, e => console.error('[TEMPLATE KB]', e.message));
      }
    }

    // Apply business settings if included
    if (tpl.sample_settings && typeof tpl.sample_settings === 'object') {
      const s = tpl.sample_settings;
      await supabase.from('business_settings').upsert({
        user_id:             req.user.id,
        business_category:   tpl.category || 'General',
        bot_personality:     s.bot_personality || 'friendly',
        language_preference: s.language_preference || 'en',
        welcome_message:     s.welcome_message || null,
        payment_methods:     s.payment_methods || ['bank_transfer'],
      }, { onConflict: 'user_id' }).then(undefined, e => console.error('[TEMPLATE SETTINGS]', e.message));
    }

    return res.json({ success:true, message:`"${tpl.name}" template applied! Check your Products and Knowledge Base.` });
  } catch (err) {
    console.error('[TEMPLATE APPLY]', err.message);
    return res.status(500).json({ success:false, error:'Failed to apply template: ' + err.message });
  }
});

// GET /library/global-kb
app.get('/library/global-kb', authenticate, async (req, res) => {
  try {
    const { industry, category, language } = req.query;
    let q = supabase.from('global_kb_library').select('*').eq('is_active',true);
    if (industry) q = q.or(`industry.eq.${industry},industry.eq.all`);
    if (category) q = q.eq('category',category);
    if (language) q = q.eq('language',language);
    const { data } = await q.order('uses',{ ascending:false }).limit(100);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch global KB.' }); }
});

// POST /library/global-kb/:id/copy
app.post('/library/global-kb/:id/copy', authenticate, async (req, res) => {
  try {
    const { data:entry } = await supabase.from('global_kb_library').select('*').eq('id',req.params.id).single();
    if (!entry) return res.status(404).json({ success:false, error:'Entry not found.' });
    await supabase.from('knowledge_base').insert({ user_id:req.user.id, trigger:entry.trigger, response:entry.response, category:entry.category, language:entry.language });
    await supabase.from('global_kb_library').update({ uses:(entry.uses||0)+1 }).eq('id',req.params.id);
    return res.json({ success:true, message:'Keyword response added to your bot!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to copy entry.' }); }
});

// POST /library/global-kb/copy-all
app.post('/library/global-kb/copy-all', authenticate, async (req, res) => {
  try {
    const { industry, language } = req.body;
    let q = supabase.from('global_kb_library').select('*').eq('is_active',true);
    if (industry) q = q.or(`industry.eq.${industry},industry.eq.all`);
    if (language) q = q.eq('language',language);
    const { data:entries } = await q.limit(50);
    if (!entries?.length) return res.status(404).json({ success:false, error:'No entries found for this filter.' });
    await supabase.from('knowledge_base').insert(entries.map(e => ({ user_id:req.user.id, trigger:e.trigger, response:e.response, category:e.category, language:e.language })));
    return res.json({ success:true, message:`${entries.length} keyword responses added to your bot!` });
  } catch { return res.status(500).json({ success:false, error:'Failed to copy entries.' }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 9: ADMIN PANEL (12) ─────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /admin/users
app.get('/admin/users', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { page=1, limit=20, search } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    let q = supabase.from('users').select('id,email,username,full_name,country_code,currency,email_verified,is_active,is_suspended,created_at,last_login',{ count:'exact' }).range(offset,offset+Number(limit)-1).order('created_at',{ ascending:false });
    if (search) q = q.or(`email.ilike.%${search}%,username.ilike.%${search}%,full_name.ilike.%${search}%`);
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page, limit } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch users.' }); }
});

// GET /admin/users/:id — Phase 6.1 S-22: explicit DTO (never password_hash/otp)
app.get('/admin/users/:id', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const [{ data:user },{ subscription, plan },{ count:orderCount }] = await Promise.all([
      supabase.from('users').select(SAFE_USER_SELECT).eq('id',req.params.id).single(),
      getUserSubscription(req.params.id),
      supabase.from('orders').select('id',{ count:'exact', head:true }).eq('user_id',req.params.id),
    ]);
    if (!user) return res.status(404).json({ success:false, error:'User not found.' });
    return res.json({ success:true, data:{ ...user, plan, subscription, total_orders:orderCount } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch user.' }); }
});

// POST /admin/users/:id/set-plan
// POST /admin/users/:id/set-plan — B-07: free grants are explicit, bounded, and audited
app.post('/admin/users/:id/set-plan', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLAN_LIMITS[plan]) return res.status(400).json({ success:false, error:'Invalid plan.' });
    const days = req.body.expires_in_days === undefined ? 30 : Number(req.body.expires_in_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ success:false, error:'expires_in_days must be an integer between 1 and 365.' });
    }
    invalidateSubscriptionCache(req.params.id);
    await supabase.from('subscriptions').upsert({ user_id:req.params.id, plan, status:'active', billing_cycle:'admin_override', amount_paid:0, starts_at:new Date().toISOString(), expires_at:new Date(Date.now()+days*24*60*60*1000).toISOString(), cancel_at:null, cancelled_at:null },{ onConflict:'user_id' });
    // Audit trail for privileged grants (table from Phase 6.1 migration)
    try {
      await supabase.from('admin_audit_log').insert({ admin_user_id:req.user?.id || null, action:`set_plan:${plan}:${days}d`, target_user_id:req.params.id, ip_address:req.ip, details:{ plan, days, via:req.adminVia || 'role' } });
    } catch (e) { console.warn('[admin audit]', e.message); }
    return res.json({ success:true, message:`User plan set to ${plan} for ${days} days.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to set plan.' }); }
});

// POST /admin/users/:id/suspend
app.post('/admin/users/:id/suspend', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { data:user } = await supabase.from('users').select('is_suspended').eq('id',req.params.id).single();
    const suspend = !user?.is_suspended;
    await supabase.from('users').update({ is_suspended:suspend, suspension_reason:suspend?(req.body.reason||'Suspended by admin'):null }).eq('id',req.params.id);
    return res.json({ success:true, message:`User ${suspend?'suspended':'unsuspended'}.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to update user status.' }); }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    await supabase.from('users').update({ is_active:false, email:`deleted_${Date.now()}_${req.params.id}@deleted.com` }).eq('id',req.params.id);
    return res.json({ success:true, message:'User account deactivated.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to deactivate user.' }); }
});

// GET /admin/platform-stats
app.get('/admin/platform-stats', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const [{ count:totalUsers },{ count:paying },{ count:orders },{ count:contentItems }] = await Promise.all([
      supabase.from('users').select('id',{ count:'exact', head:true }).eq('is_active',true),
      supabase.from('subscriptions').select('id',{ count:'exact', head:true }).eq('status','active').neq('plan','free'),
      supabase.from('orders').select('id',{ count:'exact', head:true }),
      supabase.from('content_items').select('id',{ count:'exact', head:true }),
    ]);
    return res.json({ success:true, data:{ total_users:totalUsers||0, paying_subscribers:paying||0, total_orders:orders||0, total_content_generated:contentItems||0 } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch platform stats.' }); }
});

// GET /admin/revenue
app.get('/admin/revenue', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    // B-04: append-only transactions are the revenue source of truth; subscriptions legacy fallback.
    // D-05: both aggregates were computed from one capped page (1,000 rows) before.
    const [ledger, subsPage] = await Promise.all([
      ledgerTotals(supabase),
      fetchAllRows(() => supabase.from('subscriptions').select('plan,amount_paid,currency').eq('status','active').neq('plan','free')),
    ]);
    if (subsPage.error) throw subsPage.error;
    let byPlan, byCurrency, total, ledgerRows, source;
    if (ledger.rows > 0) {
      ({ byPlan, byCurrency, total, rows:ledgerRows, source } = ledger);
    } else {
      // Pre-ledger deployments: aggregate the active subscriptions instead.
      byPlan = {}; byCurrency = {}; total = 0;
      for (const sub of subsPage.rows) {
        const amount = Number(sub.amount_paid) || 0;
        const cur    = String(sub.currency || 'NGN').toUpperCase();
        byPlan[sub.plan || 'unknown'] = (byPlan[sub.plan || 'unknown'] || 0) + amount;
        byCurrency[cur] = (byCurrency[cur] || 0) + amount;
        total += amount;
      }
      ledgerRows = subsPage.rows.length;
      source = 'paged';
    }
    return res.json({ success:true, data:{ total_revenue:total, total_mrr: ledger.rows > 0 ? undefined : total, by_plan:byPlan, by_currency:byCurrency, mixed_currency:Object.keys(byCurrency).length>1, subscriber_count:subsPage.rows.length, ledger: ledger.rows > 0 ? 'transactions' : 'subscriptions', ledger_rows:ledgerRows, source, truncated:Boolean(ledger.truncated||subsPage.truncated) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch revenue.' }); }
});

// GET /admin/content-moderation
app.get('/admin/content-moderation', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('content_items').select('id,user_id,topic,type,caption,created_at').eq('generation_status','completed').order('created_at',{ ascending:false }).limit(50);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch content.' }); }
});

// POST /admin/global-kb
app.post('/admin/global-kb', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { trigger, response, category, industry='all', language='en' } = req.body;
    if (!trigger||!response) return res.status(400).json({ success:false, error:'Trigger and response are required.' });
    const { data, error } = await supabase.from('global_kb_library').insert({ trigger:trigger.toLowerCase(), response, category, industry, language }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Global keyword added.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to add global keyword.' }); }
});

// PATCH /admin/global-kb/:id
app.patch('/admin/global-kb/:id', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    // S-16: even admin routes use an allow-list.
    const { values, errors } = pickFields(req.body, {
      trigger:  { type:'string', max:200, min:1, lowercase:true },
      response: { type:'string', max:2000, min:1 },
      category: { type:'string', max:60, nullable:true },
      industry: { type:'string', max:60 },
      language: { type:'string', max:10 },
      is_active:{ type:'boolean' },
    });
    if (errors.length) return res.status(400).json({ success:false, error:errors[0] });
    if (!Object.keys(values).length) return res.status(400).json({ success:false, error:'No valid fields to update.' });
    const { data, error } = await supabase.from('global_kb_library').update(values).eq('id',req.params.id).select().single();
    if (error) throw error;
    return res.json({ success:true, data, message:'Global keyword updated.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update keyword.' }); }
});

// POST /admin/test-whatsapp
app.post('/admin/test-whatsapp', authenticate, adminLimiter, requireAdmin, async (req, res) => {
  try {
    const { to, message='Test from ZAPIT admin 🚀' } = req.body;
    if (!to) return res.status(400).json({ success:false, error:'Phone number (to) is required.' });
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) return res.status(500).json({ success:false, error:'Platform WhatsApp not configured' });
    const result = await sendWAMessage({ phoneNumberId: WA_PHONE_NUMBER_ID, accessToken: WA_ACCESS_TOKEN, to, message });
    return res.json({ success:result.success, data:result, message:result.success?'Test message sent!':'Failed.' });
  } catch { return res.status(500).json({ success:false, error:'Test failed.' }); }
});

// POST /admin/test-post
app.post('/admin/test-post', authenticate, adminLimiter, requireAdmin, (_req, res) => {
  return res.json({ success:true, message:'Use POST /content/publish-now with a connected account to test posting.' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 10: WEBHOOKS ────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /webhook/paystack
app.post('/webhook/paystack', webhookLimiter, async (req, res) => {
  try {
    const sig = req.headers['x-paystack-signature'];
    const rawForSig = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '{}'));
    if (!verifyPaystackSig(rawForSig, String(sig))) return res.status(400).json({ success:false, error:'Invalid signature.' });
    let event;
    try { event = JSON.parse(rawForSig.toString('utf8')); } catch { return res.status(400).json({ success:false, error:'Invalid JSON.' }); }
    res.status(200).json({ success:true }); // Respond immediately

    if (event.event === 'charge.success') {
      const { reference } = event.data;
      if (!reference) return;

      // ── Phase 8.2 (W-01): in-chat order payments settle here ──
      // Returns true when the reference belongs to an order (verified on the
      // tenant's own Paystack account), so the subscription path is bypassed.
      try { if (await settleOrderCharge(event)) return; } catch (e) { console.warn('[order webhook]', e.message); }

      // Idempotency: same reference already processed → skip (prevents double grant on retry)
      try {
        const { data: dup } = await supabase.from('subscriptions').select('paystack_reference').eq('paystack_reference', reference).limit(1);
        if (Array.isArray(dup) ? dup.length : dup) { console.log(JSON.stringify({ level:'info', msg:'paystack duplicate reference', reference })); return; }
      } catch {}
      // Also check webhook_events table if exists
      try {
        const { data: ev } = await supabase.from('webhook_events').select('id').eq('provider','paystack').eq('event_id', String(reference)).limit(1);
        if (Array.isArray(ev) ? ev.length : ev) { console.log(JSON.stringify({ level:'info', msg:'paystack duplicate webhook_events', reference })); return; }
        supabase.from('webhook_events').insert({ provider:'paystack', event_id:String(reference), payload:event, received_at:new Date().toISOString() }).then(()=>{});
      } catch {}

      // ── B-04/S-14: the pure decision function authorises the charge ──
      const verify = await verifyPaystack(reference);
      const decision = evaluateCharge({ eventData: event.data, verifyData: verify?.data });
      if (!decision.ok) {
        console.error(JSON.stringify({ level:'error', msg:`paystack charge refused (${decision.reason}) — plan NOT granted`, reference }));
        return;
      }
      const { userId, plan, cycle, currency: paidCur, amountPaid } = decision.grant;

      // Activate FIRST (idempotent upsert) so a retry can never be blocked by the ledger.
      invalidateSubscriptionCache(userId);
      const { error: subErr } = await supabase.from('subscriptions').upsert({
        user_id:userId, plan, billing_cycle:cycle, amount_paid:amountPaid, currency:paidCur,
        paystack_reference:reference, ...activationFields({ cycle }),
      },{ onConflict:'user_id' });
      if (subErr) {
        console.error(JSON.stringify({ level:'error', msg:'subscription activation failed — needs reconciliation', reference, plan, err: subErr.message }));
        return;
      }

      // Immutable ledger (transactions: UNIQUE paystack_reference, append-only). A duplicate
      // here means a previous delivery already recorded it — never an early return.
      try {
        const { error: txErr } = await supabase.from('transactions').insert({
          user_id:userId, paystack_reference:reference, plan, billing_cycle:cycle,
          amount_paid:amountPaid, currency:paidCur, status:'success', created_at:new Date().toISOString(),
        });
        if (txErr && txErr.code === '23505') console.log(JSON.stringify({ level:'info', msg:'paystack transaction already recorded', reference }));
        else if (txErr) console.warn(JSON.stringify({ level:'warn', msg:'transaction ledger insert failed', reference, err: txErr.message }));
      } catch (e) { console.warn(JSON.stringify({ level:'warn', msg:'transaction ledger error', reference, err: e.message })); }

      const { data:user } = await supabase.from('users').select('email,full_name').eq('id',userId).single();
      if (user) {
        await sendEmail({ to:user.email, toName:user.full_name, subject:`🎉 You're on ZAPIT ${plan.charAt(0).toUpperCase()+plan.slice(1)} Plan!`,
          htmlContent:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#6366F1">⚡ ZAPIT</h1><h2>Payment Confirmed! 🎉</h2><p>Hi ${user.full_name||'there'},</p><p>Your payment of <strong>${paidCur} ${amountPaid.toLocaleString()}</strong> was successful.</p><p>You're now on the <strong>${plan.toUpperCase()}</strong> plan.</p><p>Reference: ${reference}</p><a href="${FRONTEND_URL}/dashboard" style="background:#6366F1;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:16px">Go to Dashboard →</a></div>` });
      }
      // Referral reward
      const { data:ref } = await supabase.from('referrals').select('*').eq('referred_id',userId).eq('status','pending').single();
      if (ref) await supabase.from('referrals').update({ referred_upgraded:true, referred_plan:plan, status:'completed' }).eq('id',ref.id);
    }
  } catch (err) { console.error('[PAYSTACK WEBHOOK]', err.message); }
});

// POST /webhook/tiktok
app.post('/webhook/tiktok', webhookLimiter, async (req, res) => {
  res.status(200).json({ success:true });
  try {
    const { event, data } = req.body;
    if (event==='video.publish.complete'&&data?.publish_id) {
      await supabase.from('posts').update({ tiktok_post_id:data.share_id||data.publish_id, tiktok_post_url:data.share_url||null, status:'published', published_at:new Date().toISOString() }).eq('tiktok_post_id',data.publish_id);
    }
  } catch (err) { console.error('[TIKTOK WEBHOOK]', err.message); }
});

// POST /webhook/instagram
app.post('/webhook/instagram', webhookLimiter, (_req, res) => res.status(200).json({ success:true }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 11: SYSTEM & UTILITIES ──────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /
app.get('/', (_req, res) => res.json({ name:'ZAPIT API', version:'3.0.0', tagline:'Your AI Sales Rep + Viral Content Machine', status:'online', timestamp:new Date().toISOString() }));

// GET /health
app.get('/health', async (_req, res) => {
  const services = {
    database: 'checking',
    ai:       HF_API_KEY ? 'configured' : 'fallback mode',
    whatsapp: WA_ACCESS_TOKEN ? 'configured' : 'not configured',
    whatsapp_webhook: WA_SIGNATURE_SECRET ? 'signed' : 'unverified',
    email:    BREVO_API_KEY ? 'configured' : 'not configured',
    payments: PAYSTACK_SECRET_KEY ? 'configured' : 'not configured',
  };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    await supabase.from('users').select('id').limit(1).abortSignal(controller.signal);
    clearTimeout(t);
    services.database = 'online';
  } catch { services.database = 'offline'; }
  return res.json({ status:'ok', version:'3.0.0', timestamp:new Date().toISOString(), services });
});

// GET /status
app.get('/status', async (_req, res) => {
  const checks = { api:'online', database:'checking', ai_text:HF_API_KEY?'configured':'unconfigured', ai_image:REPLICATE_API_KEY?'configured':'unconfigured', whatsapp:WA_ACCESS_TOKEN?'configured':'unconfigured', whatsapp_webhook:WA_SIGNATURE_SECRET?'signed':'unverified', email:BREVO_API_KEY?'configured':'unconfigured', payments:PAYSTACK_SECRET_KEY?'configured':'unconfigured' };
  try { await supabase.from('users').select('id').limit(1); checks.database='online'; } catch { checks.database='offline'; }
  return res.json({ success:true, data:checks });
});

// POST /support/contact
app.post('/support/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!email||!message) return res.status(400).json({ success:false, error:'Email and message are required.' });
    if (!isValidEmail(String(email))) return res.status(400).json({ success:false, error:'Valid email is required.' });
    if (String(message).length > 5000) return res.status(400).json({ success:false, error:'Message too long (max 5000).' });
    await sendEmail({ to:BREVO_SENDER_EMAIL, toName:'ZAPIT Support', subject:`[Support] ${subject||'New inquiry'} — ${name||email}`, htmlContent:`<h2>Support Request</h2><p><strong>From:</strong> ${name||'Anonymous'} (${email})</p><p><strong>Subject:</strong> ${subject||'No subject'}</p><p>${message}</p>` });
    return res.json({ success:true, message:"Message sent! We'll reply within 24 hours." });
  } catch { return res.status(500).json({ success:false, error:'Failed to send message.' }); }
});

// POST /feedback
app.post('/feedback', authenticate, async (req, res) => {
  try {
    const { rating, message, feature } = req.body;
    await sendEmail({ to:BREVO_SENDER_EMAIL, subject:`[Feedback] ⭐${rating}/5 — ${feature||'General'}`, htmlContent:`<h2>Feedback</h2><p><strong>User:</strong> ${req.user.email}</p><p><strong>Rating:</strong> ${rating}/5</p><p><strong>Feature:</strong> ${feature||'General'}</p><p>${message}</p>` });
    return res.json({ success:true, message:'Thank you for your feedback! 🙏' });
  } catch { return res.status(500).json({ success:false, error:'Failed to submit feedback.' }); }
});

// GET /pricing/location  (public)
app.get('/pricing/location', async (req, res) => {
  try {
    const location = await detectLocation(req);
    return res.json({ success:true, data:getPricingForLocation(location) });
  } catch {
    return res.json({ success:true, data:getPricingForLocation({ country_code:'NG', currency:'NGN', timezone:'Africa/Lagos' }) });
  }
});

// ─── 404 & GLOBAL ERROR HANDLER ─────────────────────────────
app.use((req, res) => res.status(404).json({ success:false, error:'Route not found. Check the API documentation.', requestId: req.id }));

app.use((err, req, res, _next) => {
  // CORS errors should be 403, not 500
  if (err && String(err.message).includes('CORS: Origin not allowed')) {
    console.warn(JSON.stringify({ level:'warn', reqId:req.id, msg:'CORS blocked', origin: req.headers.origin, ip:req.ip }));
    return res.status(403).json({ success:false, error:'Origin not allowed by CORS.', requestId: req.id });
  }
  const errId = crypto.randomUUID();
  console.error(JSON.stringify({ level:'error', reqId:req.id || errId, err: err.message, stack: err.stack?.slice(0,2000) }));
  res.status(500).json({ success:false, error:'An unexpected error occurred. Please try again.', requestId: req.id || errId });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── CRON JOBS ───────────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Publish due scheduled posts — every 5 minutes (with distributed lock)
cron.schedule('*/5 * * * *', async () => {
  const { executed } = await withAdvisoryLock(supabase, 'cron:publish-due-posts', async () => {
  try {
    const now            = new Date().toISOString();
    const { data:due }   = await supabase.from('posts').select('*,content_items(*)').eq('status','scheduled').lte('scheduled_for',now).order('scheduled_for',{ascending:true}).limit(20);
    // Also pick failed posts that are due for retry (next_retry_at <= now)
    let retryDue = [];
    try {
      const { data: r } = await supabase.from('posts').select('*,content_items(*)').eq('status','failed').lte('next_retry_at', now).lt('attempts', 3).limit(5);
      if (r?.length) retryDue = r;
    } catch {}
    const allDue = [...(due||[]), ...retryDue];
    if (!allDue?.length) return;
    for (const post of allDue) {
      await supabase.from('posts').update({ status:'posting' }).eq('id',post.id);
      const content = post.content_items;
      if (!content) { await supabase.from('posts').update({ status:'failed', error_log:{ global:'Content item not found' } }).eq('id',post.id); continue; }
      const { results, errors } = await publishContent(post, content);
      const hasErrors = Object.keys(errors).length > 0;
      const nextAttempts = (post.attempts || 0) + 1;
      const updateData = { attempts: nextAttempts, status: hasErrors ? (nextAttempts >= 3 ? 'dead_letter' : 'failed') : 'published', published_at: hasErrors ? null : new Date().toISOString(), next_retry_at: hasErrors && nextAttempts < 3 ? new Date(Date.now() + Math.pow(2, nextAttempts)*60*1000).toISOString() : null, last_error: hasErrors ? errors : null, error_log: hasErrors ? errors : null };
      if (results.instagram) { updateData.instagram_post_id=results.instagram.post_id; updateData.instagram_post_url=results.instagram.post_url; }
      if (results.facebook)  { updateData.facebook_post_id=results.facebook.post_id;   updateData.facebook_post_url=results.facebook.post_url; }
      if (results.tiktok)    { updateData.tiktok_post_id=results.tiktok.post_id;        updateData.tiktok_post_url=results.tiktok.post_url; }
      if (results.youtube)   { updateData.youtube_post_id=results.youtube.post_id;      updateData.youtube_post_url=results.youtube.post_url; }
      await supabase.from('posts').update(updateData).eq('id',post.id);
    }
  } catch (err) { console.error('[CRON publish]', err.message); }
  });
  if (!executed) console.log('[CRON publish] skipped (locked)');
});

// Send due scheduled broadcasts — every 5 minutes (with distributed lock).
// W-03: a broadcast with `scheduled_for` was inserted and NEVER executed, so
// "scheduled" was a promise the product could not keep.
// Cadence is tunable (BROADCAST_CRON) so the scheduler can be verified without
// waiting for a five-minute boundary; the default is every 5 minutes.
cron.schedule(BROADCAST_CRON, async () => {
  const { executed } = await withAdvisoryLock(supabase, 'cron:send-broadcasts', async () => {
    try {
      const nowIso = new Date().toISOString();
      const { data: due } = await supabase.from('broadcasts').select('*')
        .eq('status','scheduled').lte('scheduled_for', nowIso)
        .order('scheduled_for', { ascending:true }).limit(5);
      for (const b of (due || [])) {
        // Lease: only one worker may move a row out of 'scheduled'.
        const { data: claimed } = await supabase.from('broadcasts')
          .update({ status:'sending', started_at:nowIso, updated_at:nowIso })
          .eq('id', b.id).eq('status','scheduled').select();
        if (!claimed?.length) continue;
        const settings  = await loadBroadcastSettings(b.user_id);
        const template  = await loadTenantTemplate(b.user_id, b.template_id);
        const contacts  = await loadBroadcastAudience({ userId:b.user_id, target_segment:b.target_segment });
        if (!contacts.length) {
          await supabase.from('broadcasts').update({
            status:'failed', results:{ summary:'No contacts matched the segment.' },
            completed_at:new Date().toISOString(), updated_at:new Date().toISOString(),
          }).eq('id', b.id);
          continue;
        }
        // Planned at send time: the 24h window is relative to *now*.
        const { results } = await runBroadcast({ broadcast:b, settings, contacts, message:b.message, template });
        console.log(JSON.stringify({ level:'info', msg:'scheduled broadcast sent', id:b.id, userId:b.user_id, ...results }));
      }
    } catch (err) { console.error('[CRON broadcast]', err.message); }
  });
  if (!executed) console.log('[CRON broadcast] skipped (locked)');
});

// Monthly maintenance — 1st of every month at midnight.
// B-09: the old code called .update({reply_count:0}) with NO filter — an
// unscoped write that Supabase silently refuses, so the counter grew forever
// while analytics reported lifetime totals as "this month". Quotas are now
// period-scoped (usage_counters), so there is nothing to reset: this job only
// maintains the legacy display mirror (paged, explicit user_id filter) and
// prunes counters older than 13 months.
cron.schedule('0 0 1 * *', async () => {
  await withAdvisoryLock(supabase, 'cron:monthly-usage', async () => {
    const nowIso = new Date().toISOString();
    const PAGE   = 500;
    let from = 0, updated = 0, pages = 0;
    try {
      while (pages < 40) {
        const { data: rows, error } = await supabase.from('business_settings')
          .select('user_id').not('user_id','is',null)
          .order('user_id', { ascending:true }).range(from, from + PAGE - 1);
        if (error) { console.warn('[CRON monthly] legacy mirror read failed:', error.message); break; }
        if (!rows || !rows.length) break;
        const ids = rows.map(r => r.user_id).filter(Boolean);
        if (ids.length) {
          const { error: upErr } = await supabase.from('business_settings')
            .update({ reply_count:0, last_reply_reset:nowIso }).in('user_id', ids);
          if (upErr) { console.warn('[CRON monthly] legacy mirror write failed:', upErr.message); break; }
          updated += ids.length;
        }
        if (rows.length < PAGE) break;
        from += PAGE; pages++;
      }
      console.log(JSON.stringify({ level:'info', msg:'monthly maintenance complete', legacyRowsReset:updated }));
    } catch (err) { console.error('[CRON monthly]', err.message); }

    try {
      const { data: pruned, error } = await supabase.rpc('prune_usage_counters', { older_than_months:13 });
      if (error) console.warn('[CRON monthly] counter prune skipped:', error.message);
      else console.log(JSON.stringify({ level:'info', msg:'usage counters pruned', rows:pruned }));
    } catch (err) { console.warn('[CRON monthly] counter prune skipped:', err.message); }
  });
  console.log('[CRON] monthly maintenance finished (lock released).');
});

// Expire subscriptions — daily at 2am (with lock)
cron.schedule('0 2 * * *', async () => {
  const { executed } = await withAdvisoryLock(supabase, 'cron:expire-subs', async () => {
  try {
    const { data:expired } = await supabase.from('subscriptions')
      .select('id,user_id,plan')
      .eq('status','active')
      .neq('billing_cycle','free')
      .neq('billing_cycle','admin_override')
      .lt('expires_at', new Date().toISOString());
    if (!expired?.length) return;
    for (const sub of expired) {
      // Downgrade to free
      await supabase.from('subscriptions').update({ status:'expired' }).eq('id',sub.id);
      await supabase.from('subscriptions').insert({ user_id:sub.user_id, plan:'free', status:'active', billing_cycle:'free', amount_paid:0 });
      // Notify user
      const { data:user } = await supabase.from('users').select('email,full_name').eq('id',sub.user_id).single();
      if (user) {
        try {
          await sendEmail({ to:user.email, toName:user.full_name, subject:'Your ZAPIT subscription has expired', htmlContent:`<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#6366F1">⚡ ZAPIT</h1><h2>Subscription Expired</h2><p>Hi ${user.full_name||'there'},</p><p>Your ${sub.plan} plan has expired. Your account has been moved to the Free plan.</p><p>Renew now to restore all your features!</p><a href="${FRONTEND_URL}/pricing" style="background:#6366F1;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:16px">Renew Subscription →</a></div>` });
        } catch (e) { console.warn('[expiry notify skip]', e.message); }
      }
    }
    console.log(`[CRON] Expired ${expired.length} subscription(s).`);
  } catch (err) { console.error('[CRON expire subs]', err.message); }
  });
  if (!executed) console.log('[CRON expire] skipped (locked)');
});

// Process content calendar automations — every hour (with lock)
cron.schedule('0 * * * *', async () => {
  const { executed } = await withAdvisoryLock(supabase, 'cron:calendar', async () => {
  try {
    const now = new Date();
    const { data:automations } = await supabase.from('content_calendar').select('*').eq('is_active',true).lte('next_generation_at', now.toISOString());
    if (!automations?.length) return;
    for (const auto of automations) {
      try {
        const topic  = auto.topics?.length ? auto.topics[Math.floor(Math.random()*auto.topics.length)] : 'Business tips';
        const result = await generateCaptionSafe({ topic, platform:auto.platforms?.[0]||'instagram', tone:auto.tone||'professional', language:auto.language||'en' });
        const { data:item } = await supabase.from('content_items').insert({ user_id:auto.user_id, type:auto.content_type||'image', topic, caption:result.caption, hashtags:result.hashtags, generation_status:'completed' }).select().single();
        if (item) {
          const postAt = new Date(); postAt.setMinutes(0,0,0);
          await supabase.from('posts').insert({ user_id:auto.user_id, content_id:item.id, platforms:auto.platforms, scheduled_for:postAt.toISOString(), timezone:auto.timezone||'Africa/Lagos', status:'scheduled' });
        }
        // Calculate next generation time based on frequency
        const next = new Date(now);
        if (auto.frequency==='daily')       next.setDate(next.getDate()+1);
        else if (auto.frequency==='3x_week') next.setDate(next.getDate()+2);
        else if (auto.frequency==='weekly')  next.setDate(next.getDate()+7);
        else next.setDate(next.getDate()+1);
        await supabase.from('content_calendar').update({ last_generated_at:now.toISOString(), next_generation_at:next.toISOString() }).eq('id',auto.id);
      } catch (e) { console.error(`[CRON calendar] automation ${auto.id}:`, e.message); }
    }
  } catch (err) { console.error('[CRON calendar]', err.message); }
  });
  if (!executed) console.log('[CRON calendar] skipped (locked)');
});

// ─── START SERVER ────────────────────────────────────────────
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`\n⚡ ZAPIT Backend v3.0.0 running on port ${PORT}`);
  console.log(`   Environment: ${NODE_ENV}`);
  console.log(`   Frontend:    ${FRONTEND_URL}`);
  console.log(`   Health:      http://0.0.0.0:${PORT}/health`);
  console.log(`\n   Services:`);
  console.log(`   ✅ Database:  ${SUPABASE_URL ? 'configured' : '⚠️  not configured'}`);
  console.log(`   ✅ AI:        ${HF_API_KEY ? 'Hugging Face' : OPENAI_API_KEY ? 'OpenAI (fallback)' : '⚠️  template mode'}`);
  console.log(`   ✅ WhatsApp:  ${WA_ACCESS_TOKEN ? 'configured' : '⚠️  mock mode'}`);
  console.log(`   ✅ Email:     ${BREVO_API_KEY ? 'Brevo' : '⚠️  console mock'}`);
  console.log(`   ✅ Payments:  ${PAYSTACK_SECRET_KEY ? 'Paystack' : '⚠️  not configured'}`);
  if (NODE_ENV === 'production') {
    // S-05 fail-closed guardrails — surfaced loudly at boot, not silently at runtime
    if (!WA_SIGNATURE_SECRET) console.error('   ⛔ WA_APP_SECRET / META_APP_SECRET missing — POST /webhook/whatsapp will reject with 503');
    if (!WA_VERIFY_TOKEN || WA_VERIFY_TOKEN === 'zapit_webhook_secret_2024') console.error('   ⛔ WA_VERIFY_TOKEN is default/empty — set a strong unique value for the Meta handshake');
  }
  console.log(`\n🚀 Africa's #1 WhatsApp + Content Automation Platform is live!\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM received. Shutting down gracefully...'); server.close(() => { console.log('Server closed.'); process.exit(0); }); });
process.on('SIGINT',  () => { console.log('SIGINT received. Shutting down gracefully...');  server.close(() => { console.log('Server closed.'); process.exit(0); }); });
process.on('uncaughtException',  err => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));

export default app;
