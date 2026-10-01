import assert from 'node:assert/strict';

console.log('▶ health.test (integration, requires running server)');

// This test is skipped if no server. Run: PORT=3001 node index.js & npm run test:integration
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

try {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.ok(data.services);
  console.log('  ✅ /health 200 + status ok');
  console.log('  ✅ health.test passed (live)\n');
} catch (e) {
  if (e.code === 'ECONNREFUSED' || String(e.message).includes('fetch failed')) {
    console.log('  ⏭  health.test skipped — no server at', base);
    console.log('  (run: PORT=3000 node index.js & npm run test:integration)\n');
  } else {
    console.error('  ❌ health.test failed', e);
    process.exit(1);
  }
}
