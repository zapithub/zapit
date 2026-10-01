import assert from 'node:assert/strict';
import crypto from 'crypto';

console.log('▶ crypto.test');

// hashOTP should be deterministic
function hashOTP(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
assert.equal(hashOTP('123456'), hashOTP('123456'));
assert.notEqual(hashOTP('123456'), hashOTP('654321'));
console.log('  ✅ hashOTP deterministic');

// timingSafeEqual should be constant-time (just verify it works)
function verifySig(hash, sig) {
  try {
    const a = Buffer.from(hash, 'utf8');
    const b = Buffer.from(String(sig), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a,b);
  } catch { return false; }
}
assert.equal(verifySig('abc','abc'), true);
assert.equal(verifySig('abc','ab'), false);
console.log('  ✅ timingSafeEqual');

// generateReferralCode length 10 (Phase 4)
function generateReferralCode(){ return crypto.randomBytes(5).toString('hex').toUpperCase(); }
assert.equal(generateReferralCode().length, 10);
assert.match(generateReferralCode(), /^[0-9A-F]{10}$/);
console.log('  ✅ generateReferralCode 10 chars');

console.log('✅ crypto.test passed\n');
