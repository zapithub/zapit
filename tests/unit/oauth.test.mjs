// Phase 7.1 — S-07: OAuth state is a single-use server-side handle + PKCE S256
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  newOAuthState, hashState, newPkcePair, pkceChallengeFor, stateDecision,
  sanitizeProviderError, buildAuthorizeUrl, OAUTH_STATE_TTL_MS, OAUTH_PLATFORMS,
} from '../../src/utils/oauth.js';

console.log('▶ oauth.test (Phase 7.1 — S-07)');

// ── state: opaque, 256-bit, URL-safe, unguessable ────────────────
{
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const st = newOAuthState();
    assert.match(st, /^[A-Za-z0-9_-]{43}$/, 'base64url of 32 bytes');
    assert.ok(!/[+/=]/.test(st), 'no base64 padding or unsafe chars');
    assert.ok(!seen.has(st), 'collision-free');
    seen.add(st);
  }
  // The old flow leaked identity into the state; the new one must be opaque.
  const st = newOAuthState();
  assert.ok(!/eyJ/.test(st), 'not a base64-encoded JSON blob');
  const decoded = Buffer.from(st, 'base64url').toString('utf8');
  // (a raw random byte could legally be '{' — assert on the payload, not the alphabet)
  assert.ok(!decoded.includes('user_id') && !decoded.includes('platform'), 'contains no structured payload');
}

// ── hashState: sha256 hex, stable, one-way ───────────────────────
{
  const st = newOAuthState();
  const h1 = hashState(st);
  assert.match(h1, /^[a-f0-9]{64}$/, 'sha256 hex');
  assert.equal(h1, hashState(st), 'deterministic');
  assert.notEqual(h1, hashState(st + 'x'), 'input-sensitive');
  assert.ok(!h1.includes(st), 'hash is not the state');
}

