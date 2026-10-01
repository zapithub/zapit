// ZAPIT — OAuth flow helpers (Phase 7.1 — S-07)
// The pre-7.1 flow put a base64-encoded { user_id, platform, ts } blob in `state`
// and trusted it on the callback. That is forgeable (anyone can craft a state for
// another user), replayable (no expiry / single use) and unbound to the redirect.
//
// The 7.1 flow stores an opaque random state server-side (only its sha256 hash is
// persisted), binds it to the authenticated user + platform + redirect URI, expires
// it after 10 minutes, and redeems it exactly once. PKCE (S256) is added to every
// provider so a stolen authorization code is useless without the matching verifier.

import crypto from 'crypto';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;   // 10 minutes — matches the provider hand-off window
export const OAUTH_STATE_BYTES  = 32;               // 256 bits of CSPRNG entropy
export const OAUTH_PKCE_BYTES   = 32;               // verifier = 43 base64url chars (RFC 7636 minimum)
export const OAUTH_PKCE_METHOD  = 'S256';

/** Platforms that support the server-side state store (mirrors SOCIAL_PROVIDERS in index.js). */
export const OAUTH_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'];

/** Fresh, unguessable state handle (URL-safe, never contains user data). */
export function newOAuthState() {
  return crypto.randomBytes(OAUTH_STATE_BYTES).toString('base64url');
}

/** Only the hash is stored, so a database read cannot forge a callback. */
export function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

/** RFC 7636 S256 pair. `challenge = BASE64URL(SHA256(ASCII(verifier)))`. */
export function newPkcePair() {
  const verifier  = crypto.randomBytes(OAUTH_PKCE_BYTES).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge, method: OAUTH_PKCE_METHOD };
}

/** Verifier must round-trip to the challenge (used by tests and provider debugging). */
export function pkceChallengeFor(verifier) {
  return crypto.createHash('sha256').update(String(verifier), 'ascii').digest('base64url');
}

/**
 * Single decision point for a callback's state row.
 * Order matters: replay and platform confusion must be rejected before anything else.
 * Returns { ok, reason } where reason ∈ ok | unknown | used | platform_mismatch | expired.
 */
export function stateDecision({ record, platform, now = Date.now() } = {}) {
  if (!record) return { ok: false, reason: 'unknown' };
  if (record.used_at) return { ok: false, reason: 'used' };
  if (platform && String(record.platform) !== String(platform)) return { ok: false, reason: 'platform_mismatch' };
  const expiresAt = new Date(record.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, reason: 'ok' };
}

/** Provider error strings come from the query string — keep them short and URL-safe. */
export function sanitizeProviderError(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'provider_error';
}

/** Build one of the four authorize URLs without ever interpolating raw user input. */
export function buildAuthorizeUrl(provider, { state, challenge, method = OAUTH_PKCE_METHOD, redirectUri }) {
  const q = new URLSearchParams();
  switch (provider.id) {
    case 'instagram':
    case 'facebook':
      q.set('client_id', provider.clientId);
      q.set('redirect_uri', redirectUri);
      q.set('scope', provider.scope);
      q.set('state', state);
      q.set('code_challenge', challenge);
      q.set('code_challenge_method', method);
      q.set('response_type', 'code');
      return `https://www.facebook.com/dialog/oauth?${q}`;
    case 'tiktok':
      q.set('client_key', provider.clientId);
      q.set('scope', provider.scope);
      q.set('response_type', 'code');
      q.set('redirect_uri', redirectUri);
      q.set('state', state);
      q.set('code_challenge', challenge);
      q.set('code_challenge_method', method);
      return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
    case 'youtube':
      q.set('client_id', provider.clientId);
      q.set('redirect_uri', redirectUri);
      q.set('response_type', 'code');
      q.set('scope', provider.scope);
      q.set('state', state);
      q.set('code_challenge', challenge);
      q.set('code_challenge_method', method);
      q.set('access_type', 'offline');
      q.set('prompt', 'consent');
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    default:
      return null;
  }
}
