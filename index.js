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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const execAsync  = promisify(exec);

// ─── ENV ────────────────────────────────────────────────────────
const {
  PORT                = 3000,
  NODE_ENV            = 'development',
  BACKEND_URL         = 'http://localhost:3000',
  FRONTEND_URL        = 'http://localhost:5500',
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  JWT_SECRET          = 'zapit-secret-change-me',
  JWT_REFRESH_SECRET  = 'zapit-refresh-change-me',
  WA_ACCESS_TOKEN,
  WA_PHONE_NUMBER_ID,
  WA_VERIFY_TOKEN     = 'zapit_webhook_secret_2024',
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
  BREVO_SENDER_EMAIL  = 'noreply@zapit.app',
  ADMIN_SECRET,
  ADMIN_USERNAMES     = 'admin',
  UNSPLASH_ACCESS_KEY,
  ENCRYPTION_KEY      = 'zapit-32-char-encryption-key-1234',
} = process.env;

// ─── SUPABASE ────────────────────────────────────────────────────
const supabase = createClient(
  SUPABASE_URL        || 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_KEY || 'placeholder-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── PLAN LIMITS ────────────────────────────────────────────────
const PLAN_LIMITS = {
  free: {
    whatsapp_replies: 100, whatsapp_broadcasts: 0, whatsapp_contacts: 100,
    products_limit: 5, knowledge_base_limit: 20,
    video_generations: 3, image_generations: 5, text_posts: 10,
    scheduled_posts_limit: 10, schedule_days_ahead: 7, max_social_platforms: 2,
    ai_video_enabled: false, ai_image_enabled: true, analytics_enabled: false,
    brand_voice_enabled: false, excel_import_enabled: false,
    priority_support: false, remove_watermark: false, white_label: false,
    price: { NGN: 0, GHS: 0, KES: 0, ZAR: 0, USD: 0 },
  },
  creator: {
    whatsapp_replies: 1000, whatsapp_broadcasts: 200, whatsapp_contacts: 1000,
    products_limit: 30, knowledge_base_limit: 100,
    video_generations: 30, image_generations: 60, text_posts: 100,
    scheduled_posts_limit: 50, schedule_days_ahead: 15, max_social_platforms: 4,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: false,
    priority_support: false, remove_watermark: true, white_label: false,
    price: { NGN: 10000, GHS: 150, KES: 1500, ZAR: 220, USD: 12 },
  },
  growth: {
    whatsapp_replies: 5000, whatsapp_broadcasts: 1000, whatsapp_contacts: 5000,
    products_limit: 150, knowledge_base_limit: 500,
    video_generations: 100, image_generations: 200, text_posts: 300,
    scheduled_posts_limit: 150, schedule_days_ahead: 30, max_social_platforms: 6,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: true,
    priority_support: true, remove_watermark: true, white_label: false,
    price: { NGN: 25000, GHS: 375, KES: 3750, ZAR: 550, USD: 30 },
  },
  agency: {
    whatsapp_replies: 99999, whatsapp_broadcasts: 9999, whatsapp_contacts: 99999,
    products_limit: 9999, knowledge_base_limit: 9999,
    video_generations: 500, image_generations: 1000, text_posts: 1000,
    scheduled_posts_limit: 500, schedule_days_ahead: 30, max_social_platforms: 7,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: true,
    priority_support: true, remove_watermark: true, white_label: true,
    price: { NGN: 50000, GHS: 750, KES: 7500, ZAR: 1100, USD: 60 },
  },
};

// ─── EXPRESS SETUP ──────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5500',
      'http://127.0.0.1:5500', 'https://zapit.app', 'https://www.zapit.app',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin) || NODE_ENV === 'development') return cb(null, true);
    cb(null, true); // open in prod; tighten as needed
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-secret'],
}));

// Raw body for Paystack signature verification — MUST come before express.json()
app.use('/webhook/paystack', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'image/jpeg','image/png','image/webp','video/mp4',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    cb(null, ok.includes(file.mimetype));
  },
});

// ─── RATE LIMITERS ──────────────────────────────────────────────
const makeLimit = (windowMs, max, message) =>
  rateLimit({ windowMs, max, message: { success: false, error: message }, standardHeaders: true, legacyHeaders: false });

const globalLimiter  = makeLimit(15 * 60 * 1000, 300,  'Too many requests. Please slow down.');
const authLimiter    = makeLimit(15 * 60 * 1000, 20,   'Too many auth attempts. Wait 15 minutes.');
const otpLimiter     = makeLimit(60 * 1000,       3,    'Too many OTP requests. Wait a minute.');
const webhookLimiter = makeLimit(60 * 1000,       200,  'Webhook rate limit exceeded.');
const contentLimiter = makeLimit(60 * 60 * 1000,  50,   'AI generation limit reached for this hour.');

app.use(globalLimiter);

// ─── ENCRYPTION ─────────────────────────────────────────────────
const CIPHER_KEY = crypto.scryptSync(ENCRYPTION_KEY, 'zapit-salt-v3', 32);

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

function generateOTP()         { return Math.floor(100000 + Math.random() * 900000).toString(); }
function generateReferralCode() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }
function generateOrderNumber()  { return `ZAP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
function sleep(ms)              { return new Promise(r => setTimeout(r, ms)); }

// ─── JWT ────────────────────────────────────────────────────────
function generateTokens(userId, username) {
  const accessToken  = jwt.sign({ sub: userId, username, type: 'access' },  JWT_SECRET,         { expiresIn: '7d'  });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh' },            JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

// ─── MIDDLEWARE: AUTH ────────────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ success: false, error: 'No token provided. Please log in.' });

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!session)
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });

    const { data: user } = await supabase
      .from('users')
      .select('id, email, username, full_name, country_code, currency, is_active, is_suspended')
      .eq('id', decoded.sub)
      .single();

    if (!user || !user.is_active || user.is_suspended)
      return res.status(403).json({ success: false, error: 'Account suspended or deactivated.' });

    req.user  = user;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success: false, error: 'Token expired. Please refresh your session.' });
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

// ─── MIDDLEWARE: ADMIN ───────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const adminList = ADMIN_USERNAMES.split(',').map(u => u.trim());
  if (req.headers['x-admin-secret'] === ADMIN_SECRET) return next();
  if (req.user && adminList.includes(req.user.username))  return next();
  return res.status(403).json({ success: false, error: 'Admin access required.' });
}

// ─── HELPERS ────────────────────────────────────────────────────
async function getUserSubscription(userId) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  const plan = data?.plan || 'free';
  return { subscription: data, plan, limits: PLAN_LIMITS[plan] || PLAN_LIMITS.free };
}

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
const CURRENCY_SYMBOLS = { NGN:'₦', GHS:'GH₵', KES:'KSh', ZAR:'R', USD:'$', GBP:'£', EUR:'€' };

async function detectLocation(req) {
  const raw = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const ip  = raw.replace('::ffff:', '');
  const isLocal = !ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.');
  if (isLocal) return { country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' };
  try {
    const r    = await fetch(`https://ipapi.co/${ip}/json/`, { headers: { 'User-Agent':'zapit-backend/3.0' } });
    const data = await r.json();
    const currency = COUNTRY_CURRENCY[data.country_code] || 'USD';
    return { country_code: data.country_code || 'NG', country_name: data.country_name || 'Nigeria', city: data.city || 'Lagos', currency, timezone: data.timezone || 'Africa/Lagos' };
  } catch {
    return { country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' };
  }
}

function formatPrice(amount, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  return `${sym}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)}`;
}

function getPricingForLocation(location) {
  const { currency } = location;
  const plans = {};
  for (const [name, data] of Object.entries(PLAN_LIMITS)) {
    const raw = data.price[currency] ?? data.price.USD;
    plans[name] = {
      name, ...data,
      price_raw:             raw,
      price_formatted:       formatPrice(raw, currency),
      price_annual:          Math.round(raw * 12 * 0.80),
      price_annual_formatted: formatPrice(raw * 12 * 0.80, currency),
      currency,
      currency_symbol: CURRENCY_SYMBOLS[currency] || currency,
    };
  }
  return { location, plans, annual_discount: 0.20 };
}

