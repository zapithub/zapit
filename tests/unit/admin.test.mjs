import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isReservedUsername, safeEqual, hasValidAdminSecret, SAFE_USER_SELECT, SAFE_USER_SELECT_PUBLIC, sanitizeUserDto, RESERVED_USERNAMES } from '../../src/utils/admin.js';

console.log('▶ admin.test (Phase 6.1)');

// S-01: reserved usernames
assert.equal(isReservedUsername('admin'), true, 'admin reserved');
assert.equal(isReservedUsername('Admin'), true, 'case-insensitive');
assert.equal(isReservedUsername('ADMIN'), true);
assert.equal(isReservedUsername('root'), true);
assert.equal(isReservedUsername('support'), true);
assert.equal(isReservedUsername('zapit'), true);
assert.equal(isReservedUsername('system'), true);
assert.equal(isReservedUsername('moderator'), true);
assert.equal(isReservedUsername('api'), true);
assert.equal(isReservedUsername('zapithub'), true);
assert.equal(isReservedUsername('administrator'), true);
assert.equal(isReservedUsername('  admin  '), true, 'trim');
assert.equal(isReservedUsername('john_doe'), false, 'normal username not reserved');
assert.equal(isReservedUsername('admin123'), false, 'admin123 not reserved (exact match only)');
assert.equal(isReservedUsername('myadmin'), false);
assert.equal(isReservedUsername(''), false);
assert.equal(isReservedUsername(null), false);
assert.equal(isReservedUsername(undefined), false);
// env admin list: custom admin usernames also reserved
assert.equal(isReservedUsername('customadmin', 'customadmin,other'), true, 'env admin list reserved');
assert.equal(isReservedUsername('other', 'customadmin,other'), true);
assert.equal(isReservedUsername('notreserved', 'customadmin,other'), false);
console.log('  ✅ isReservedUsername');

// S-02: safeEqual constant-time
assert.equal(safeEqual('abc', 'abc'), true);
assert.equal(safeEqual('abc', 'abd'), false);
assert.equal(safeEqual('abc', 'ab'), false, 'different length false');
assert.equal(safeEqual('', ''), true);
assert.equal(safeEqual('secret', 'secret'), true);
assert.equal(safeEqual('secret', 'Secret'), false);
assert.equal(safeEqual(null, 'a'), false);
assert.equal(safeEqual(undefined, 'a'), false);
console.log('  ✅ safeEqual');

// S-02: hasValidAdminSecret
assert.equal(hasValidAdminSecret('mysecret', 'mysecret'), true);
assert.equal(hasValidAdminSecret('mysecret', 'wrong'), false);
assert.equal(hasValidAdminSecret('mysecret', undefined), false, 'no env secret => false');
assert.equal(hasValidAdminSecret('mysecret', ''), false);
assert.equal(hasValidAdminSecret(undefined, 'mysecret'), false);
assert.equal(hasValidAdminSecret(null, 'mysecret'), false);
assert.equal(hasValidAdminSecret('undefined', 'undefined'), true, 'string undefined matches — but env undefined case is falsy, so blocked earlier');
assert.equal(hasValidAdminSecret('short', 'longer'), false, 'length mismatch false');
console.log('  ✅ hasValidAdminSecret');

// S-22: SAFE_USER_SELECT must not contain sensitive fields
assert.ok(!SAFE_USER_SELECT.includes('password_hash'), 'SAFE_USER_SELECT must not contain password_hash');
assert.ok(!SAFE_USER_SELECT.includes('otp'), 'SAFE_USER_SELECT must not contain otp');
assert.ok(!SAFE_USER_SELECT.includes('password'), 'no password');
assert.ok(SAFE_USER_SELECT.includes('role'), 'SAFE_USER_SELECT should include role');
assert.ok(SAFE_USER_SELECT.includes('email'), 'should include email');
assert.ok(!SAFE_USER_SELECT_PUBLIC.includes('password_hash'), 'public select no hash');
console.log('  ✅ SAFE_USER_SELECT');

// sanitizeUserDto strips sensitive
const userWithHash = { id:'1', email:'a@b.com', username:'alice', password_hash:'$2a$12$...', otp_code:'123456', role:'user', is_active:true };
const sanitized = sanitizeUserDto(userWithHash);
assert.equal(sanitized.password_hash, undefined, 'hash stripped');
assert.equal(sanitized.otp_code, undefined, 'otp stripped');
assert.equal(sanitized.id, '1');
assert.equal(sanitized.email, 'a@b.com');
assert.equal(sanitized.username, 'alice');
console.log('  ✅ sanitizeUserDto');

// W-07: index.js must not silently fallback
const indexJs = fs.readFileSync('index.js','utf8');
// sendWAMessage helper must throw on missing tenant creds, not fallback
assert.ok(indexJs.includes('Missing tenant WhatsApp credentials'), 'index.js must contain W-07 throw');
assert.ok(!indexJs.match(/async function sendWAMessage[\s\S]{0,300}accessToken \|\| WA_ACCESS_TOKEN/), 'sendWAMessage helper must not fallback (checked via file content)');
assert.ok(indexJs.includes("hasValidAdminSecret"), 'hasValidAdminSecret must be in index.js');
assert.ok(indexJs.includes("isReservedUsername"), 'isReservedUsername must be in index.js');
console.log('  ✅ file content checks (S-22/W-07/S-01)');

console.log('✅ admin.test passed');
