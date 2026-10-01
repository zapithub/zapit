import assert from 'node:assert/strict';
import crypto from 'node:crypto';

console.log('▶ webhook-auth.test (integration, requires running server)');

// Run against a live server:
//   WA_APP_SECRET=… WA_VERIFY_TOKEN=… PORT=3001 node index.js &
//   TEST_BASE_URL=http://127.0.0.1:3001 TEST_WA_APP_SECRET=… node tests/integration/webhook-auth.test.mjs
// Skips like health.test.mjs when no server is reachable.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const secret = process.env.TEST_WA_APP_SECRET;

try {
  // Server reachable? (reuse /health)
  const probe = await fetch(base + '/health');
  assert.equal(probe.status, 200);

  // ── Handshake is constant-time and fail-closed: wrong token ⇒ 403 ──
  const bad = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=definitely-wrong&hub.challenge=1`);
  assert.equal(bad.status, 403, 'wrong verify token must be 403');
  console.log('  ✅ GET handshake wrong token → 403');

  // ── Unsigned POST must never be accepted ──
  const unsigned = await fetch(base + '/webhook/whatsapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: 'whatsapp_business_account' }),
  });
  assert.ok(unsigned.status === 401 || unsigned.status === 503, `unsigned POST rejected (got ${unsigned.status})`);
  console.log(`  ✅ POST unsigned rejected → ${unsigned.status}`);

  if (!secret) {
    console.log('  ⏭  TEST_WA_APP_SECRET not set — HMAC signature matrix skipped');
  } else {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'integration' }] }), 'utf8');
    const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    // Valid signature ⇒ 200 ack (non-message payload: no DB side effects)
    const ok = await fetch(base + '/webhook/whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': good }, body,
    });
    assert.equal(ok.status, 200, 'valid signature must ack 200');
    assert.deepEqual(await ok.json(), { success: true });
    console.log('  ✅ POST valid signature → 200');

    // Tampered signature ⇒ 401
    const tamperedSig = 'sha256=' + 'f'.repeat(64);
    const badSig = await fetch(base + '/webhook/whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': tamperedSig }, body,
    });
    assert.equal(badSig.status, 401, 'tampered signature must be 401');
    console.log('  ✅ POST tampered signature → 401');

    // Signature for a different body ⇒ 401 (no cross-body transfer)
    const body2 = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'other' }] }), 'utf8');
    const cross = await fetch(base + '/webhook/whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': good }, body: body2,
    });
    assert.equal(cross.status, 401, 'signature must not transfer to another body');
    console.log('  ✅ POST cross-body signature → 401');
  }

  console.log('  ✅ webhook-auth.test passed (live)\n');
} catch (e) {
  if (e.code === 'ECONNREFUSED' || String(e.message).includes('fetch failed')) {
    console.log('  ⏭  webhook-auth.test skipped — no server at', base);
    console.log('  (run: WA_APP_SECRET=… node index.js & TEST_WA_APP_SECRET=… npm run test:integration)\n');
  } else {
    console.error('  ❌ webhook-auth.test failed', e);
    process.exit(1);
  }
}
