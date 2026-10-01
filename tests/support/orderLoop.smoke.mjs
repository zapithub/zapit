// Phase 8.2 live proof of the in-chat order loop.
//
//   npm run smoke:order
//
// Starts an in-memory PostgREST stand-in, a stub Paystack API and the real API,
// then drives a signed WhatsApp delivery through the whole loop:
//   chat → draft → order row → payment request → (bank | Paystack) → paid.
// Self-contained: no network, no Supabase, no Paystack account.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { start } from './fakePostgrest.mjs';

const PORT = Number(process.env.SMOKE_PORT || 3099);
const SUPABASE_PORT = Number(process.env.SMOKE_SUPABASE_PORT || 54321);
const PAYSTACK_PORT = Number(process.env.SMOKE_PAYSTACK_PORT || 54322);
const SECRET = 'smoke-app-secret';
const ENC_KEY = 'smoke-encryption-key-32-characters-ok';
const PLATFORM_PAYSTACK_KEY = 'sk_test_platform';

function encrypted(plain) {
  const ck = crypto.scryptSync(ENC_KEY, 'zapit-salt-v3', 32);
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', ck, iv);
  return `${iv.toString('hex')}:${c.update(plain, 'utf8', 'hex') + c.final('hex')}`;
}
process.env.SEED_WA_TOKEN = encrypted('mock-access-token');

// ── stub Paystack: initialize returns a link, verify echoes the charge ──
const charges = new Map();
const paystack = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/transaction/initialize' && req.method === 'POST') {
    const payload = JSON.parse(body || '{}');
    const reference = payload.reference || `zapord_stub_${charges.size}`;
    charges.set(reference, { amount: payload.amount, currency: payload.currency });
    res.end(JSON.stringify({ status: true, data: { authorization_url: `https://pay.test/${reference}`, reference, access_code: 'ac_stub' } }));
    return;
  }
  if (url.pathname.startsWith('/transaction/verify/')) {
    const reference = decodeURIComponent(url.pathname.split('/').pop());
    const charge = charges.get(reference);
    if (!charge) { res.end(JSON.stringify({ status: false, message: 'Transaction not found' })); return; }
    res.end(JSON.stringify({ status: true, data: {
      status: 'success', reference, amount: charge.amount, currency: charge.currency,
      channel: 'card', gateway_response: 'Successful', paid_at: new Date().toISOString(),
    } }));
    return;
  }
  res.end(JSON.stringify({ status: false, message: 'not stubbed' }));
});
await new Promise(r => paystack.listen(PAYSTACK_PORT, '0.0.0.0', r));