// ─── PAYSTACK ───────────────────────────────────────────────────
async function initializePaystack({ email, amount, currency = 'NGN', metadata, callback_url }) {
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: Math.round(amount * 100), currency, metadata, callback_url: callback_url || `${FRONTEND_URL}/payment-success` }),
  });
  return res.json();
}

async function verifyPaystack(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  return res.json();
}

function verifyPaystackSig(rawBody, sig) {
  if (!PAYSTACK_SECRET_KEY) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
    .digest('hex');
  return hash === sig;
}

// ─── WHATSAPP HELPERS ───────────────────────────────────────────
async function sendWAMessage({ phoneNumberId, accessToken, to, message }) {
  const token   = accessToken || WA_ACCESS_TOKEN;
  const numberId = phoneNumberId || WA_PHONE_NUMBER_ID;
  if (!token || !numberId) {
    console.log(`[WA MOCK] To:${to} | ${message?.substring(0, 80)}`);
    return { success: true, mock: true };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${numberId}/messages`, {
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
  const token   = accessToken || WA_ACCESS_TOKEN;
  const numberId = phoneNumberId || WA_PHONE_NUMBER_ID;
  if (!token || !numberId) return;
  await fetch(`https://graph.facebook.com/v19.0/${numberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {});
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
    const outputPath = `/tmp/video_${Date.now()}.mp4`;
    const safeCaption = (caption || topic).replace(/'/g, '').replace(/\n/g, ' ').substring(0, 80);
    const cmd = `ffmpeg -y -loop 1 -i "${imgUrl}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.001,1.3)':d=${duration * 25}:s=1080x1920,drawtext=text='${safeCaption}':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.6:boxborderw=8" -t ${duration} -c:v libx264 -pix_fmt yuv420p -r 25 "${outputPath}" 2>/dev/null`;
    await execAsync(cmd, { timeout: 60000 });
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
    } else {
      const r = await fetch(sourceUrlOrPath);
      if (!r.ok) return sourceUrlOrPath;
      fileBuffer  = Buffer.from(await r.arrayBuffer());
      contentType = r.headers.get('content-type') || (type === 'video' ? 'video/mp4' : 'image/jpeg');
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

  await supabase.from('ai_logs').insert({
    user_id: businessUserId, customer_message: customerMessage, customer_phone: customerPhone,
    ai_response: aiResponse.trim(), ai_model: HF_API_KEY ? 'qwen2.5-72b' : 'gpt-4o-mini',
    ai_confidence: 0.85, conversation_id: conversationId,
  }).catch(() => {});

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
    if (!email || !username || !password)
      return res.status(400).json({ success:false, error:'Email, username and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ success:false, error:'Password must be at least 8 characters.' });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ success:false, error:'Username must be 3-30 characters: letters, numbers, underscores only.' });

    const { data: existEmail } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (existEmail) return res.status(409).json({ success:false, error:'An account with this email already exists.' });

    const { data: existUser } = await supabase.from('users').select('id').eq('username', username.toLowerCase()).single();
    if (existUser) return res.status(409).json({ success:false, error:'This username is already taken.' });

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
      country_code:  country_code || location.country_code,
      currency:      location.currency,
      timezone:      location.timezone,
      email_verified: false,
      is_active:     true,
      is_suspended:  false,
    }).select().single();
    if (uErr) throw uErr;

    await supabase.from('subscriptions').insert({ user_id:user.id, plan:'free', status:'active', billing_cycle:'free', amount_paid:0, currency:location.currency });

    if (referrerId) {
      await supabase.from('referrals').insert({ referrer_id:referrerId, referred_id:user.id, referred_signed_up:true, status:'pending' }).catch(() => {});
    }

    const otp = generateOTP();
    await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:otp, type:'email_verify', expires_at:new Date(Date.now() + 10*60*1000).toISOString() });
    await sendOTPEmail(email.toLowerCase(), otp, 'verify');

    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    await supabase.from('sessions').insert({ user_id:user.id, token:accessToken, refresh_token:refreshToken, expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString(), ip_address:req.ip, user_agent:req.headers['user-agent'] });

    return res.status(201).json({
      success: true,
      message: 'Account created! Check your email for a verification code.',
      data: {
        user: { id:user.id, email:user.email, username:user.username, full_name:user.full_name, email_verified:false },
        access_token:  accessToken,
        refresh_token: refreshToken,
        expires_in:    604800,
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

    const { data: user } = await supabase.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ success:false, error:'Invalid email or password.' });
    if (user.is_suspended)  return res.status(403).json({ success:false, error:`Account suspended: ${user.suspension_reason || 'Contact support.'}` });
    if (!user.is_active)    return res.status(403).json({ success:false, error:'Account deactivated. Contact support.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success:false, error:'Invalid email or password.' });

    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    await supabase.from('sessions').insert({ user_id:user.id, token:accessToken, refresh_token:refreshToken, expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString(), ip_address:req.ip, user_agent:req.headers['user-agent'] });
    await supabase.from('users').update({ last_login:new Date().toISOString() }).eq('id', user.id);

    const { plan } = await getUserSubscription(user.id);
    return res.json({
      success: true,
      data: {
        user: { id:user.id, email:user.email, username:user.username, full_name:user.full_name, avatar_url:user.avatar_url, country_code:user.country_code, currency:user.currency, email_verified:user.email_verified, plan },
        access_token:  accessToken,
        refresh_token: refreshToken,
        expires_in:    604800,
      },
    });
  } catch (err) {
    console.error('[LOGIN]', err);
    return res.status(500).json({ success:false, error:'Login failed. Please try again.' });
  }
});

// POST /auth/logout
app.post('/auth/logout', authenticate, async (req, res) => {
  await supabase.from('sessions').delete().eq('token', req.token).catch(() => {});
  return res.json({ success:true, message:'Logged out successfully.' });
});

// POST /auth/logout-all
app.post('/auth/logout-all', authenticate, async (req, res) => {
  await supabase.from('sessions').delete().eq('user_id', req.user.id).catch(() => {});
  return res.json({ success:true, message:'All sessions terminated.' });
});

// POST /auth/verify-email
app.post('/auth/verify-email', otpLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success:false, error:'Email and code are required.' });

    const { data: otp } = await supabase.from('otp_verifications').select('*')
      .eq('email', email.toLowerCase()).eq('code', code).eq('type','email_verify').eq('verified',false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending:false }).limit(1).single();

    if (!otp) return res.status(400).json({ success:false, error:'Invalid or expired code. Please request a new one.' });

    await supabase.from('otp_verifications').update({ verified:true }).eq('id', otp.id);
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
    await supabase.from('otp_verifications').update({ verified:true }).eq('email', email.toLowerCase()).eq('type', type).eq('verified',false);
    const otp = generateOTP();
    await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:otp, type, expires_at:new Date(Date.now()+10*60*1000).toISOString() });
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
    const { data: user } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (user) {
      const otp = generateOTP();
      await supabase.from('otp_verifications').insert({ email:email.toLowerCase(), code:otp, type:'password_reset', expires_at:new Date(Date.now()+10*60*1000).toISOString() });
      await sendOTPEmail(email.toLowerCase(), otp, 'reset');
    }
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
    if (new_password.length < 8) return res.status(400).json({ success:false, error:'Password must be at least 8 characters.' });

    const { data: otp } = await supabase.from('otp_verifications').select('*')
      .eq('email', email.toLowerCase()).eq('code', code).eq('type','password_reset').eq('verified',false)
      .gt('expires_at', new Date().toISOString()).single();
    if (!otp) return res.status(400).json({ success:false, error:'Invalid or expired reset code.' });

    const password_hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash, updated_at:new Date().toISOString() }).eq('email', email.toLowerCase());
    await supabase.from('otp_verifications').update({ verified:true }).eq('id', otp.id);
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

