// ZAPIT — auth cookie helpers (Phase 7.2 — S-09)
// Before 7.2 the browser hand-off put `?token=` in the URL (referrer/log/CDN
// leakage) and could not survive a reload. The API now also issues httpOnly
// cookies: the access token is unreadable from JS, the refresh token is
// path-scoped to /auth, and every cookie-authenticated mutating request must
// echo a readable CSRF token (double submit), which SameSite=Lax also guards.
//
// Bearer tokens keep working unchanged for API/mobile clients.

import crypto from 'crypto';

export const AUTH_ACCESS_COOKIE  = 'zapit_at';
export const AUTH_REFRESH_COOKIE = 'zapit_rt';
export const CSRF_COOKIE         = 'zapit_csrf';
export const CSRF_HEADER         = 'x-csrf-token';
export const REFRESH_COOKIE_PATH = '/auth';   // refresh cookie is only sent to /auth/*
export const CSRF_SAFE_METHODS   = ['GET', 'HEAD', 'OPTIONS'];

/** Cookie mode is operator-configurable (cross-site frontends need SameSite=None + Secure). */
export function cookieSecurity(env = process.env) {
  const raw = String(env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
  return {
    secure:   env.AUTH_COOKIE_SECURE !== undefined ? env.AUTH_COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    sameSite: ['lax', 'strict', 'none'].includes(raw) ? raw : 'lax',
    domain:   env.AUTH_COOKIE_DOMAIN || null,
  };
}

export function isMutating(method) {
  return !CSRF_SAFE_METHODS.includes(String(method || 'GET').toUpperCase());
}

export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, path = '/', secure = false, sameSite = 'lax', domain = null } = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ''))}`, `Path=${path}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    if (!key) return;
    const raw = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
  });
  return out;
}

/** Timing-safe double-submit comparison (header must equal the readable cookie). */
export function csrfMatches(req, cookies) {
  const sent = req.headers?.[CSRF_HEADER] || req.headers?.['x-requested-with'] || null;
  const expected = cookies?.[CSRF_COOKIE] || null;
  if (!sent || !expected) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Set-Cookie values for a fresh session: httpOnly access + refresh, readable CSRF. */
export function authCookieHeaders({ accessToken, refreshToken, accessMaxAge, refreshMaxAge, csrfToken, env = process.env }) {
  const { secure, sameSite, domain } = cookieSecurity(env);
  return [
    serializeCookie(AUTH_ACCESS_COOKIE,  accessToken,  { httpOnly:true,  path:'/',                 maxAge:accessMaxAge,  secure, sameSite, domain }),
    serializeCookie(AUTH_REFRESH_COOKIE, refreshToken, { httpOnly:true,  path:REFRESH_COOKIE_PATH, maxAge:refreshMaxAge, secure, sameSite, domain }),
    serializeCookie(CSRF_COOKIE,         csrfToken || newCsrfToken(), { httpOnly:false, path:'/', maxAge:refreshMaxAge, secure, sameSite, domain }),
  ];
}

export function clearAuthCookieHeaders({ env = process.env } = {}) {
  const { secure, sameSite, domain } = cookieSecurity(env);
  return [
    serializeCookie(AUTH_ACCESS_COOKIE,  '', { httpOnly:true,  path:'/',                 maxAge:0, secure, sameSite, domain }),
    serializeCookie(AUTH_REFRESH_COOKIE, '', { httpOnly:true,  path:REFRESH_COOKIE_PATH, maxAge:0, secure, sameSite, domain }),
    serializeCookie(CSRF_COOKIE,         '', { httpOnly:false, path:'/',                 maxAge:0, secure, sameSite, domain }),
  ];
}

/** Attach the cookies to an Express response (keeps any other Set-Cookie headers). */
export function setAuthCookies(res, { accessToken, refreshToken, accessMaxAge = 900, refreshMaxAge = 30 * 24 * 60 * 60 }) {
  try {
    for (const header of authCookieHeaders({ accessToken, refreshToken, accessMaxAge, refreshMaxAge }))
      res.append('Set-Cookie', header);
  } catch (e) { console.warn('[cookies] set failed:', e.message); }
}

export function clearAuthCookies(res) {
  try {
    for (const header of clearAuthCookieHeaders()) res.append('Set-Cookie', header);
  } catch (e) { console.warn('[cookies] clear failed:', e.message); }
}
