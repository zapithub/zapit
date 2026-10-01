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