// PATCH /auth/update-profile
app.patch('/auth/update-profile', authenticate, async (req, res) => {
  try {
    const allowed = ['full_name','phone','whatsapp_number','timezone','language','avatar_url'];
    const updates = { updated_at:new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select().single();
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
    if (new_password.length < 8) return res.status(400).json({ success:false, error:'New password must be at least 8 characters.' });
    const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();
    if (!(await bcrypt.compare(old_password, user.password_hash))) return res.status(401).json({ success:false, error:'Current password is incorrect.' });
    await supabase.from('users').update({ password_hash:await bcrypt.hash(new_password, 12), updated_at:new Date().toISOString() }).eq('id', req.user.id);
    await supabase.from('sessions').delete().eq('user_id', req.user.id).neq('token', req.token);
    return res.json({ success:true, message:'Password changed successfully.' });
  } catch {
    return res.status(500).json({ success:false, error:'Failed to change password.' });
  }
});

// POST /auth/refresh-token
app.post('/auth/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ success:false, error:'Refresh token is required.' });
    const decoded = jwt.verify(refresh_token, JWT_REFRESH_SECRET);
    const { data: session } = await supabase.from('sessions').select('*').eq('refresh_token', refresh_token).single();
    if (!session) return res.status(401).json({ success:false, error:'Invalid refresh token.' });
    const { data: user } = await supabase.from('users').select('id,username,is_active,is_suspended').eq('id', decoded.sub).single();
    if (!user || !user.is_active || user.is_suspended) return res.status(403).json({ success:false, error:'Account not available.' });
    const { accessToken, refreshToken:newRT } = generateTokens(user.id, user.username);
    await supabase.from('sessions').update({ token:accessToken, refresh_token:newRT, expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString() }).eq('id', session.id);
    return res.json({ success:true, data:{ access_token:accessToken, refresh_token:newRT, expires_in:604800 } });
  } catch {
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
    if (!business_name) return res.status(400).json({ success:false, error:'Business name is required.' });
    const payload = { user_id:req.user.id, business_name, business_category:business_category||'General', business_description, language_preference:language_preference||'en', bot_personality:bot_personality||'professional', updated_at:new Date().toISOString() };
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
      updates.wa_phone_number_id  = WA_PHONE_NUMBER_ID;
      updates.wa_access_token     = encrypt(WA_ACCESS_TOKEN || '');
    }
    const { data:existing } = await supabase.from('business_settings').select('id').eq('user_id', req.user.id).single();
    if (existing) await supabase.from('business_settings').update(updates).eq('user_id', req.user.id);
    else await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id, business_name:'My Business' });
    return res.json({ success:true, message: connection_method==='shared' ? `Connected! Shared number: ${SHARED_WA_NUMBER}` : 'Your WhatsApp Business number is now connected.', data:{ connection_method, shared_number: connection_method==='shared'?SHARED_WA_NUMBER:null } });
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
    if (tpl.sample_products?.length)    await supabase.from('products').insert(tpl.sample_products.map(p => ({ ...p, user_id:req.user.id }))).catch(() => {});
    if (tpl.sample_kb_entries?.length)  await supabase.from('knowledge_base').insert(tpl.sample_kb_entries.map(e => ({ ...e, user_id:req.user.id }))).catch(() => {});
    if (tpl.sample_settings)            await supabase.from('business_settings').upsert({ user_id:req.user.id, business_name:'My Business', ...tpl.sample_settings }).catch(() => {});
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
      await sendWAMessage({
        phoneNumberId: settings.wa_phone_number_id, accessToken:decrypt(settings.wa_access_token),
        to:user.whatsapp_number,
        message:`🎉 Congratulations! Your ZAPIT bot is now LIVE for ${settings.business_name}. Your AI sales rep is ready to handle customers 24/7. Sleep well! 😴`,
      }).catch(() => {});
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
    const { data:existing } = await supabase.from('business_settings').select('id').eq('user_id', req.user.id).single();
    if (existing) await supabase.from('business_settings').update(updates).eq('user_id', req.user.id);
    else await supabase.from('business_settings').insert({ ...updates, user_id:req.user.id });
    return res.json({ success:true, message:'Settings updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update settings.' }); }
});

// POST /whatsapp/test-connection
app.post('/whatsapp/test-connection', authenticate, async (req, res) => {
  try {
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id', req.user.id).single();
    const { data:user }     = await supabase.from('users').select('whatsapp_number,phone').eq('id', req.user.id).single();
    const to = req.body.phone || user?.whatsapp_number || user?.phone;
    if (!to) return res.status(400).json({ success:false, error:'Please provide a phone number to test.' });
    const result = await sendWAMessage({ phoneNumberId:settings?.wa_phone_number_id||WA_PHONE_NUMBER_ID, accessToken:settings?.wa_access_token?decrypt(settings.wa_access_token):WA_ACCESS_TOKEN, to, message:`✅ WhatsApp connection test successful!\n\nYour ZAPIT bot for *${settings?.business_name||'your business'}* is live! 🚀` });
    return result.success
      ? res.json({ success:true, message:'Test message sent! Check your WhatsApp.' })
      : res.status(400).json({ success:false, error:'Failed to send test message. Check your credentials.' });
  } catch { return res.status(500).json({ success:false, error:'Connection test failed.' }); }
});

// GET /whatsapp/qr-code
app.get('/whatsapp/qr-code', authenticate, (_req, res) => {
  return res.json({ success:true, data:{ shared_number:SHARED_WA_NUMBER, message:'Use this shared number with your customers. No Meta account needed on Free plan.', instructions:['1. Share this number with your customers','2. The AI bot responds instantly on your behalf','3. Upgrade for your own dedicated WhatsApp number'] } });
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
    const { name, description, price, sale_price, currency='NGN', type='physical', stock_quantity, category, image_url } = req.body;
    if (!name || price === undefined) return res.status(400).json({ success:false, error:'Product name and price are required.' });
    const { limits } = await getUserSubscription(req.user.id);
    const { count }  = await supabase.from('products').select('id',{ count:'exact', head:true }).eq('user_id', req.user.id);
    if ((count||0) >= limits.products_limit) return res.status(403).json({ success:false, error:`Product limit (${limits.products_limit}) reached. Upgrade to add more.` });
    const { data, error } = await supabase.from('products').insert({ user_id:req.user.id, name, description, price:Number(price), sale_price:sale_price?Number(sale_price):null, currency, type, stock_quantity:stock_quantity?Number(stock_quantity):null, category, image_url }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Product added!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to add product.' }); }
});

// PATCH /whatsapp/products/:id
app.patch('/whatsapp/products/:id', authenticate, async (req, res) => {
  try {
    const { data:existing } = await supabase.from('products').select('id').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!existing) return res.status(404).json({ success:false, error:'Product not found.' });
    const updates = { ...req.body, updated_at:new Date().toISOString() };
    delete updates.id; delete updates.user_id;
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
    const { page=1, limit=20, status, payment_status, search } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    let q = supabase.from('orders').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+Number(limit)-1).order('created_at',{ ascending:false });
    if (status)         q = q.eq('status',status);
    if (payment_status) q = q.eq('payment_status',payment_status);
    if (search)         q = q.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%`);
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
    const updates = { ...req.body, updated_at:new Date().toISOString() };
    delete updates.id; delete updates.user_id;
    const { data, error } = await supabase.from('orders').update(updates).eq('id',req.params.id).select().single();
    if (error) throw error;
    if (req.body.status && req.body.status !== existing.status && existing.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      let msg = '';
      if (req.body.status==='confirmed')              msg = `✅ Order ${existing.order_number} confirmed! We're processing it now.`;
      if (req.body.delivery_status==='shipped')       msg = `🚚 Order ${existing.order_number} is on its way!`;
      if (req.body.delivery_status==='delivered')     msg = `🎉 Order ${existing.order_number} delivered! Thank you for shopping with us.`;
      if (msg && s) await sendWAMessage({ phoneNumberId:s.wa_phone_number_id, accessToken:decrypt(s.wa_access_token), to:existing.customer_whatsapp, message:msg }).catch(() => {});
    }
    return res.json({ success:true, data, message:'Order updated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update order.' }); }
});

// POST /whatsapp/orders/:id/confirm-payment
app.post('/whatsapp/orders/:id/confirm-payment', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    await supabase.from('orders').update({ payment_status:'paid', paid_at:new Date().toISOString(), status:'confirmed', updated_at:new Date().toISOString() }).eq('id',req.params.id);
    if (order.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      const msg = s?.payment_received_message || `✅ Payment confirmed for order ${order.order_number}! Thank you 🙏 We're processing your order now.`;
      if (s) await sendWAMessage({ phoneNumberId:s.wa_phone_number_id, accessToken:decrypt(s.wa_access_token), to:order.customer_whatsapp, message:msg }).catch(() => {});
    }
    return res.json({ success:true, message:'Payment confirmed and customer notified!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to confirm payment.' }); }
});

