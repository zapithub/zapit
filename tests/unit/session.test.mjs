// Phase 7.2 — S-08: short-lived access tokens, hashed + rotating refresh tokens
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  parseTtlSeconds, ACCESS_TOKEN_TTL, ACCESS_TOKEN_TTL_SEC, ACCESS_TOKEN_MAX_SEC, ACCESS_TOKEN_MIN_SEC,
  REFRESH_TOKEN_TTL_DAYS, REFRESH_TOKEN_TTL_MS, hashToken, newFamilyId,
  newSessionRow, legacySessionRow, isSessionReuse, isSessionActive, isMissingColumnError, REUSE_REASON,
} from '../../src/utils/session.js';

console.log('▶ session.test (Phase 7.2 — S-08)');

// ── access-token lifetime is short and cannot be configured away ──
{
  assert.equal(parseTtlSeconds('15m'), 900);
  assert.equal(parseTtlSeconds('900'), 900);
  assert.equal(parseTtlSeconds('5m'), 300);
  assert.equal(parseTtlSeconds('1h'), 3600);

  // The whole point of S-08: a week-long access token must be impossible, even by env.
  assert.equal(parseTtlSeconds('7d'), ACCESS_TOKEN_MAX_SEC, '7d clamps to 1 hour');
  assert.equal(parseTtlSeconds('30d'), ACCESS_TOKEN_MAX_SEC, '30d clamps to 1 hour');
  assert.equal(parseTtlSeconds('1s'), ACCESS_TOKEN_MIN_SEC, 'absurdly short clamps up');
  assert.equal(parseTtlSeconds('not-a-ttl'), 900, 'garbage falls back to 15 minutes');
  assert.equal(parseTtlSeconds(undefined), 900);
  assert.equal(parseTtlSeconds(''), 900);

  assert.ok(ACCESS_TOKEN_TTL_SEC >= 60 && ACCESS_TOKEN_TTL_SEC <= 3600, 'effective TTL is clamped');
  assert.equal(ACCESS_TOKEN_TTL_SEC, 900, 'default is 15 minutes');
  assert.equal(ACCESS_TOKEN_TTL, '15m', 'signing TTL matches the effective one by default');
  assert.equal(REFRESH_TOKEN_TTL_DAYS, 30);
  assert.equal(REFRESH_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
}

// ── tokens are hashed at rest, never stored ──────────────────────
{
  const token = 'header.payload.signature';
  const h = hashToken(token);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(h, hashToken(token), 'deterministic');
  assert.notEqual(h, hashToken(token + 'x'));
  assert.ok(!h.includes(token));

  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const accessToken = 'a.b.c', refreshToken = 'r.s.t';
  const row = newSessionRow({
    userId:'u1', accessToken, refreshToken, accessJti:'aj', refreshJti:'rj',
    familyId:'fam-1', ip:'1.2.3.4', userAgent:'jest', now,
  });

  assert.equal(row.access_token_hash, hashToken(accessToken));
  assert.equal(row.refresh_token_hash, hashToken(refreshToken));
  assert.ok(!JSON.stringify(row).includes(accessToken), 'raw access token absent');
  assert.ok(!JSON.stringify(row).includes(refreshToken), 'raw refresh token absent');
  assert.equal(row.token, undefined, 'legacy column not written');
  assert.equal(row.refresh_token, undefined, 'legacy column not written');
  assert.equal(row.family_id, 'fam-1');
  assert.equal(row.access_jti, 'aj');
  assert.equal(row.refresh_jti, 'rj');
  assert.equal(row.expires_at, new Date(now + 900_000).toISOString(), 'access window = 15 min');
  assert.equal(row.refresh_expires_at, new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(), 'refresh window = 30 d');

  const legacy = legacySessionRow({ userId:'u1', accessToken, refreshToken, ip:'x', userAgent:'y', now });
  assert.equal(legacy.token, accessToken, 'legacy fallback only for a pre-migration DB');
  assert.equal(legacy.expires_at, new Date(now + 900_000).toISOString(), 'legacy rows also get the short window');
}

// ── reuse + activity decisions ───────────────────────────────────
{
  const fresh = { revoked_at:null, rotated_at:null, refresh_expires_at:new Date(Date.now() + 60_000).toISOString() };
  assert.equal(isSessionReuse(fresh), false);
  assert.equal(isSessionReuse({ ...fresh, revoked_at:'2026-10-01T00:00:00Z' }), true, 'revoked = spent');
  assert.equal(isSessionReuse({ ...fresh, rotated_at:'2026-10-01T00:00:00Z' }), true, 'rotated = spent');
  assert.equal(isSessionReuse(null), false);

  const now = Date.now();
  assert.equal(isSessionActive(fresh, now), true);
  assert.equal(isSessionActive({ ...fresh, revoked_at:new Date().toISOString() }, now), false, 'revoked is never active');
  assert.equal(isSessionActive({ refresh_expires_at:new Date(now - 1).toISOString() }, now), false, 'expired refresh window');
  assert.equal(isSessionActive({ expires_at:new Date(now + 60_000).toISOString() }, now), true, 'legacy rows fall back to expires_at');
  assert.equal(isSessionActive({}, now), false);
  assert.equal(isSessionActive(null, now), false);
  assert.equal(REUSE_REASON, 'refresh_reuse');
}

// ── migration tolerance is narrow: only "column missing" ─────────
{
  assert.equal(isMissingColumnError({ code:'42703', message:'column "x" does not exist' }), true);
  assert.equal(isMissingColumnError({ code:'PGRST204', message:"Could not find the 'access_token_hash' column" }), true);
  assert.equal(isMissingColumnError({ message:'column access_token_hash does not exist' }), true);
  assert.equal(isMissingColumnError({ message:'duplicate key value violates unique constraint' }), false);
  assert.equal(isMissingColumnError({ code:'23505' }), false);
  assert.equal(isMissingColumnError(null), false);
}

// ── wiring: index.js stores hashes, rotates and revokes ──────────
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(!src.includes('token:accessToken'), 'no raw access token written to sessions');
  assert.ok(!/"sessions'\)\.insert\(\{/.test(src) && !/sessions'\)\.insert\(\{/.test(src),
    'every session insert goes through newSessionRow (hashes only)');
  assert.ok(!src.includes("expiresIn: '7d'"), 'no 7-day access token');
  assert.ok(src.includes("expiresIn: ACCESS_TOKEN_TTL"), 'access token uses the clamped TTL');
  assert.ok(src.includes('.eq(\'access_token_hash\', hashToken(token))'), 'authenticate looks sessions up by hash');
  assert.ok(src.includes(".eq('refresh_token_hash', rtHash)"), 'refresh looks sessions up by hash');
  assert.ok(src.includes(".eq('refresh_jti', decoded.jti)"), 'spent refresh tokens are traced by jti');
  assert.ok(src.includes('isSessionReuse(session)') && src.includes('revokeFamilyAndFail'), 'reuse revokes the family');
  assert.ok(src.includes("revoked_reason:'rotated'") && src.includes('replaced_by_hash'), 'rotation marks the spent row');
  assert.ok(src.includes("revoked_reason:'logout'"), 'logout revokes rather than silently deleting');
  assert.ok(src.includes('expires_in:    ACCESS_TOKEN_TTL_SEC') && src.includes('expires_in:ACCESS_TOKEN_TTL_SEC'), 'API advertises the 15-minute lifetime');
  assert.ok(src.includes('createSession({ user, req })'), 'register/login use the shared session factory');
  assert.ok(src.includes('utils/session.js'), 'session helpers imported');
  assert.ok(!src.includes('delete().eq(\'token\', req.token)') || src.includes('legacy'), 'legacy delete only as fallback');

  const mig = fs.readFileSync('supabase/migrations/20261008_phase7_02_sessions.sql', 'utf8');
  assert.ok(mig.includes('access_token_hash') && mig.includes('refresh_token_hash'), 'migration adds hashed columns');
  assert.ok(mig.includes('family_id') && mig.includes('revoked_reason'), 'migration supports family revocation');
  assert.ok(mig.includes('IF NOT EXISTS pgcrypto') || mig.includes('pgcrypto'), 'migration backfills matching sha256 hashes');
  assert.ok(mig.includes('token = NULL'), 'migration purges legacy raw tokens');
  assert.ok(mig.includes('prune_sessions'), 'migration provides housekeeping');
}

console.log('✅ session.test passed');