// ── PKCE: S256 pair matches RFC 7636 and rotates ─────────────────
{
  const a = newPkcePair();
  assert.equal(a.method, 'S256');
  assert.ok(a.verifier.length >= 43 && a.verifier.length <= 128, 'verifier length per RFC');
  assert.equal(a.challenge, pkceChallengeFor(a.verifier), 'challenge = S256(verifier)');
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  const b = newPkcePair();
  assert.notEqual(a.verifier, b.verifier, 'fresh verifier each flow');
  assert.notEqual(a.challenge, b.challenge, 'fresh challenge each flow');

  // Known-answer test (RFC 7636 appendix B) — proves the exact transform.
  const known = pkceChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(known, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  // Independent implementation cross-check.
  assert.equal(a.challenge, crypto.createHash('sha256').update(a.verifier, 'ascii').digest('base64url'));
}

// ── stateDecision: replay / confusion / expiry are rejected in order ──
{
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const fresh = { platform:'youtube', expires_at:new Date(now + 60_000).toISOString(), used_at:null };

  assert.equal(stateDecision({ record:null, platform:'youtube', now }).reason, 'unknown');
  assert.equal(stateDecision({ record:{ ...fresh, used_at:new Date(now).toISOString() }, platform:'youtube', now }).reason, 'used');
  assert.equal(stateDecision({ record:fresh, platform:'tiktok', now }).reason, 'platform_mismatch');
  assert.equal(stateDecision({ record:{ ...fresh, expires_at:new Date(now).toISOString() }, platform:'youtube', now }).reason, 'expired');
  assert.equal(stateDecision({ record:{ ...fresh, expires_at:new Date(now - 1).toISOString() }, platform:'youtube', now }).reason, 'expired');
  assert.equal(stateDecision({ record:{ ...fresh, expires_at:'not-a-date' }, platform:'youtube', now }).reason, 'expired');
  assert.equal(stateDecision({ record:fresh, platform:'youtube', now }).ok, true);

  // A used state stays used even after expiry — replay never wins.
  const usedExpired = { ...fresh, used_at:new Date(now).toISOString(), expires_at:new Date(now - 1).toISOString() };
  assert.equal(stateDecision({ record:usedExpired, platform:'youtube', now }).reason, 'used');

  assert.equal(OAUTH_STATE_TTL_MS, 10 * 60 * 1000, '10 minute hand-off window');
}

// ── provider error strings cannot smuggle redirect payloads ──────
{
  assert.equal(sanitizeProviderError('access_denied'), 'access_denied');
  assert.equal(sanitizeProviderError('javascript:alert(1)'), 'javascriptalert1');
  assert.equal(sanitizeProviderError('  spaced out  '), 'spacedout');
  assert.equal(sanitizeProviderError(''), 'provider_error');
  assert.equal(sanitizeProviderError(null), 'provider_error');
  assert.ok(sanitizeProviderError('x'.repeat(500)).length <= 64);
  assert.ok(!sanitizeProviderError('a&b=c?d#e').match(/[&=?#]/));
}

// ── authorize URLs: state + PKCE on every provider, no raw user input ──
{
  const provider = (id, clientId = 'cid') => ({
    id, clientId, clientSecret:'sec', scope:'s1,s2',
  });
  const { challenge } = newPkcePair();
  const state = newOAuthState();

  for (const platform of OAUTH_PLATFORMS) {
    const url  = buildAuthorizeUrl(provider(platform), { state, challenge, redirectUri:'https://api.zapit.ng/social/callback/' + platform });
    assert.ok(url, `${platform} builds a URL`);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('state'), state, `${platform} carries the opaque state`);
    assert.equal(parsed.searchParams.get('code_challenge'), challenge, `${platform} sends the PKCE challenge`);
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256', `${platform} uses S256`);
    assert.ok(!url.includes('user_id'), `${platform} URL never mentions a user id`);
    assert.ok(!url.includes('eyJ'), `${platform} URL carries no encoded identity blob`);
  }

  const google = new URL(buildAuthorizeUrl(provider('youtube'), { state, challenge, redirectUri:'https://api.zapit.ng/social/callback/youtube' }));
  assert.equal(google.searchParams.get('access_type'), 'offline');
  assert.equal(google.searchParams.get('prompt'), 'consent');
  assert.equal(buildAuthorizeUrl({ id:'myspace' }, { state, challenge, redirectUri:'x' }), null, 'unknown provider → null');
}

// ── wiring: index.js keeps the guarantees, drops the old flow ────
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(!src.includes("Buffer.from(JSON.stringify({ user_id"), 'old forgeable state is gone');
  assert.ok(!src.includes('stateData.user_id'), 'callback never trusts client state');
  assert.ok(src.includes('utils/oauth.js'), 'oauth helpers imported');
  assert.ok(src.includes('state_hash:hashState(state)'), 'state stored hashed');
  assert.ok(src.includes(".eq('state_hash', hashState(String(state)))"), 'callback looks the state up by hash');
  assert.ok(src.includes(".is('used_at', null)"), 'redemption is conditional on being unused');
  assert.ok(src.includes('buildAuthorizeUrl'), 'authorize URLs are built by the shared helper');
  const oauthSrc = fs.readFileSync('src/utils/oauth.js', 'utf8');
  assert.ok(oauthSrc.includes("code_challenge_method") || oauthSrc.includes('challenge'), 'PKCE challenge is sent to providers');
  assert.ok(src.includes('pkceParam'), 'PKCE verifier is sent on the Facebook token exchange');
  assert.ok((src.match(/ttBody\.code_verifier/g) || []).length === 1, 'TikTok exchange sends the verifier');
  assert.ok((src.match(/ytBody\.code_verifier/g) || []).length === 1, 'YouTube exchange sends the verifier');
  assert.ok(src.includes('stateDecision({ record: stateRow, platform })'), 'one decision point for state');
  assert.ok(src.includes('oauth_states'), 'server-side state store used');

  const mig = fs.readFileSync('supabase/migrations/20261007_phase7_01_oauth_state.sql', 'utf8');
  assert.ok(mig.includes('state_hash') && mig.includes('UNIQUE'), 'migration stores unique state hashes');
  assert.ok(mig.includes('used_at') && mig.includes('expires_at'), 'migration has single-use + expiry');
  assert.ok(mig.includes('ENABLE ROW LEVEL SECURITY'), 'migration enables RLS');
  assert.ok(mig.includes('prune_oauth_states'), 'migration provides housekeeping');
}

console.log('✅ oauth.test passed');