// POST /whatsapp/orders/:id/cancel
app.post('/whatsapp/orders/:id/cancel', authenticate, async (req, res) => {
  try {
    const { data:order } = await supabase.from('orders').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!order) return res.status(404).json({ success:false, error:'Order not found.' });
    await supabase.from('orders').update({ status:'cancelled', updated_at:new Date().toISOString() }).eq('id',req.params.id);
    if (order.customer_whatsapp) {
      const { data:s } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
      if (s) await sendWAMessage({ phoneNumberId:s.wa_phone_number_id, accessToken:decrypt(s.wa_access_token), to:order.customer_whatsapp, message:`We're sorry — order ${order.order_number} has been cancelled. ${req.body.reason||'Please contact us if you have questions.'}` }).catch(() => {});
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
    const { page=1, limit=20, search, segment } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    let q = supabase.from('contacts').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+Number(limit)-1).order('last_message_date',{ ascending:false });
    if (search)  q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    if (segment) q = q.eq('segment',segment);
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page:Number(page), limit:Number(limit) } });
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
    const updates = { ...req.body, updated_at:new Date().toISOString() };
    delete updates.id; delete updates.user_id;
    await supabase.from('contacts').update(updates).eq('id',req.params.id).eq('user_id',req.user.id);
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
    const updates = { ...req.body, updated_at:new Date().toISOString() };
    delete updates.id; delete updates.user_id;
    if (updates.trigger) updates.trigger = updates.trigger.toLowerCase().trim();
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

// GET /whatsapp/broadcasts
app.get('/whatsapp/broadcasts', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('broadcasts').select('*').eq('user_id',req.user.id).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch broadcasts.' }); }
});

// POST /whatsapp/broadcasts
app.post('/whatsapp/broadcasts', authenticate, async (req, res) => {
  try {
    const { name, message, target_segment='all', scheduled_for } = req.body;
    if (!name||!message) return res.status(400).json({ success:false, error:'Name and message are required.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (limits.whatsapp_broadcasts === 0) return res.status(403).json({ success:false, error:'Broadcasts require Creator plan or above.' });
    const { data:settings } = await supabase.from('business_settings').select('*').eq('user_id',req.user.id).single();
    let cq = supabase.from('contacts').select('phone,name').eq('user_id',req.user.id).eq('opted_out',false).eq('is_blocked',false);
    if (target_segment!=='all') cq = cq.eq('segment',target_segment);
    const { data:contacts } = await cq;
    if (!contacts?.length) return res.status(400).json({ success:false, error:'No contacts to send to.' });
    const { data:broadcast, error:bErr } = await supabase.from('broadcasts').insert({ user_id:req.user.id, name, message, target_segment, scheduled_for:scheduled_for||new Date().toISOString(), status:scheduled_for?'scheduled':'sending', total_recipients:contacts.length }).select().single();
    if (bErr) throw bErr;
    if (!scheduled_for) {
      let sentCount=0;
      for (const c of contacts) {
        const r = await sendWAMessage({ phoneNumberId:settings?.wa_phone_number_id||WA_PHONE_NUMBER_ID, accessToken:settings?.wa_access_token?decrypt(settings.wa_access_token):WA_ACCESS_TOKEN, to:c.phone, message:message.replace('{name}',c.name||'there') });
        if (r.success) sentCount++;
        await sleep(120); // ~8 msg/sec rate limit
      }
      await supabase.from('broadcasts').update({ status:'sent', sent_count:sentCount, completed_at:new Date().toISOString() }).eq('id',broadcast.id);
    }
    return res.status(201).json({ success:true, data:broadcast, message:scheduled_for?'Broadcast scheduled!': `Sent to ${contacts.length} contacts!` });
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
    const result = await sendWAMessage({ phoneNumberId:settings?.wa_phone_number_id||WA_PHONE_NUMBER_ID, accessToken:settings?.wa_access_token?decrypt(settings.wa_access_token):WA_ACCESS_TOKEN, to:conv.contacts?.phone, message });
    if (result.success) {
      await supabase.from('messages').insert({ conversation_id:req.params.id, direction:'outbound', type:'text', content:message, status:'sent' });
      await supabase.from('conversations').update({ last_message_at:new Date().toISOString() }).eq('id',req.params.id);
    }
    return res.json({ success:result.success, message:result.success?'Reply sent!':'Failed to send reply.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to send reply.' }); }
});

// ─── WHATSAPP WEBHOOKS ─────────────────────────────────────────

// GET /webhook/whatsapp  — Meta verification
app.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('[WA WEBHOOK] Verified!');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

// POST /webhook/whatsapp  — Incoming messages
app.post('/webhook/whatsapp', webhookLimiter, async (req, res) => {
  res.status(200).json({ success:true }); // Respond immediately to Meta

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return;
    const value   = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) return;

    const message      = value.messages[0];
    const contact      = value.contacts?.[0];
    const phoneNumberId = value.metadata?.phone_number_id;
    const from         = message.from;
    const customerName = contact?.profile?.name || 'Customer';
    const msgId        = message.id;
    const msgType      = message.type;

    let msgText = '';
    if      (msgType==='text')        msgText = message.text?.body||'';
    else if (msgType==='interactive') msgText = message.interactive?.button_reply?.title||message.interactive?.list_reply?.title||'';
    else if (['image','video','document','audio'].includes(msgType)) msgText = message[msgType]?.caption||`[${msgType} received]`;
    if (!msgText) return;

    // Find business by WhatsApp phone number ID
    const { data:settings } = await supabase.from('business_settings')
      .select('*').eq('wa_phone_number_id', phoneNumberId).eq('auto_reply',true).single()
      .catch(() => ({ data:null }));

    // If no individual business, try shared connection
    let businessSettings = settings;
    if (!businessSettings) {
      const { data:shared } = await supabase.from('business_settings')
        .select('*').eq('connection_method','shared').eq('auto_reply',true).limit(1);
      if (shared?.length) businessSettings = shared[0];
    }
    if (!businessSettings) return;
    const businessUserId = businessSettings.user_id;

    // Upsert contact
    let { data:contactRecord } = await supabase.from('contacts')
      .select('*').eq('user_id',businessUserId).eq('phone',from).single().catch(() => ({ data:null }));
    if (!contactRecord) {
      const { data:nc } = await supabase.from('contacts').insert({ user_id:businessUserId, name:customerName, phone:from, whatsapp_id:from, first_message_date:new Date().toISOString(), last_message_date:new Date().toISOString(), message_count:1, segment:'lead' }).select().single().catch(() => ({ data:null }));
      contactRecord = nc;
    } else {
      await supabase.from('contacts').update({ last_message_date:new Date().toISOString(), message_count:(contactRecord.message_count||0)+1, name:contactRecord.name||customerName }).eq('id',contactRecord.id).catch(() => {});
    }
    if (!contactRecord || contactRecord.is_blocked || contactRecord.opted_out) return;

    // Upsert conversation
    let { data:conv } = await supabase.from('conversations')
      .select('*').eq('user_id',businessUserId).eq('contact_id',contactRecord.id).eq('status','open').single().catch(() => ({ data:null }));
    if (!conv) {
      const { data:nc } = await supabase.from('conversations').insert({ user_id:businessUserId, contact_id:contactRecord.id, whatsapp_conversation_id:`${from}_${businessUserId}`, last_message_at:new Date().toISOString() }).select().single().catch(() => ({ data:null }));
      conv = nc;
    } else {
      await supabase.from('conversations').update({ last_message_at:new Date().toISOString() }).eq('id',conv.id).catch(() => {});
    }

    // Log inbound message
    await supabase.from('messages').insert({ conversation_id:conv?.id, whatsapp_message_id:msgId, direction:'inbound', type:msgType, content:msgText, status:'received' }).catch(() => {});

    // Check reply limit
    const { limits } = await getUserSubscription(businessUserId);
    if ((businessSettings.reply_count||0) >= limits.whatsapp_replies) return;

    // Welcome message for first contact
    if ((contactRecord.message_count||0) <= 1 && businessSettings.welcome_message) {
      await sendWAMessage({ phoneNumberId:businessSettings.wa_phone_number_id||WA_PHONE_NUMBER_ID, accessToken:businessSettings.wa_access_token?decrypt(businessSettings.wa_access_token):WA_ACCESS_TOKEN, to:from, message:businessSettings.welcome_message.replace('{name}',customerName) });
      await markWARead(msgId, businessSettings.wa_phone_number_id||WA_PHONE_NUMBER_ID, businessSettings.wa_access_token?decrypt(businessSettings.wa_access_token):WA_ACCESS_TOKEN);
      return;
    }

    // Generate AI reply
    const { response:aiReply } = await processWAMessage({ businessUserId, customerPhone:from, customerMessage:msgText, businessSettings, conversationId:conv?.id });

    // Send reply & log it
    await sendWAMessage({ phoneNumberId:businessSettings.wa_phone_number_id||WA_PHONE_NUMBER_ID, accessToken:businessSettings.wa_access_token?decrypt(businessSettings.wa_access_token):WA_ACCESS_TOKEN, to:from, message:aiReply });
    await supabase.from('messages').insert({ conversation_id:conv?.id, direction:'outbound', type:'text', content:aiReply, status:'sent', ai_processed:true }).catch(() => {});
    await supabase.from('business_settings').update({ reply_count:(businessSettings.reply_count||0)+1 }).eq('user_id',businessUserId).catch(() => {});
    await markWARead(msgId, businessSettings.wa_phone_number_id||WA_PHONE_NUMBER_ID, businessSettings.wa_access_token?decrypt(businessSettings.wa_access_token):WA_ACCESS_TOKEN);

  } catch (err) { console.error('[WA WEBHOOK ERROR]', err.message); }
});

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
app.post('/social/connect/:platform', authenticate, async (req, res) => {
  const { platform } = req.params;
  const state = Buffer.from(JSON.stringify({ user_id:req.user.id, platform, ts:Date.now() })).toString('base64');
  const redir  = encodeURIComponent(`${BACKEND_URL}/social/callback/${platform}`);
  let authUrl  = '';
  switch (platform) {
    case 'instagram': case 'facebook':
      authUrl = `https://www.facebook.com/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${redir}&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_manage_posts,pages_read_engagement&state=${state}&response_type=code`;
      break;
    case 'tiktok':
      authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&scope=video.upload,video.publish&response_type=code&redirect_uri=${redir}&state=${state}`;
      break;
    case 'youtube':
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${redir}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube&state=${state}&access_type=offline`;
      break;
    default:
      return res.status(400).json({ success:false, error:'Platform not supported yet.' });
  }
  return res.json({ success:true, data:{ auth_url:authUrl, platform }, message:`Open this URL to connect ${platform}` });
});

