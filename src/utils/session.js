// ZAPIT — session/token helpers (Phase 7.2 — S-08)
// Before 7.2: access tokens lived 7 days, refresh tokens 30 days, and BOTH were
// stored raw in `sessions` — a database read granted account takeover, and a
// stolen refresh token could be replayed forever.
//
// After 7.2: access tokens live 15 minutes (clamped), refresh tokens are rotated
// on every use, and only sha256 hashes are persisted. Presenting a rotated or
// revoked refresh token is treated as theft: the whole session family is revoked.

import crypto from 'crypto';

export const REFRESH_TOKEN_TTL_DAYS = 30;
export const REFRESH_TOKEN_TTL_MS   = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
export const ACCESS_TOKEN_MIN_SEC   = 60;      // never shorter than a minute
export const ACCESS_TOKEN_MAX_SEC   = 3600;    // never longer than an hour — 7d is not an option
export const DEFAULT_ACCESS_TTL_SEC = 15 * 60; // 15 minutes
export const REUSE_REASON           = 'refresh_reuse';

/** '15m' / '900' / '2h' → seconds, clamped to [1 min, 1 hour]. */
export function parseTtlSeconds(ttl, fallback = DEFAULT_ACCESS_TTL_SEC) {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(ttl ?? '').trim());
  if (!m) return fallback;
  const unit = m[2] || 's';
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  const secs = Number(m[1]) * mult;
  return Math.min(ACCESS_TOKEN_MAX_SEC, Math.max(ACCESS_TOKEN_MIN_SEC, secs));
}

/** Effective access-token lifetime from env, using the same JWT string for signing. */
export const ACCESS_TOKEN_TTL     = process.env.ACCESS_TOKEN_TTL || '15m';
export const ACCESS_TOKEN_TTL_SEC = parseTtlSeconds(ACCESS_TOKEN_TTL);

/** Tokens are never stored; only their sha256 hex digest is. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function newFamilyId() {
  return crypto.randomUUID();
}

/**
 * Row for a brand-new session — hashes only, no raw secrets.
 * `expires_at` keeps its original meaning (access-token expiry) so the existing
 * authenticate lookup stays intact; `refresh_expires_at` is the long-lived window.
 */
export function newSessionRow({ userId, accessToken, refreshToken, accessJti, refreshJti, familyId, ip, userAgent, now = Date.now() } = {}) {
  return {
    user_id: userId,
    access_token_hash:  hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    access_jti:  accessJti  || null,
    refresh_jti: refreshJti || null,
    family_id: familyId,
    expires_at: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
    ip_address: ip || null,
    user_agent: userAgent || null,
  };
}

/** Pre-migration fallback shape (raw tokens) so the API survives before 20261008 is applied. */
export function legacySessionRow({ userId, accessToken, refreshToken, ip, userAgent, now = Date.now() } = {}) {
  return {
    user_id: userId,
    token: accessToken,
    refresh_token: refreshToken,
    expires_at: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    ip_address: ip || null,
    user_agent: userAgent || null,
  };
}

/** A rotated or revoked row means the token was already spent → reuse/theft. */
export function isSessionReuse(record) {
  return !!(record && (record.revoked_at || record.rotated_at));
}

/** Live session within its refresh window. */
export function isSessionActive(record, now = Date.now()) {
  if (!record || record.revoked_at) return false;
  const until = new Date(record.refresh_expires_at || record.expires_at || 0).getTime();
  return Number.isFinite(until) && until > now;
}

/** PostgREST/Postgres "column does not exist" → the migration has not been applied yet. */
export function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg  = String(error.message || '');
  return code === '42703' || code === 'PGRST204'
    || /column .* does not exist/i.test(msg)
    || /could not find the '.*' column/i.test(msg);
}