const fake = await start(SUPABASE_PORT);
const server = spawn(process.execPath, ['index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
    SUPABASE_SERVICE_KEY: 'fake-service-key-32-chars-minimum-x',
    NODE_ENV: 'development', PORT: String(PORT),
    WA_APP_SECRET: SECRET, WA_PHONE_NUMBER_ID: '555000111',
    WA_ACCESS_TOKEN: 'platform-mock-token', ENCRYPTION_KEY: ENC_KEY,
    PAYSTACK_SECRET_KEY: PLATFORM_PAYSTACK_KEY,
    PAYSTACK_API_BASE: `http://127.0.0.1:${PAYSTACK_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Boot must be proven, not assumed: a silent fall-through turned every later
// check into a confusing failure instead of "the API never came up".
let booted = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`${base}/health`); if (r.ok) { booted = true; break; } } catch { /* not up yet */ }
  await sleep(250);
}
if (!booted) {
  // One annotation line carries the child's own output: without it a CI failure
  // here is undiagnosable (and GitHub's raw job logs are not always reachable).
  const tail = String(serverLog || '(no output from the API process)').replace(/\s+/g, ' ').slice(-1200);
  console.log(`::error::order-loop smoke: the API never answered /health on port ${PORT} — node ${process.version} — child log tail: ${tail}`);
  console.log(serverLog.slice(-3000));
  server.kill('SIGTERM'); await fake.stop(); paystack.close();
  process.exit(1);
}

/**
 * Wait until the API has finished reacting to a delivery.
 *
 * The handler answers 200 *before* it does its work (Meta's contract), so the
 * old fixed 2-second sleeps raced a slow machine — green locally, red on CI.
 * This polls the fake database until it stops changing, with a hard ceiling.
 */
async function settle({ timeout = 30000, quietMs = 400 } = {}) {
  const snapshot = () => JSON.stringify({
    messages: fake.db.messages, orders: fake.db.orders, order_drafts: fake.db.order_drafts,
    events: fake.db.webhook_events, contacts: fake.db.contacts, conversations: fake.db.conversations,
  });
  let last = snapshot(), lastChange = Date.now();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(100);
    const now = snapshot();
    if (now !== last) { last = now; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return true;
  }
  return false;
}

const waSend = async (text, id) => {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'A', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '555000111' },
      contacts: [{ profile: { name: 'Ada Customer' }, wa_id: '2348000000001' }],
      messages: [{ id, from: '2348000000001', type: 'text', text: { body: text } }],
    } }] }],
  });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(`${base}/webhook/whatsapp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` }, body,
  });
  await settle();   // let the background handler finish (polled, never a fixed sleep)
  return res.status;
};

const paystackWebhook = async (reference) => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference } });
  const sig = crypto.createHmac('sha512', PLATFORM_PAYSTACK_KEY).update(body).digest('hex');
  const res = await fetch(`${base}/webhook/paystack`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body,
  });
  await settle();
  return res.status;
};

const outbound = () => fake.db.messages.filter(m => m.direction === 'outbound').map(m => m.content);
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); };

// ── scenario A: Paystack finds the order and marks it paid ──────
fake.db.business_settings[0].paystack_secret_key = encrypted('sk_test_tenant');
check('signed delivery accepted (order + address)', await waSend('i want 2 bags of rice', 'wamid.o1') === 200);
check('signed delivery accepted (address)', await waSend('12 Adeola Street, Lekki', 'wamid.o2') === 200);

const order = fake.db.orders[0];
check('order row created', !!order, order?.order_number);
check('product + quantity captured', order?.items?.[0]?.name === 'Rice' && order?.items?.[0]?.quantity === 2, 'Rice ×2');
check('delivery address captured', order?.delivery_address === '12 Adeola Street, Lekki');
check('total = 2×2500 + 500 delivery', order?.total === 5500 && order?.currency === 'NGN', `NGN ${order?.total}`);
check('generateOrderNumber format', /^ZAP-[A-Z0-9]+-[A-Z0-9]{4}$/.test(order?.order_number || ''), order?.order_number);
check('payment rail = tenant Paystack', order?.payment_provider === 'paystack', order?.payment_provider);
check('Paystack link stored on the order', /^https:\/\/pay\.test\//.test(order?.payment_link || ''), order?.payment_link);
check('unique order reference', /^zapord_/.test(order?.payment_reference || ''), order?.payment_reference);
check('customer got the pay link', outbound().some(m => /pay\.test/.test(m)));
check('order awaits payment', order?.payment_status === 'pending');

// the gateway confirms — the webhook must verify with the TENANT key and settle
check('paystack webhook accepted', await paystackWebhook(order.payment_reference) === 200);
const paid = fake.db.orders[0];
check('webhook marked the order paid', paid?.payment_status === 'paid' && !!paid?.paid_at, `${paid?.payment_status} @ ${paid?.paid_at}`);
check('order status confirmed (transition allowed)', paid?.status === 'confirmed', paid?.status);
check('verification evidence stored', !!paid?.gateway_response && paid?.payment_verified_at !== null && paid?.payment_verified_at !== undefined);
check('customer confirmed', outbound().some(m => /Payment received for order/.test(m)));

// ── scenario B: an unpaid order + cancel, and dedup ────────────
check('cancel keyword accepted', await waSend('cancel', 'wamid.o3') === 200);
check('every wamid claimed exactly once', new Set(fake.db.webhook_events.map(e => e.event_id)).size === 3, `${fake.db.webhook_events.length} events`);
check('draft store left clean', fake.db.order_drafts.length === 0);

console.log('\n── orders in the fake database ──');
console.log(JSON.stringify(fake.db.orders.map(o => ({
  number: o.order_number, items: o.items?.map(i => `${i.name} x${i.quantity}`), address: o.delivery_address,
  total: o.total, currency: o.currency, provider: o.payment_provider, reference: o.payment_reference,
  status: o.status, payment_status: o.payment_status, paid_at: o.paid_at, source: o.source,
})), null, 2));

const failed = results.filter(r => !r.ok).length;
if (failed) {
  // GitHub turns these into run annotations, so a failure is readable even when
  // the raw job log cannot be downloaded.
  for (const f of results.filter(r => !r.ok)) console.log(`::error::order-loop smoke — ${f.label}${f.detail ? ` (${f.detail})` : ''}`);
  console.log(`\n${failed} smoke check(s) FAILED\n\nserver log:\n${serverLog.slice(-2000)}`);
} else console.log('\nAll order-loop smoke checks passed ✅');

server.kill('SIGTERM');
await fake.stop();
paystack.close();
process.exit(failed ? 1 : 0);