// GET /social/callback/:platform
app.get('/social/callback/:platform', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error:oErr } = req.query;
  if (oErr) return res.redirect(`${FRONTEND_URL}/settings/social?error=${oErr}`);
  if (!code||!state) return res.redirect(`${FRONTEND_URL}/settings/social?error=missing_params`);
  try {
    const stateData = JSON.parse(Buffer.from(String(state),'base64').toString());
    const userId    = stateData.user_id;
    let accessToken='', refreshToken='', expiresAt='', accountId='', accountName='', profilePicUrl='';

    if (platform==='instagram'||platform==='facebook') {
      const tr   = await (await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(`${BACKEND_URL}/social/callback/${platform}`)}&code=${code}`)).json();
      accessToken = tr.access_token||'';
      const me   = await (await fetch(`https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,picture`)).json();
      accountId  = me.id; accountName = me.name; profilePicUrl = me.picture?.data?.url||'';
    } else if (platform==='tiktok') {
      const tr   = await (await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_key:TIKTOK_CLIENT_KEY||'', client_secret:TIKTOK_CLIENT_SECRET||'', code:String(code), grant_type:'authorization_code', redirect_uri:`${BACKEND_URL}/social/callback/tiktok` }) })).json();
      accessToken = tr.data?.access_token||''; refreshToken = tr.data?.refresh_token||'';
      expiresAt   = new Date(Date.now()+(tr.data?.expires_in||86400)*1000).toISOString();
      accountId   = tr.data?.open_id||''; accountName = 'TikTok Account';
    } else if (platform==='youtube') {
      const tr   = await (await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_id:YOUTUBE_CLIENT_ID||'', client_secret:YOUTUBE_CLIENT_SECRET||'', redirect_uri:`${BACKEND_URL}/social/callback/youtube`, code:String(code), grant_type:'authorization_code' }) })).json();
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
app.post('/content/generate/text', authenticate, contentLimiter, async (req, res) => {
  try {
    const { topic, platform='instagram', tone='professional', language='en', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { data:bv }  = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
    let product = null;
    if (product_id) { const { data:p } = await supabase.from('products').select('*').eq('id',product_id).eq('user_id',req.user.id).single(); product = p; }
    const result = await generateCaptionSafe({ topic, platform, tone, language, brandVoice:bv, product });
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'text', topic, product_id, caption:result.caption, hashtags:result.hashtags, generation_status:'completed', ai_model:'qwen2.5-72b' }).select().single();
    return res.json({ success:true, data:{ ...item, ...result }, message:'Caption generated! 🎉' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate text.' }); }
});

// POST /content/generate/image
app.post('/content/generate/image', authenticate, contentLimiter, async (req, res) => {
  try {
    const { topic, platform='instagram', tone='professional', language='en', aspect_ratio='1:1', style='photorealistic', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.ai_image_enabled) return res.status(403).json({ success:false, error:'AI image generation is not available on your plan.' });
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
    let product = null;
    if (product_id) { const { data:p } = await supabase.from('products').select('*').eq('id',product_id).eq('user_id',req.user.id).single(); product = p; }
    const [captionResult, imageUrl] = await Promise.all([ generateCaptionSafe({ topic, platform, tone, language, brandVoice:bv, product }), generateAIImage({ topic, aspectRatio:aspect_ratio, style }) ]);
    const storedUrl = await uploadToStorage(imageUrl, req.user.id, 'image');
    const { data:item } = await supabase.from('content_items').insert({ user_id:req.user.id, type:'image', topic, product_id, image_url:storedUrl||imageUrl, caption:captionResult.caption, hashtags:captionResult.hashtags, aspect_ratio, generation_status:'completed' }).select().single();
    return res.json({ success:true, data:{ ...item, ...captionResult }, message:'Image generated! 🖼️' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate image.' }); }
});

// POST /content/generate/video
app.post('/content/generate/video', authenticate, contentLimiter, async (req, res) => {
  try {
    const { topic, platform='tiktok', tone='professional', language='en', duration=6, aspect_ratio='9:16', style='modern', product_id } = req.body;
    if (!topic) return res.status(400).json({ success:false, error:'Topic is required.' });
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.ai_video_enabled) return res.status(403).json({ success:false, error:'AI video generation requires Creator plan or above.' });
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
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
app.post('/content/generate/carousel', authenticate, contentLimiter, async (req, res) => {
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
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
    const result = await generateCaptionSafe({ topic:topic||context, platform, tone, language, brandVoice:bv });
    return res.json({ success:true, data:result, message:'Caption generated!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to generate caption.' }); }
});

// POST /content/regenerate/:id
app.post('/content/regenerate/:id', authenticate, contentLimiter, async (req, res) => {
  try {
    const { data:item } = await supabase.from('content_items').select('*').eq('id',req.params.id).eq('user_id',req.user.id).single();
    if (!item) return res.status(404).json({ success:false, error:'Content not found.' });
    const { platform='instagram', tone='professional', language='en' } = req.body;
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
    const result = await generateCaptionSafe({ topic:item.topic, platform, tone, language, brandVoice:bv });
    const { data:updated } = await supabase.from('content_items').update({ caption:result.caption, hashtags:result.hashtags, updated_at:new Date().toISOString() }).eq('id',req.params.id).select().single();
    return res.json({ success:true, data:{ ...updated, ...result }, message:'Regenerated with a fresh variation!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to regenerate.' }); }
});

// GET /content/library
app.get('/content/library', authenticate, async (req, res) => {
  try {
    const { page=1, limit=20, type, status } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    let q = supabase.from('content_items').select('*',{ count:'exact' }).eq('user_id',req.user.id).range(offset,offset+Number(limit)-1).order('created_at',{ ascending:false });
    if (type)   q = q.eq('type',type);
    if (status) q = q.eq('generation_status',status);
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
    const { content_id, platforms, scheduled_for, timezone='Africa/Lagos' } = req.body;
    if (!content_id||!platforms?.length||!scheduled_for) return res.status(400).json({ success:false, error:'content_id, platforms and scheduled_for are required.' });
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
    const { data } = await supabase.from('posts').select('*,content_items(topic,type,image_url,video_url,thumbnail_url)').eq('user_id',req.user.id).in('status',['scheduled','posting']).order('scheduled_for',{ ascending:true });
    return res.json({ success:true, data:data||[] });
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
    const updates = { ...req.body, updated_at:new Date().toISOString() };
    delete updates.id; delete updates.user_id;
    await supabase.from('content_calendar').update(updates).eq('id',req.params.id).eq('user_id',req.user.id);
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
    const { data } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
    return res.json({ success:true, data:data||null });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch brand voice.' }); }
});

// PATCH /content/brand-voice
app.patch('/content/brand-voice', authenticate, async (req, res) => {
  try {
    const { limits } = await getUserSubscription(req.user.id);
    if (!limits.brand_voice_enabled) return res.status(403).json({ success:false, error:'Brand Voice is available on Creator plan and above.' });
    const payload = { ...req.body, user_id:req.user.id, updated_at:new Date().toISOString() };
    delete payload.id;
    const { data:existing } = await supabase.from('brand_voice').select('id').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
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
    const { data:bv } = await supabase.from('brand_voice').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null }));
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
    const [
      { count:contacts },  { count:orders },
      { data:revenue },    { count:content },
      { count:published }, { data:recent },
    ] = await Promise.all([
      supabase.from('contacts').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('orders').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('orders').select('total').eq('user_id',uid).eq('payment_status','paid'),
      supabase.from('content_items').select('id',{ count:'exact', head:true }).eq('user_id',uid),
      supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',uid).eq('status','published'),
      supabase.from('orders').select('order_number,total,status,created_at').eq('user_id',uid).order('created_at',{ ascending:false }).limit(5),
    ]);
    const totalRevenue = (revenue||[]).reduce((s,o) => s+(o.total||0), 0);
    const { subscription, plan } = await getUserSubscription(uid);
    return res.json({ success:true, data:{ whatsapp:{ total_contacts:contacts||0, total_orders:orders||0, total_revenue:totalRevenue }, content:{ total_generated:content||0, total_published:published||0 }, subscription:{ plan, expires_at:subscription?.expires_at }, recent_orders:recent||[] } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch analytics.' }); }
});

// GET /analytics/whatsapp
app.get('/analytics/whatsapp', authenticate, async (req, res) => {
  try {
    const days      = req.query.period==='7d' ? 7 : 30;
    const startDate = new Date(Date.now()-days*24*60*60*1000).toISOString();
    const uid       = req.user.id;
    const [{ count:newContacts },{ data:orders },{ data:settings }] = await Promise.all([
      supabase.from('contacts').select('id',{ count:'exact', head:true }).eq('user_id',uid).gte('created_at',startDate),
      supabase.from('orders').select('total,payment_status,created_at').eq('user_id',uid).gte('created_at',startDate),
      supabase.from('business_settings').select('reply_count').eq('user_id',uid).single(),
    ]);
    const paid    = (orders||[]).filter(o => o.payment_status==='paid');
    const revenue = paid.reduce((s,o) => s+(o.total||0), 0);
    return res.json({ success:true, data:{ period:`Last ${days} days`, new_contacts:newContacts||0, total_messages:settings?.reply_count||0, total_orders:(orders||[]).length, paid_orders:paid.length, revenue, conversion_rate:(orders||[]).length>0?Math.round((paid.length/(orders||[]).length)*100):0 } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch WhatsApp analytics.' }); }
});

// GET /analytics/content
app.get('/analytics/content', authenticate, async (req, res) => {
  try {
    const days      = req.query.period==='7d' ? 7 : 30;
    const startDate = new Date(Date.now()-days*24*60*60*1000).toISOString();
    const uid       = req.user.id;
    const [{ count:generated },{ count:pubCount },{ data:types }] = await Promise.all([
      supabase.from('content_items').select('id',{ count:'exact', head:true }).eq('user_id',uid).gte('created_at',startDate),
      supabase.from('posts').select('id',{ count:'exact', head:true }).eq('user_id',uid).eq('status','published').gte('published_at',startDate),
      supabase.from('content_items').select('type').eq('user_id',uid).gte('created_at',startDate),
    ]);
    const byType = { video:0, image:0, text:0, carousel:0 };
    (types||[]).forEach(i => { if (byType[i.type]!==undefined) byType[i.type]++; });
    return res.json({ success:true, data:{ period:`Last ${days} days`, total_generated:generated||0, total_published:pubCount||0, by_type:byType } });
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
    const { data:orders } = await supabase.from('orders').select('total,currency,payment_status,created_at').eq('user_id',req.user.id).gte('created_at',startDate).order('created_at',{ ascending:true });
    const paid      = (orders||[]).filter(o => o.payment_status==='paid');
    const total     = paid.reduce((s,o) => s+(o.total||0), 0);
    const avg       = paid.length>0 ? total/paid.length : 0;
    const byDay     = {};
    paid.forEach(o => { const d=o.created_at.substring(0,10); byDay[d]=(byDay[d]||0)+(o.total||0); });
    return res.json({ success:true, data:{ total_revenue:total, total_orders:paid.length, average_order_value:Math.round(avg), by_day:byDay, currency:req.user.currency||'NGN' } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch revenue analytics.' }); }
});

// GET /analytics/growth
app.get('/analytics/growth', authenticate, async (req, res) => {
  try {
    const [{ data:accounts },{ data:contacts }] = await Promise.all([
      supabase.from('connected_accounts').select('platform,total_posts,last_posted_at').eq('user_id',req.user.id),
      supabase.from('contacts').select('segment').eq('user_id',req.user.id),
    ]);
    const bySegment = { lead:0, customer:0, vip:0 };
    (contacts||[]).forEach(c => { if (bySegment[c.segment]!==undefined) bySegment[c.segment]++; });
    return res.json({ success:true, data:{ social_accounts:accounts||[], contacts_by_segment:bySegment, total_contacts:(contacts||[]).length } });
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
    const [{ data:orders },{ data:contacts }] = await Promise.all([
      supabase.from('orders').select('order_number,customer_name,total,payment_status,status,created_at').eq('user_id',req.user.id),
      supabase.from('contacts').select('name,phone,segment,total_orders,total_spent').eq('user_id',req.user.id),
    ]);
    const csv = [
      '=== ORDERS ===', 'order_number,customer,total,payment,status,date',
      ...(orders||[]).map(o => `${o.order_number},${o.customer_name||''},${o.total},${o.payment_status},${o.status},${(o.created_at||'').substring(0,10)}`),
      '\n=== CONTACTS ===', 'name,phone,segment,orders,spent',
      ...(contacts||[]).map(c => `${c.name||''},${c.phone},${c.segment||''},${c.total_orders||0},${c.total_spent||0}`),
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
    return res.json({ success:true, data:{ subscription, plan, limits, usage:{ whatsapp_replies:{ used:replies||0, limit:limits.whatsapp_replies }, contacts:{ used:contactsC||0, limit:limits.whatsapp_contacts }, products:{ used:products||0, limit:limits.products_limit }, content_generated:{ used:contentC||0, limit:limits.text_posts+limits.image_generations+limits.video_generations }, scheduled_posts:{ used:scheduled||0, limit:limits.scheduled_posts_limit } } } });
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
    const currency       = user.currency||location.currency;
    let amount           = PLAN_LIMITS[plan].price[currency] ?? PLAN_LIMITS[plan].price.USD;
    if (billing_cycle==='annual') amount = amount*12*0.80;
    const result = await initializePaystack({ email:user.email, amount, currency, metadata:{ user_id:req.user.id, plan, billing_cycle, custom_fields:[{ display_name:'Plan', variable_name:'plan', value:plan }] }, callback_url:`${FRONTEND_URL}/pricing.html?plan=${plan}` });
    if (!result.status) throw new Error(result.message||'Payment init failed');
    return res.json({ success:true, data:{ payment_url:result.data.authorization_url, reference:result.data.reference, amount, currency, plan }, message:'Redirecting to payment...' });
  } catch (err) {
    return res.status(500).json({ success:false, error:err.message||'Failed to initialize payment.' });
  }
});

// POST /subscription/cancel
app.post('/subscription/cancel', authenticate, async (req, res) => {
  try {
    await supabase.from('subscriptions').update({ status:'cancelled', cancelled_at:new Date().toISOString(), auto_renew:false }).eq('user_id',req.user.id).eq('status','active');
    return res.json({ success:true, message:"Subscription cancelled. You'll retain access until end of billing period." });
  } catch { return res.status(500).json({ success:false, error:'Failed to cancel subscription.' }); }
});

// POST /subscription/reactivate
app.post('/subscription/reactivate', authenticate, async (req, res) => {
  try {
    const { data:sub } = await supabase.from('subscriptions').select('*').eq('user_id',req.user.id).eq('status','cancelled').order('cancelled_at',{ ascending:false }).limit(1).single();
    if (!sub) return res.status(404).json({ success:false, error:'No cancelled subscription found.' });
    await supabase.from('subscriptions').update({ status:'active', cancelled_at:null, auto_renew:true, expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString() }).eq('id',sub.id);
    return res.json({ success:true, message:'Subscription reactivated! Welcome back!' });
  } catch { return res.status(500).json({ success:false, error:'Failed to reactivate.' }); }
});

// GET /subscription/invoices
app.get('/subscription/invoices', authenticate, async (req, res) => {
  try {
    const { data } = await supabase.from('subscriptions').select('id,plan,status,amount_paid,currency,billing_cycle,starts_at,expires_at,paystack_reference').eq('user_id',req.user.id).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch invoices.' }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 7: REFERRALS (5) ────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /referrals/stats
app.get('/referrals/stats', authenticate, async (req, res) => {
  try {
    const [{ data:stats },{ data:user }] = await Promise.all([
      supabase.from('affiliate_stats').select('*').eq('user_id',req.user.id).single().catch(() => ({ data:null })),
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
    const { data } = await supabase.from('referrals').select('*,users!referred_id(email,full_name,created_at)').eq('referrer_id',req.user.id).order('created_at',{ ascending:false });
    return res.json({ success:true, data:data||[] });
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
    if (tpl.sample_products?.length)   await supabase.from('products').insert(tpl.sample_products.map(p => ({ ...p, user_id:req.user.id }))).catch(() => {});
    if (tpl.sample_kb_entries?.length) await supabase.from('knowledge_base').insert(tpl.sample_kb_entries.map(e => ({ ...e, user_id:req.user.id }))).catch(() => {});
    return res.json({ success:true, message:`"${tpl.name}" template applied!` });
  } catch { return res.status(500).json({ success:false, error:'Failed to apply template.' }); }
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
app.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page=1, limit=20, search } = req.query;
    const offset = (Number(page)-1)*Number(limit);
    let q = supabase.from('users').select('id,email,username,full_name,country_code,currency,email_verified,is_active,is_suspended,created_at,last_login',{ count:'exact' }).range(offset,offset+Number(limit)-1).order('created_at',{ ascending:false });
    if (search) q = q.or(`email.ilike.%${search}%,username.ilike.%${search}%,full_name.ilike.%${search}%`);
    const { data, count, error } = await q;
    if (error) throw error;
    return res.json({ success:true, data, meta:{ total:count, page:Number(page), limit:Number(limit) } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch users.' }); }
});

// GET /admin/users/:id
app.get('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [{ data:user },{ subscription, plan },{ count:orderCount }] = await Promise.all([
      supabase.from('users').select('*').eq('id',req.params.id).single(),
      getUserSubscription(req.params.id),
      supabase.from('orders').select('id',{ count:'exact', head:true }).eq('user_id',req.params.id),
    ]);
    if (!user) return res.status(404).json({ success:false, error:'User not found.' });
    return res.json({ success:true, data:{ ...user, plan, subscription, total_orders:orderCount } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch user.' }); }
});

// POST /admin/users/:id/set-plan
app.post('/admin/users/:id/set-plan', authenticate, requireAdmin, async (req, res) => {
  try {
    const { plan, expires_in_days=30 } = req.body;
    if (!PLAN_LIMITS[plan]) return res.status(400).json({ success:false, error:'Invalid plan.' });
    await supabase.from('subscriptions').upsert({ user_id:req.params.id, plan, status:'active', billing_cycle:'admin_override', amount_paid:0, starts_at:new Date().toISOString(), expires_at:new Date(Date.now()+Number(expires_in_days)*24*60*60*1000).toISOString() },{ onConflict:'user_id' });
    return res.json({ success:true, message:`User plan set to ${plan} for ${expires_in_days} days.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to set plan.' }); }
});

