import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { verifyMetaSignature, verifyWebhookVerifyToken, claimWebhookEvent, timingSafeEqualStr } from '../../src/utils/webhook.js';

console.log('▶ webhook.test (Phase 6.2)');

// ── Helpers under test: real HMAC-SHA256 like Meta sends ────────
const SECRET = 'meta-app-secret-0123456789abcdef';
const BODY = Buffer.from(JSON.stringify({ object:'whatsapp_business_account', entry:[{ id:'123' }] }), 'utf8');
function sign(body, secret = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// S-05: valid signature accepted (Buffer body)
assert.equal(verifyMetaSignature(BODY, sign(BODY), SECRET), true, 'valid Buffer signature');
// S-05: valid signature accepted (string body, same bytes)
assert.equal(verifyMetaSignature(BODY.toString('utf8'), sign(BODY), SECRET), true, 'valid string signature');
// S-05: tampered body rejected (signature over original)
const tampered = Buffer.from(BODY.toString('utf8').replace('123', '999'), 'utf8');
assert.equal(verifyMetaSignature(tampered, sign(BODY), SECRET), false, 'tampered body rejected');
// S-05: wrong secret rejected
assert.equal(verifyMetaSignature(BODY, sign(BODY, 'other-secret'), SECRET), false, 'wrong secret rejected');
// S-05: empty/missing app secret rejected (fail closed)
assert.equal(verifyMetaSignature(BODY, sign(BODY), ''), false, 'empty secret rejected');
assert.equal(verifyMetaSignature(BODY, sign(BODY), undefined), false, 'undefined secret rejected');
// S-05: malformed headers rejected
assert.equal(verifyMetaSignature(BODY, undefined, SECRET), false, 'missing header rejected');
assert.equal(verifyMetaSignature(BODY, '', SECRET), false, 'empty header rejected');
assert.equal(verifyMetaSignature(BODY, 'sha256=', SECRET), false, 'empty digest rejected');
assert.equal(verifyMetaSignature(BODY, 'sha256=zzzz', SECRET), false, 'non-hex digest rejected');
assert.equal(verifyMetaSignature(BODY, 'sha1=' + crypto.createHmac('sha1', SECRET).update(BODY).digest('hex'), SECRET), false, 'legacy sha1 rejected');
assert.equal(verifyMetaSignature(BODY, sign(BODY).toUpperCase().replace('SHA256=', 'sha256='), SECRET), true, 'hex case-insensitive');
// S-05: non-body values rejected instead of being stringified
assert.equal(verifyMetaSignature({}, sign(BODY), SECRET), false, 'object body rejected');
assert.equal(verifyMetaSignature(null, sign(BODY), SECRET), false, 'null body rejected');
// S-05: signature valid for a different body does not transfer
assert.equal(verifyMetaSignature(Buffer.from('{}'), sign(BODY), SECRET), false, 'different body rejected');
console.log('  ✅ verifyMetaSignature (valid/tampered/wrong-secret/malformed/sha1)');

// ── Verify-token handshake (constant-time, fail-closed) ─────────
assert.equal(verifyWebhookVerifyToken('subscribe', 'good-token-123', 'good-token-123'), true, 'correct token');
assert.equal(verifyWebhookVerifyToken('subscribe', 'good-token-123', 'other-token'), false, 'wrong token');
assert.equal(verifyWebhookVerifyToken('subscribe', 'good-token-123', 'good-token'), false, 'prefix token rejected (length)');
assert.equal(verifyWebhookVerifyToken('subscribe', 'good-token-123', ''), false, 'empty expected rejected');
assert.equal(verifyWebhookVerifyToken('subscribe', 'good-token-123', undefined), false, 'missing expected rejected');
assert.equal(verifyWebhookVerifyToken('subscribe', '', 'good-token-123'), false, 'empty provided rejected');
assert.equal(verifyWebhookVerifyToken('unsubscribe', 'good-token-123', 'good-token-123'), false, 'wrong mode rejected');
assert.equal(verifyWebhookVerifyToken(undefined, 'good-token-123', 'good-token-123'), false, 'missing mode rejected');
assert.equal(verifyWebhookVerifyToken('subscribe', 123, 'good-token-123'), false, 'non-string provided rejected');
console.log('  ✅ verifyWebhookVerifyToken (fail-closed)');

// ── timingSafeEqualStr basics ───────────────────────────────────
assert.equal(timingSafeEqualStr('abc', 'abc'), true);
assert.equal(timingSafeEqualStr('abc', 'abd'), false);
assert.equal(timingSafeEqualStr('abc', 'ab'), false);
assert.equal(timingSafeEqualStr('abc', 123), false);
console.log('  ✅ timingSafeEqualStr');

// ── Replay claim (webhook_events unique violation → duplicate) ──
function fakeDb(result) { return { from: () => ({ insert: async () => result }) }; }
assert.equal(await claimWebhookEvent(fakeDb({ error:null }), 'whatsapp', 'wamid.AAA', { from:'234' }), true, 'first claim');
assert.equal(await claimWebhookEvent(fakeDb({ error:{ code:'23505', message:'duplicate key' } }), 'whatsapp', 'wamid.AAA'), false, 'duplicate → false');
assert.equal(await claimWebhookEvent(fakeDb({ error:{ code:'42P01', message:'missing table' } }), 'whatsapp', 'wamid.BBB'), true, 'infra error → fail open');
assert.equal(await claimWebhookEvent({ }, 'whatsapp', 'wamid.CCC'), true, 'no db → no dedup');
assert.equal(await claimWebhookEvent(null, 'whatsapp', 'wamid.CCC'), true, 'null db → no dedup');
assert.equal(await claimWebhookEvent(fakeDb({ error:null }), 'whatsapp', ''), true, 'empty event id → no claim');
const throwingDb = { from: () => ({ insert: async () => { throw new Error('network'); } }) };
assert.equal(await claimWebhookEvent(throwingDb, 'whatsapp', 'wamid.DDD'), true, 'throw → fail open');
console.log('  ✅ claimWebhookEvent');

// ── File-content checks (implementation wired the safe way) ─────
const index = fs.readFileSync('index.js', 'utf8');
assert.ok(index.includes("from './src/utils/webhook.js'"), 'index imports webhook helpers (single source)');
assert.ok(index.includes("app.use('/webhook/whatsapp', express.raw("), 'raw body middleware before json');
assert.ok(index.includes("req.headers['x-hub-signature-256']"), 'POST uses X-Hub-Signature-256');
assert.ok(index.includes('verifyMetaSignature(raw, req.headers'), 'POST verifies raw bytes');
assert.ok(index.includes("status(503).json({ success:false, error:'Webhook not configured.' })"), 'production fail-closed 503');
assert.ok(index.includes('status(401).json({ success:false, error:\'Invalid signature.\' })'), 'invalid signature → 401');
assert.ok(index.includes("claimWebhookEvent(supabase, 'whatsapp', msgId"), 'replay claim for wamid');
assert.ok(index.includes('verifyWebhookVerifyToken(mode, token, WA_VERIFY_TOKEN)'), 'GET handshake uses constant-time verifier');
assert.ok(!index.includes('token === WA_VERIFY_TOKEN'), 'old === verify-token compare removed');
assert.ok(index.includes('WA_SIGNATURE_SECRET = WA_APP_SECRET || META_APP_SECRET'), 'app secret resolved');
assert.ok(!index.includes('Resend signature') && !index.includes('skip signature verification in production'), 'no signature bypass in source');
console.log('  ✅ index.js wiring checks (S-05)');

console.log('✅ webhook.test passed\n');
