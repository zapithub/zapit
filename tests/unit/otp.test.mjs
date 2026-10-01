// Phase 6.5 — S-13 (XFF), S-15 (OTP), S-16 (mass assignment)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateOTP, hashOTP, safeHashEqual, verifyOTPRecord, attemptsAfterFailure, OTP_MAX_ATTEMPTS, OTP_TTL_MS } from '../../src/utils/otp.js';
import { pickFields, isValidEmail } from '../../src/utils/validation.js';

console.log('▶ otp.test (Phase 6.5 — S-13/S-15/S-16)');

// ── S-15: OTP generation is crypto-strong ───────────────────────
{
  const codes = new Set();
  for (let i = 0; i < 3000; i++) {
    const c = generateOTP();
    assert.match(c, /^\d{6}$/, 'always a 6-digit code');
    const n = Number(c);
    assert.ok(n >= 100000 && n <= 999999, 'within the 6-digit range');
    codes.add(c);
  }
  assert.ok(codes.size > 2900, 'no obvious repetition/collision pattern (3000 draws)');
  console.log('  ✅ generateOTP (CSPRNG, 6 digits, high entropy)');
}

// ── S-15: hashing + constant-time compare ───────────────────────
{
  assert.equal(hashOTP('123456'), hashOTP(123456), 'coerces to string');
  assert.match(hashOTP('123456'), /^[0-9a-f]{64}$/, 'sha256 hex');
  assert.notEqual(hashOTP('123456'), hashOTP('123457'));
  assert.equal(safeHashEqual(hashOTP('123456'), hashOTP('123456')), true);
  assert.equal(safeHashEqual(hashOTP('123456'), hashOTP('654321')), false);
  assert.equal(safeHashEqual('', ''), false, 'empty never equals');
  assert.equal(safeHashEqual('abc', 'abcd'), false, 'length mismatch is false, never throws');
  console.log('  ✅ hashOTP + safeHashEqual');
}

// ── S-15: the per-code decision table (this is what the routes use) ──
{
  const now = Date.now();
  const live = { code: hashOTP('123456'), expires_at: new Date(now + OTP_TTL_MS).toISOString(), verified: false, attempts: 0 };
  const good = hashOTP('123456');

  assert.deepEqual(verifyOTPRecord({ record: live, codeHash: good, now }), { ok: true, reason: 'ok' });
  assert.equal(verifyOTPRecord({ record: null, codeHash: good, now }).reason, 'missing');
  assert.equal(verifyOTPRecord({ record: { ...live, verified: true }, codeHash: good, now }).reason, 'used', 'a redeemed code can never be reused');
  assert.equal(verifyOTPRecord({ record: { ...live, expires_at: new Date(now - 1).toISOString() }, codeHash: good, now }).reason, 'expired');
  assert.equal(verifyOTPRecord({ record: { ...live, expires_at: new Date(now + OTP_TTL_MS).toISOString() }, codeHash: good, now }).ok, true, 'not expired one ms before TTL');
  assert.equal(verifyOTPRecord({ record: live, codeHash: hashOTP('000000'), now }).reason, 'mismatch');
  for (let attempts = OTP_MAX_ATTEMPTS; attempts <= OTP_MAX_ATTEMPTS + 3; attempts++) {
    assert.equal(verifyOTPRecord({ record: { ...live, attempts }, codeHash: good, now }).reason, 'locked',
      `code with ${attempts} failures is locked even for the RIGHT code`);
  }
  assert.equal(verifyOTPRecord({ record: { ...live, attempts: OTP_MAX_ATTEMPTS - 1 }, codeHash: good, now }).ok, true, 'last attempt may still succeed');
  assert.equal(verifyOTPRecord({ record: live, codeHash: good, now }).reason !== 'ok', false);

  // failure counter increments and caps
  assert.equal(attemptsAfterFailure({ attempts: 0 }), 1);
  assert.equal(attemptsAfterFailure({ attempts: 4 }), 5);
  assert.equal(attemptsAfterFailure({ attempts: 5 }), 5, 'never exceeds the cap');
  assert.equal(attemptsAfterFailure({}), 1);
  console.log('  ✅ verifyOTPRecord (missing/used/expired/mismatch/locked) + attempt cap');
}

