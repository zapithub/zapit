import assert from 'node:assert/strict';
import { PLAN_LIMITS, PLAN_ORDER, getPricingForLocation, formatPrice } from '../../src/config/plans.js';

console.log('▶ plans.test');

assert.ok(PLAN_ORDER.includes('free') && PLAN_ORDER.includes('agency'));
console.log('  ✅ PLAN_ORDER');

assert.equal(PLAN_LIMITS.free.whatsapp_replies, 100);
assert.equal(PLAN_LIMITS.creator.price.NGN, 10000);
assert.equal(PLAN_LIMITS.agency.products_limit, 9999);
console.log('  ✅ PLAN_LIMITS values');

assert.equal(formatPrice(25000, 'NGN'), '₦25,000');
assert.equal(formatPrice(12, 'USD'), '$12');
console.log('  ✅ formatPrice');

const loc = { country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' };
const pricing = getPricingForLocation(loc);
assert.equal(pricing.plans.creator.price_raw, 10000);
assert.equal(pricing.plans.creator.currency, 'NGN');
assert.equal(pricing.plans.free.price_raw, 0);
console.log('  ✅ getPricingForLocation NGN');

const locUS = { country_code:'US', country_name:'United States', city:'NY', currency:'USD', timezone:'America/New_York' };
const pricingUS = getPricingForLocation(locUS);
assert.equal(pricingUS.plans.growth.price_raw, 30);
console.log('  ✅ getPricingForLocation USD');

console.log('✅ plans.test passed\n');
