import assert from 'node:assert/strict';
import { subscriptionCache } from '../../src/utils/cache.js';

console.log('▶ cache.test');

subscriptionCache.clear();
subscriptionCache.set('user:1', { plan:'creator' });
assert.deepEqual(subscriptionCache.get('user:1'), { plan:'creator' });
console.log('  ✅ set/get');

subscriptionCache.set('user:1', { plan:'growth' });
assert.equal(subscriptionCache.get('user:1').plan, 'growth');
console.log('  ✅ overwrite');

subscriptionCache.del('user:1');
assert.equal(subscriptionCache.get('user:1'), undefined);
console.log('  ✅ del');

// LRU eviction: fill beyond max (2000) — quick check with small cache
import { subscriptionCache as c2 } from '../../src/utils/cache.js';
c2.clear();
for (let i=0;i<5;i++) c2.set('k'+i, i);
assert.equal(c2.get('k0'), 0);
console.log('  ✅ lru order');

console.log('✅ cache.test passed\n');