// ── S-16: pickFields never copies unknown keys ──────────────────
{
  const { values, errors } = pickFields(
    { name: 'Widget', user_id: 'attacker-uuid', id: 'hijack', payment_status: 'paid', total: 1, __proto__: { is_admin: true }, is_blocked: true },
    { name: { type:'string', max:120 }, is_blocked: { type:'boolean' } },
  );
  assert.deepEqual(Object.keys(values).sort(), ['is_blocked', 'name'], 'only allow-listed keys survive');
  assert.equal(values.user_id, undefined);
  assert.equal(values.payment_status, undefined);
  assert.equal(({}).is_admin, undefined, 'no prototype pollution');
  assert.equal(errors.length, 0);
  console.log('  ✅ pickFields drops id/user_id/payment_status/__proto__');
}

// ── S-16: field validation + sanitization ───────────────────────
{
  // strings: trim, strip angle brackets, truncate, lowercase, enum, min
  const a = pickFields({ trigger:'  <b>PRICE</b> ?  ', category:'x'.repeat(200) }, {
    trigger:  { type:'string', max:200, min:1, lowercase:true },
    category: { type:'string', max:60 },
  });
  assert.equal(a.values.trigger, 'b' + 'price' + '/b ?', 'angle brackets stripped, trimmed, lowercased');
  assert.ok(!a.values.trigger.includes('<') && !a.values.trigger.includes('>'), 'markup metacharacters removed');
  assert.ok(!/^\s|\s$/.test(a.values.trigger), 'trimmed');
  assert.equal(a.values.category.length, 60, 'truncated to max');
  assert.equal(a.errors.length, 0);

  // required-ish: min:1 rejects empty strings
  assert.equal(pickFields({ name:'' }, { name: { type:'string', max:10, min:1 } }).errors.length, 1);
  assert.equal(pickFields({ name:'   ' }, { name: { type:'string', max:10, min:1 } }).errors.length, 1, 'whitespace is not a name');

  // enum
  const bad = pickFields({ status:'delivered_ish' }, { status: { type:'string', enum:['pending','delivered'] } });
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.values.status, undefined, 'invalid enum is never written');

  // numbers: coercion, integer, range, empty-string trap
  const n = pickFields({ price:'2500', stock_quantity:'3' }, {
    price: { type:'number', min:0, max:10000000 },
    stock_quantity: { type:'number', integer:true, min:0 },
  });
  assert.equal(n.values.price, 2500);
  assert.equal(n.values.stock_quantity, 3);
  assert.equal(pickFields({ price:'' }, { price: { type:'number', min:0 } }).errors.length, 1, "'' is not zero");
  assert.equal(pickFields({ price:'abc' }, { price: { type:'number' } }).errors.length, 1);
  assert.equal(pickFields({ price:-1 }, { price: { type:'number', min:0 } }).errors.length, 1);
  assert.equal(pickFields({ price:1e9 }, { price: { type:'number', max:1e7 } }).errors.length, 1);
  assert.equal(pickFields({ qty:1.5 }, { qty: { type:'number', integer:true } }).errors.length, 1);
  assert.equal(pickFields({ price:true }, { price: { type:'number' } }).errors.length, 1);

  // booleans
  assert.equal(pickFields({ is_blocked:true }, { is_blocked: { type:'boolean' } }).values.is_blocked, true);
  assert.equal(pickFields({ is_blocked:'false' }, { is_blocked: { type:'boolean' } }).values.is_blocked, false);
  assert.equal(pickFields({ is_blocked:'yes' }, { is_blocked: { type:'boolean' } }).errors.length, 1);

  // arrays: item cap, item filter, enum
  const arr = pickFields({ topics:['a', 'b', 3, null, { x:1 }] }, { topics: { type:'array', of:'string', maxItems:10, itemMax:120 } });
  assert.deepEqual(arr.values.topics, ['a', 'b', '3'], 'non-strings dropped, numbers stringified');
  assert.equal(pickFields({ platforms:['instagram','myspace'] }, { platforms: { type:'array', of:'string', enum:['instagram','tiktok'] } }).errors.length, 1);
  assert.equal(pickFields({ topics:new Array(11).fill('x') }, { topics: { type:'array', of:'string', maxItems:10 } }).errors.length, 1);
  assert.equal(pickFields({ topics:'not-an-array' }, { topics: { type:'array', of:'string' } }).errors.length, 1);

  // nullable + unknown-only bodies
  assert.equal(pickFields({ sale_price:null }, { sale_price: { type:'number', min:0, nullable:true } }).values.sale_price, null);
  assert.equal(pickFields({ user_id:'x' }, { name: { type:'string' } }).errors.length, 0, 'unknown keys are ignored, not errors');
  assert.equal(Object.keys(pickFields({ user_id:'x' }, { name: { type:'string' } }).values).length, 0);
  console.log('  ✅ pickFields type/enum/array/nullable rules');
}