// POST /admin/users/:id/suspend
app.post('/admin/users/:id/suspend', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data:user } = await supabase.from('users').select('is_suspended').eq('id',req.params.id).single();
    const suspend = !user?.is_suspended;
    await supabase.from('users').update({ is_suspended:suspend, suspension_reason:suspend?(req.body.reason||'Suspended by admin'):null }).eq('id',req.params.id);
    return res.json({ success:true, message:`User ${suspend?'suspended':'unsuspended'}.` });
  } catch { return res.status(500).json({ success:false, error:'Failed to update user status.' }); }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await supabase.from('users').update({ is_active:false, email:`deleted_${Date.now()}_${req.params.id}@deleted.com` }).eq('id',req.params.id);
    return res.json({ success:true, message:'User account deactivated.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to deactivate user.' }); }
});

// GET /admin/platform-stats
app.get('/admin/platform-stats', authenticate, requireAdmin, async (req, res) => {
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
app.get('/admin/revenue', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data:subs } = await supabase.from('subscriptions').select('plan,amount_paid,currency').eq('status','active').neq('plan','free');
    const byPlan = {};
    let total = 0;
    (subs||[]).forEach(s => { byPlan[s.plan]=(byPlan[s.plan]||0)+(s.amount_paid||0); total+=(s.amount_paid||0); });
    return res.json({ success:true, data:{ total_mrr:total, by_plan:byPlan, subscriber_count:(subs||[]).length } });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch revenue.' }); }
});

