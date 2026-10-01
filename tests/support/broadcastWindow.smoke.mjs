// Phase 8.3 live proof of the broadcast 24h-window rules.
//
//   npm run smoke:broadcast
//
// Seeds one business with 4 reachable contacts (2 inside the window, 1 outside,
// 1 never seen) plus 1 opted out, logs in for real, and runs two broadcasts:
// free text only (the cold contact must be skipped, not free-texted) and free
// text + template (the cold contact gets the template payload).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { start } from './fakePostgrest.mjs';

const PORT = Number(process.env.SMOKE_PORT || 3098);
const SUPABASE_PORT = Number(process.env.SMOKE_SUPABASE_PORT || 54323);
const GRAPH_PORT = Number(process.env.SMOKE_GRAPH_PORT || 54324);
const ENC_KEY = 'smoke-encryption-key-32-characters-ok';
const PASSWORD = 'SmokePass123!';

function encrypted(plain) {
  const ck = crypto.scryptSync(ENC_KEY, 'zapit-salt-v3', 32);
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', ck, iv);
  return `${iv.toString('hex')}:${c.update(plain, 'utf8', 'hex') + c.final('hex')}`;
}
process.env.SEED_WA_TOKEN = encrypted('mock-access-token');
process.env.SEED_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
process.env.SEED_BROADCAST_CONTACTS = '1';

// graph.facebook.com stand-in: records the payloads WhatsApp would receive.
const sent = [];
const graph = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  try { sent.push(JSON.parse(body || '{}')); } catch { /* ignore */ }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.sent${sent.length}` }] }));
});
await new Promise(r => graph.listen(GRAPH_PORT, '0.0.0.0', r));

const fake = await start(SUPABASE_PORT);
const server = spawn(process.execPath, ['index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
    SUPABASE_SERVICE_KEY: 'fake-service-key-32-chars-minimum-x',
    NODE_ENV: 'development', PORT: String(PORT),
    WA_APP_SECRET: 'smoke-app-secret', WA_PHONE_NUMBER_ID: '555000111',
    WA_ACCESS_TOKEN: 'platform-mock-token', ENCRYPTION_KEY: ENC_KEY,
    WA_GRAPH_BASE: `http://127.0.0.1:${GRAPH_PORT}`,
    // Six-field cron (seconds) so the scheduled-run path is proven in seconds,
    // not on the next five-minute boundary.
    BROADCAST_CRON: '*/5 * * * * *',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Boot must be proven, not assumed (a silent fall-through made every later
// check fail with a confusing message instead of naming the real problem).
let booted = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`${base}/health`); if (r.ok) { booted = true; break; } } catch { /* not up yet */ }
  await sleep(250);
}
if (!booted) {
  // One annotation line carries the child's own output: without it a CI failure
  // here is undiagnosable (and GitHub's raw job logs are not always reachable).
  const tail = String(serverLog || '(no output from the API process)').replace(/\s+/g, ' ').slice(-1200);
  console.log(`::error::broadcast smoke: the API never answered /health on port ${PORT} — node ${process.version} — child log tail: ${tail}`);
  console.log(serverLog.slice(-3000));
  server.kill('SIGTERM'); graph.closeAllConnections?.(); graph.close(); await fake.stop();
  process.exit(1);
}

/**
 * Wait until the API has finished sending the broadcast: the route answers with
 * a plan and dispatches in the background, so a fixed sleep raced slow machines.
 * Polls the recorded Graph payloads and the broadcast rows until they settle.
 */
async function settle({ timeout = 30000, quietMs = 400, minSends = 0 } = {}) {
  const snapshot = () => JSON.stringify({ sent: sent.length, broadcasts: fake.db.broadcasts });
  let last = snapshot(), lastChange = Date.now();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(100);
    if (sent.length < minSends) continue;
    const now = snapshot();
    if (now !== last) { last = now; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return true;
  }
  return false;
}

const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); };

