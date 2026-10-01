#!/usr/bin/env node
// Generate public/pricing.json from single source of truth (src/config/plans.js)
// Run: node scripts/generate-pricing.mjs
import { PLAN_LIMITS, getPricingForLocation } from '../src/config/plans.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const locations = [
  { country_code:'NG', country_name:'Nigeria', city:'Lagos', currency:'NGN', timezone:'Africa/Lagos' },
  { country_code:'GH', country_name:'Ghana', city:'Accra', currency:'GHS', timezone:'Africa/Accra' },
  { country_code:'KE', country_name:'Kenya', city:'Nairobi', currency:'KES', timezone:'Africa/Nairobi' },
  { country_code:'ZA', country_name:'South Africa', city:'Johannesburg', currency:'ZAR', timezone:'Africa/Johannesburg' },
  { country_code:'US', country_name:'United States', city:'New York', currency:'USD', timezone:'America/New_York' },
];

const out = {};
for (const loc of locations) {
  out[loc.currency] = getPricingForLocation(loc);
}
out._meta = { generated_at: new Date().toISOString(), source: 'src/config/plans.js', currencies: Object.keys(PLAN_LIMITS.free.price) };

const dest = path.join(__dirname, '../public/pricing.json');
fs.mkdirSync(path.dirname(dest), { recursive:true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`Wrote ${dest} (${Object.keys(out).length-1} currencies)`);