// GET /admin/content-moderation
app.get('/admin/content-moderation', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('content_items').select('id,user_id,topic,type,caption,created_at').eq('generation_status','completed').order('created_at',{ ascending:false }).limit(50);
    return res.json({ success:true, data:data||[] });
  } catch { return res.status(500).json({ success:false, error:'Failed to fetch content.' }); }
});

// POST /admin/global-kb
app.post('/admin/global-kb', authenticate, requireAdmin, async (req, res) => {
  try {
    const { trigger, response, category, industry='all', language='en' } = req.body;
    if (!trigger||!response) return res.status(400).json({ success:false, error:'Trigger and response are required.' });
    const { data, error } = await supabase.from('global_kb_library').insert({ trigger:trigger.toLowerCase(), response, category, industry, language }).select().single();
    if (error) throw error;
    return res.status(201).json({ success:true, data, message:'Global keyword added.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to add global keyword.' }); }
});

// PATCH /admin/global-kb/:id
app.patch('/admin/global-kb/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('global_kb_library').update(req.body).eq('id',req.params.id).select().single();
    if (error) throw error;
    return res.json({ success:true, data, message:'Global keyword updated.' });
  } catch { return res.status(500).json({ success:false, error:'Failed to update keyword.' }); }
});

// POST /admin/test-whatsapp
app.post('/admin/test-whatsapp', authenticate, requireAdmin, async (req, res) => {
  try {
    const { to, message='Test from ZAPIT admin 🚀' } = req.body;
    if (!to) return res.status(400).json({ success:false, error:'Phone number (to) is required.' });
    const result = await sendWAMessage({ to, message });
    return res.json({ success:result.success, data:result, message:result.success?'Test message sent!':'Failed.' });
  } catch { return res.status(500).json({ success:false, error:'Test failed.' }); }
});

