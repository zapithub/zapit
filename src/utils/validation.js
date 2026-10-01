// ZAPIT — Central Validation & Sanitization (Phase 2)
// World-class: single source for every route's input contract.
// No zod dep in Phase 2 to keep bundle lean; lightweight helpers + future zod migration path.

export function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}
export function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(u);
}
export function isStrongPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) return 'Password must be 8-128 characters.';
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must include uppercase, lowercase and a number.';
  if (/^(.)\1+$/.test(p)) return 'Password is too weak.';
  return null;
}
export function sanitizeStr(s, max = 500) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max).replace(/[<>]/g, '');
}
export function validateBody(schema, data) {
  const errors = [];
  for (const [key, rule] of Object.entries(schema)) {
    const val = data[key];
    if (rule.required && (val === undefined || val === null || String(val).trim() === '')) {
      errors.push(`${key} is required.`); continue;
    }
    if (val === undefined || val === null) continue;
    if (rule.type && typeof val !== rule.type) { errors.push(`${key} must be a ${rule.type}.`); continue; }
    if (rule.min && String(val).length < rule.min) errors.push(`${key} must be at least ${rule.min} chars.`);
    if (rule.max && String(val).length > rule.max) errors.push(`${key} must be at most ${rule.max} chars.`);
    if (rule.pattern && !rule.pattern.test(String(val))) errors.push(rule.message || `${key} is invalid.`);
    if (rule.validate) { const msg = rule.validate(val); if (msg) errors.push(msg); }
  }
  return errors;
}

export const SCHEMAS = {
  register: {
    email: { required: true, type: 'string', validate: v => isValidEmail(v) ? null : 'Valid email is required.' },
    username: { required: true, type: 'string', validate: v => isValidUsername(v) ? null : 'Username 3-30 chars, letters/numbers/underscore.' },
    password: { required: true, type: 'string' },
  },
  login: {
    email: { required: true, type: 'string', validate: v => isValidEmail(v) ? null : 'Valid email is required.' },
    password: { required: true, type: 'string' },
  },
  product: {
    name: { required: true, type: 'string', min: 1, max: 120 },
    price: { required: true, validate: v => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1e7) ? null : 'Invalid price.' },
  },
  knowledgeBase: {
    trigger: { required: true, type: 'string', min: 1, max: 200 },
    response: { required: true, type: 'string', min: 1, max: 2000 },
  },
  schedule: {
    content_id: { required: true, type: 'string' },
    platforms: { required: true, validate: v => Array.isArray(v) && v.length >=1 && v.length <=4 ? null : 'platforms 1-4 required.' },
    scheduled_for: { required: true, type: 'string' },
  },
  businessInfo: {
    business_name: { required: true, type: 'string', min: 1, max: 120 },
  }
};

// Pagination helper — enforces max 100, defaults to 20
export function parsePagination(query, defaults = { page:1, limit:20, maxLimit:100 }) {
  let page = parseInt(query.page, 10) || defaults.page;
  let limit = parseInt(query.limit, 10) || defaults.limit;
  page = Math.max(1, page);
  limit = Math.min(defaults.maxLimit, Math.max(1, limit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * S-16 — allow-list a request body into a DB payload.
 *
 * Unknown keys are NEVER copied (kills mass assignment), types are enforced,
 * strings are trimmed/sanitized/truncated, and prototype-polluting keys are
 * dropped even if a caller forgets to exclude them.
 *
 * Rule shape (per field):
 *   { type:'string',  max:120, min:0, nullable:false, sanitize:true, lowercase:false, enum:[...] }
 *   { type:'number',  min:0, max:1e7, integer:false, nullable:true }
 *   { type:'boolean', nullable:false }
 *   { type:'array',   of:'string', itemMax:60, maxItems:10 }
 *
 * @returns {{ values: object, errors: string[] }}
 */
export function pickFields(body, schema) {
  const values = {};
  const errors = [];
  const src = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  for (const [key, rule] of Object.entries(schema)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const raw = src[key];

    if (raw === null || raw === undefined) {
      if (rule.nullable) { values[key] = null; continue; }
      if (rule.type === 'string' && rule.allowEmpty !== false) { values[key] = rule.sanitize === false ? '' : ''; continue; }
      errors.push(`${key} cannot be empty.`);
      continue;
    }

    if (rule.type === 'string') {
      if (typeof raw !== 'string' && typeof raw !== 'number') { errors.push(`${key} must be a string.`); continue; }
      let v = String(raw);
      const capped = rule.max ? v.slice(0, rule.max) : v;
      v = rule.sanitize === false ? capped.trim() : sanitizeStr(capped, rule.max || 500);
      if (rule.lowercase) v = v.toLowerCase();
      if (rule.min && v.length < rule.min) { errors.push(`${key} must be at least ${rule.min} characters.`); continue; }
      if (rule.required && !v) { errors.push(`${key} is required.`); continue; }
      if (rule.enum && !rule.enum.includes(v)) { errors.push(`${key} must be one of: ${rule.enum.join(', ')}.`); continue; }
      if (rule.pattern && !rule.pattern.test(v)) { errors.push(rule.message || `${key} is invalid.`); continue; }
      values[key] = v;
      continue;
    }

    if (rule.type === 'number') {
      if (typeof raw === 'string' && raw.trim() === '') { errors.push(`${key} must be a number.`); continue; }
      if (typeof raw === 'boolean' || raw === null || Array.isArray(raw) || typeof raw === 'object') { errors.push(`${key} must be a number.`); continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) { errors.push(`${key} must be a number.`); continue; }
      if (rule.integer && !Number.isInteger(n)) { errors.push(`${key} must be a whole number.`); continue; }
      if (rule.min !== undefined && n < rule.min) { errors.push(`${key} must be at least ${rule.min}.`); continue; }
      if (rule.max !== undefined && n > rule.max) { errors.push(`${key} must be at most ${rule.max}.`); continue; }
      values[key] = n;
      continue;
    }

    if (rule.type === 'boolean') {
      if (typeof raw === 'boolean') { values[key] = raw; continue; }
      if (raw === 'true' || raw === 'false') { values[key] = raw === 'true'; continue; }
      errors.push(`${key} must be true or false.`);
      continue;
    }

    if (rule.type === 'array') {
      if (!Array.isArray(raw)) { errors.push(`${key} must be an array.`); continue; }
      const maxItems = rule.maxItems || 20;
      if (raw.length > maxItems) { errors.push(`${key} may contain at most ${maxItems} items.`); continue; }
      let items = raw;
      if (rule.of === 'string') {
        items = raw
          .filter(v => typeof v === 'string' || typeof v === 'number')
          .map(v => sanitizeStr(String(v), rule.itemMax || 120))
          .filter(Boolean);
        if (rule.enum && items.some(v => !rule.enum.includes(v))) { errors.push(`${key} contains an invalid value.`); continue; }
      }
      values[key] = items;
      continue;
    }

    errors.push(`${key} is not a supported field.`);
  }
  return { values, errors };
}