// ── login ───────────────────────────────────────────────────────
const loginRes = await fetch(`${base}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }),
});
const login = await loginRes.json();
const token = login?.data?.access_token;
check('login works against the fake database', loginRes.status === 200 && !!token, `plan=${login?.data?.user?.plan}`);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// ── a template ──────────────────────────────────────────────────
const tplRes = await fetch(`${base}/whatsapp/templates`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'promo_october', language: 'en', body: 'Hi {{1}}, October promo is live!', category: 'marketing' }),
});
const tpl = await tplRes.json();
check('template saved', tplRes.status === 201 && !!tpl?.data?.id, tpl?.data?.name);
check('invalid template refused', (await fetch(`${base}/whatsapp/templates`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Bad Name', language: 'en', body: 'x' }) })).status === 400);

// ── broadcast 1: free text only ─────────────────────────────────
sent.length = 0;
const b1Res = await fetch(`${base}/whatsapp/broadcasts`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'Flash sale', message: 'Hello {name}, 20% off today!', target_segment: 'all' }),
});
const b1 = await b1Res.json();
await settle({ minSends: 2 });
check('free-text broadcast accepted', b1Res.status === 201, b1?.message);
check('only in-window contacts were sent to', b1?.counts?.text === 2, `text=${b1?.counts?.text} template=${b1?.counts?.template} skipped=${b1?.counts?.skipped_window}`);
check('the cold contacts were skipped, not free-texted', b1?.counts?.skipped_window === 2 && (b1?.data?.results?.skipped_reasons || []).includes('outside_24h_window'), `skipped=${b1?.counts?.skipped_window}`);
check('the opted-out contact was never targeted', sent.length === 2 && !sent.some(m => m.to === '2349000000005'));
check('no template payload was used without a template', sent.every(m => m.type === 'text'));

// ── broadcast 2: free text + template ───────────────────────────
sent.length = 0;
const b2Res = await fetch(`${base}/whatsapp/broadcasts`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'October promo', message: 'Hello {name}!', target_segment: 'all', template_id: tpl?.data?.id }),
});
const b2 = await b2Res.json();
await settle({ minSends: 4 });
check('template broadcast accepted', b2Res.status === 201, b2?.message);
check('in-window contacts got free text, cold ones the template',
  b2?.counts?.text === 2 && b2?.counts?.template === 2, `text=${b2?.counts?.text} template=${b2?.counts?.template} skipped=${b2?.counts?.skipped_window}`);
const templateSends = sent.filter(m => m.type === 'template');
check('template payload shape is the Cloud API one',
  templateSends.length === 2 && templateSends.every(m => m.template?.name === 'promo_october' && m.template?.language?.code === 'en' && m.template?.components?.[0]?.parameters?.[0]?.text));
check('nobody outside the window was left unreachable', b2?.counts?.skipped_window === 0);

// ── scheduled broadcasts are actually executed (cron wiring) ────
sent.length = 0;
const schedRes = await fetch(`${base}/whatsapp/broadcasts`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'Later', message: 'Hello {name}!', target_segment: 'all', scheduled_for: new Date(Date.now() + 2000).toISOString() }),
});
const sched = await schedRes.json();
check('scheduled broadcast stored as scheduled', schedRes.status === 201 && sched?.data?.status === 'scheduled', sched?.data?.status);

// The scheduler must pick it up on its own — this is the W-03 half that never
// happened: the row used to sit in 'scheduled' forever.
let executed = null;
for (let i = 0; i < 60; i++) {
  executed = fake.db.broadcasts.find(b => b.id === sched?.data?.id);
  if (executed?.status === 'sent') break;
  await sleep(1000);
}
check('the scheduler executed the scheduled broadcast',
  executed?.status === 'sent', `status=${executed?.status} sent=${executed?.sent_count} skipped=${executed?.skipped_count} attempts=${executed?.results?.sent ?? 0}`);
check('the scheduled run respected the window and recorded its outcome',
  executed?.sent_count === 2 && executed?.skipped_count === 2 && !!executed?.results?.summary,
  executed?.results?.summary);

console.log('\n── database state ──');
console.log(JSON.stringify(fake.db.broadcasts.map(b => ({
  name: b.name, status: b.status, sent: b.sent_count, skipped_window: b.skipped_count,
  template_id: b.template_id, summary: b.results?.summary, scheduled_for: b.scheduled_for,
})), null, 2));

const failed = results.filter(r => !r.ok).length;
if (failed) {
  // GitHub turns these into run annotations, so a failure is readable even when
  // the raw job log cannot be downloaded.
  for (const f of results.filter(r => !r.ok)) console.log(`::error::broadcast smoke — ${f.label}${f.detail ? ` (${f.detail})` : ''}`);
  console.log(`\n${failed} smoke check(s) FAILED\n\nserver log:\n${serverLog.slice(-1500)}`);
} else console.log('\nAll broadcast-window smoke checks passed ✅');

server.kill('SIGTERM');
graph.closeAllConnections?.();
graph.close();
await fake.stop();
process.exit(failed ? 1 : 0);