// POST /admin/test-post
app.post('/admin/test-post', authenticate, requireAdmin, (_req, res) => {
  return res.json({ success:true, message:'Use POST /content/publish-now with a connected account to test posting.' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── SECTION 10: WEBHOOKS ────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /webhook/paystack
app.post('/webhook/paystack', webhookLimiter, async (req, res) => {
  try {
    const sig = req.headers['x-paystack-signature'];
    if (!verifyPaystackSig(req.body, String(sig))) return res.status(400).json({ success:false, error:'Invalid signature.' });
    const event = JSON.parse(req.body.toString());
    res.status(200).json({ success:true }); // Respond immediately

    if (event.event === 'charge.success') {
      const { reference, metadata, amount, currency } = event.data;
      const userId = metadata?.user_id;
      const plan   = metadata?.plan;
      const cycle  = metadata?.billing_cycle || 'monthly';
      if (!userId||!plan||!PLAN_LIMITS[plan]) return;

      const verify = await verifyPaystack(reference);
      if (verify.data?.status !== 'success') return;

      const amountPaid = amount/100;
      const days       = cycle==='annual' ? 365 : 30;
      await supabase.from('subscriptions').upsert({ user_id:userId, plan, status:'active', billing_cycle:cycle, amount_paid:amountPaid, currency, paystack_reference:reference, starts_at:new Date().toISOString(), expires_at:new Date(Date.now()+days*24*60*60*1000).toISOString(), next_billing_date:new Date(Date.now()+days*24*60*60*1000).toISOString(), auto_renew:true },{ onConflict:'user_id' });

      const { data:user } = await supabase.from('users').select('email,full_name').eq('id',userId).single();
      if (user) {
        await sendEmail({ to:user.email, toName:user.full_name, subject:`🎉 You're on ZAPIT ${plan.charAt(0).toUpperCase()+plan.slice(1)} Plan!`,
          htmlContent:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#6366F1">⚡ ZAPIT</h1><h2>Payment Confirmed! 🎉</h2><p>Hi ${user.full_name||'there'},</p><p>Your payment of <strong>${currency} ${amountPaid.toLocaleString()}</strong> was successful.</p><p>You're now on the <strong>${plan.toUpperCase()}</strong> plan.</p><p>Reference: ${reference}</p><a href="${FRONTEND_URL}/dashboard" style="background:#6366F1;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:16px">Go to Dashboard →</a></div>` });
      }
      // Referral reward
      const { data:ref } = await supabase.from('referrals').select('*').eq('referred_id',userId).eq('status','pending').single().catch(() => ({ data:null }));
      if (ref) await supabase.from('referrals').update({ referred_upgraded:true, referred_plan:plan, status:'completed' }).eq('id',ref.id).catch(() => {});
    }
  } catch (err) { console.error('[PAYSTACK WEBHOOK]', err.message); }
});

// POST /webhook/tiktok
app.post('/webhook/tiktok', webhookLimiter, async (req, res) => {
  res.status(200).json({ success:true });
  try {
    const { event, data } = req.body;
    if (event==='video.publish.complete'&&data?.publish_id) {
      await supabase.from('posts').update({ tiktok_post_id:data.share_id||data.publish_id, tiktok_post_url:data.share_url||null, status:'published', published_at:new Date().toISOString() }).eq('tiktok_post_id',data.publish_id).catch(() => {});
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
    email:    BREVO_API_KEY ? 'configured' : 'not configured',
    payments: PAYSTACK_SECRET_KEY ? 'configured' : 'not configured',
  };
  try {
    await supabase.from('users').select('id').limit(1);
    services.database = 'online';
  } catch { services.database = 'offline'; }
  return res.json({ status:'ok', version:'3.0.0', timestamp:new Date().toISOString(), services });
});

// GET /status
app.get('/status', async (_req, res) => {
  const checks = { api:'online', database:'checking', ai_text:HF_API_KEY?'configured':'unconfigured', ai_image:REPLICATE_API_KEY?'configured':'unconfigured', whatsapp:WA_ACCESS_TOKEN?'configured':'unconfigured', email:BREVO_API_KEY?'configured':'unconfigured', payments:PAYSTACK_SECRET_KEY?'configured':'unconfigured' };
  try { await supabase.from('users').select('id').limit(1); checks.database='online'; } catch { checks.database='offline'; }
  return res.json({ success:true, data:checks });
});

// POST /support/contact
app.post('/support/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!email||!message) return res.status(400).json({ success:false, error:'Email and message are required.' });
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
app.use((_req, res) => res.status(404).json({ success:false, error:'Route not found. Check the API documentation.' }));

app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ success:false, error:'An unexpected error occurred. Please try again.' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── CRON JOBS ───────────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Publish due scheduled posts — every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const now            = new Date().toISOString();
    const fiveMinutesAgo = new Date(Date.now()-5*60*1000).toISOString();
    const { data:due }   = await supabase.from('posts').select('*,content_items(*)').eq('status','scheduled').lte('scheduled_for',now).gte('scheduled_for',fiveMinutesAgo).limit(20);
    if (!due?.length) return;
    for (const post of due) {
      await supabase.from('posts').update({ status:'posting' }).eq('id',post.id);
      const content = post.content_items;
      if (!content) { await supabase.from('posts').update({ status:'failed', error_log:{ global:'Content item not found' } }).eq('id',post.id); continue; }
      const { results, errors } = await publishContent(post, content);
      const updateData = { status:Object.keys(errors).length===0?'published':'failed', published_at:new Date().toISOString(), error_log:Object.keys(errors).length?errors:null };
      if (results.instagram) { updateData.instagram_post_id=results.instagram.post_id; updateData.instagram_post_url=results.instagram.post_url; }
      if (results.facebook)  { updateData.facebook_post_id=results.facebook.post_id;   updateData.facebook_post_url=results.facebook.post_url; }
      if (results.tiktok)    { updateData.tiktok_post_id=results.tiktok.post_id;        updateData.tiktok_post_url=results.tiktok.post_url; }
      if (results.youtube)   { updateData.youtube_post_id=results.youtube.post_id;      updateData.youtube_post_url=results.youtube.post_url; }
      await supabase.from('posts').update(updateData).eq('id',post.id);
    }
  } catch (err) { console.error('[CRON publish]', err.message); }
});

// Reset monthly WhatsApp reply counts — 1st of every month at midnight
cron.schedule('0 0 1 * *', async () => {
  try {
    await supabase.from('business_settings').update({ reply_count:0, last_reply_reset:new Date().toISOString() });
    console.log('[CRON] Monthly reply counts reset.');
  } catch (err) { console.error('[CRON reset counts]', err.message); }
});

// Expire subscriptions — daily at 2am
cron.schedule('0 2 * * *', async () => {
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
      const { data:user } = await supabase.from('users').select('email,full_name').eq('id',sub.user_id).single().catch(() => ({ data:null }));
      if (user) {
        await sendEmail({ to:user.email, toName:user.full_name, subject:'Your ZAPIT subscription has expired', htmlContent:`<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#6366F1">⚡ ZAPIT</h1><h2>Subscription Expired</h2><p>Hi ${user.full_name||'there'},</p><p>Your ${sub.plan} plan has expired. Your account has been moved to the Free plan.</p><p>Renew now to restore all your features!</p><a href="${FRONTEND_URL}/pricing" style="background:#6366F1;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:16px">Renew Subscription →</a></div>` }).catch(() => {});
      }
    }
    console.log(`[CRON] Expired ${expired.length} subscription(s).`);
  } catch (err) { console.error('[CRON expire subs]', err.message); }
});

// Process content calendar automations — every hour
cron.schedule('0 * * * *', async () => {
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
  console.log(`\n🚀 Africa's #1 WhatsApp + Content Automation Platform is live!\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM received. Shutting down gracefully...'); server.close(() => { console.log('Server closed.'); process.exit(0); }); });
process.on('SIGINT',  () => { console.log('SIGINT received. Shutting down gracefully...');  server.close(() => { console.log('Server closed.'); process.exit(0); }); });
process.on('uncaughtException',  err => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));

export default app;
