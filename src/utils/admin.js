// ZAPIT — Admin Security Helpers (Phase 6.1)
// World-class: single source for reserved-username, admin-secret constant-time, safe user select.
// This module is the source of truth; index.js inlines the same logic (kept in sync).

import crypto from 'node:crypto';

export const RESERVED_USERNAMES = new Set([
  'admin','root','support','zapit','api','system','moderator','owner','superuser',
  'help','info','contact','service','zapithub','zapit_admin','administrator',
  'security','billing','abuse','postmaster','webmaster',
]);

export function isReservedUsername(uname, adminUsernamesEnv = 'admin') {
  if (!uname || typeof uname !== 'string') return false;
  const lower = uname.toLowerCase().trim();
  if (RESERVED_USERNAMES.has(lower)) return true;
  const adminList = String(adminUsernamesEnv).split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
  if (adminList.includes(lower)) return true;
  return false;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  try { return crypto.timingSafeEqual(bufA, bufB); } catch { return false; }
}

export function hasValidAdminSecret(headerVal, adminSecret) {
  if (!adminSecret) return false;
  if (!headerVal || typeof headerVal !== 'string') return false;
  return safeEqual(String(headerVal), String(adminSecret));
}

export const SAFE_USER_SELECT = 'id,email,username,full_name,avatar_url,country_code,currency,timezone,language,phone,whatsapp_number,email_verified,phone_verified,referral_code,role,is_active,is_suspended,suspension_reason,created_at,last_login';
export const SAFE_USER_SELECT_PUBLIC = 'id,email,username,full_name,avatar_url,country_code,currency,email_verified,role,is_active,is_suspended,created_at,last_login';

export function sanitizeUserDto(user) {
  if (!user || typeof user !== 'object') return null;
  const out = {};
  for (const col of SAFE_USER_SELECT.split(',')) {
    if (col in user) out[col] = user[col];
  }
  delete out.password_hash;
  delete out.otp_code;
  delete out.otp_secret;
  return out;
}
