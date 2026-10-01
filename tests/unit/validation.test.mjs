import assert from 'node:assert/strict';
import { isValidEmail, isValidUsername, isStrongPassword, sanitizeStr, validateBody, parsePagination } from '../../src/utils/validation.js';

console.log('▶ validation.test');

// isValidEmail
assert.equal(isValidEmail('test@example.com'), true);
assert.equal(isValidEmail('bad'), false);
assert.equal(isValidEmail('a'.repeat(250)+'@x.com'), false);
console.log('  ✅ isValidEmail');

// isValidUsername
assert.equal(isValidUsername('john_doe'), true);
assert.equal(isValidUsername('ab'), false);
assert.equal(isValidUsername('toolongusername_exceeding_thirty_chars'), false);
console.log('  ✅ isValidUsername');

// isStrongPassword
assert.equal(isStrongPassword('short'), 'Password must be 8-128 characters.');
assert.equal(isStrongPassword('alllowercase1'), 'Password must include uppercase, lowercase and a number.');
assert.equal(isStrongPassword('ValidPass1'), null);
console.log('  ✅ isStrongPassword');

// sanitizeStr
assert.equal(sanitizeStr('<script>alert(1)</script>', 100), 'scriptalert(1)/script');
assert.equal(sanitizeStr(' hello ', 10), 'hello');
console.log('  ✅ sanitizeStr');

// validateBody
assert.deepEqual(validateBody({ email:{required:true, type:'string', validate:v=> isValidEmail(v)?null:'bad'} }, { email:'bad' }), ['bad']);
assert.deepEqual(validateBody({ name:{required:true, type:'string'} }, { name:'' }), ['name is required.']);
console.log('  ✅ validateBody');

// parsePagination
assert.deepEqual(parsePagination({page:'2', limit:'10'}), {page:2, limit:10, offset:10});
assert.deepEqual(parsePagination({page:'0', limit:'1000'}, {page:1, limit:20, maxLimit:100}), {page:1, limit:100, offset:0});
console.log('  ✅ parsePagination');

console.log('✅ validation.test passed\n');