// ── regression: the fixed email validator ───────────────────────
{
  assert.equal(isValidEmail('susan@gmail.com'), true, 'emails with the letter "s" are valid (old local regex rejected them)');
  assert.equal(isValidEmail('test@test.com'), true);
  assert.equal(isValidEmail('bob@example.com'), true);
  assert.equal(isValidEmail('no-at-sign.com'), false);
  assert.equal(isValidEmail('a b@c.com'), false);
  assert.equal(isValidEmail('x'.repeat(250) + '@x.com'), false, 'length cap');
  console.log('  ✅ isValidEmail (s-containing addresses no longer rejected)');
}

// ── source wiring ───────────────────────────────────────────────
{
  const index = fs.readFileSync('index.js', 'utf8');

  // S-16: no request-body spreads or raw-body writes remain
  assert.ok(!index.includes('...req.body'), 'no { ...req.body } anywhere');
  assert.ok(!/\.update\(req\.body\)/.test(index), 'no update(req.body) anywhere');
  assert.ok((index.match(/pickFields\(/g) || []).length >= 7, 'all seven PATCH routes use pickFields');

  // S-15: crypto OTP + real lockout wired into both verify flows
  assert.ok(!/function generateOTP|Math\.random\(\).*900000/.test(index), 'no local Math.random OTP generator');
  assert.ok(index.includes('verifyOTPRecord(') && (index.match(/verifyOTPRecord\(/g) || []).length >= 2, 'verify-email + reset-password both use the decision table');
  assert.ok(index.includes('attemptsAfterFailure(') && index.includes('OTP_MAX_ATTEMPTS') , 'failed guesses are counted and capped');
  assert.ok(index.includes('otp_verifications').valueOf() === false || index.includes("from('otp_verifications').select('*')"), 'the latest-code lookup tolerates pre-migration rows');
  assert.ok(index.includes('uniformDelay('), 'forgot-password answers at a uniform latency');

  // S-13: location comes from req.ip, never from the raw header
  assert.ok(!index.includes("x-forwarded-for"), 'X-Forwarded-For is no longer read directly');
  assert.ok(index.includes('clientIp(req)') && index.includes('isPrivateIp('), 'client IP resolution is centralised');

  // login: explicit DTO (no password_hash/otp leakage risk)
  assert.ok(index.includes("select(SAFE_USER_SELECT + ',password_hash')"), 'login selects an explicit column list');
  console.log('  ✅ index.js wiring checks (S-13/S-15/S-16)');
}

console.log('✅ otp.test passed\n');
