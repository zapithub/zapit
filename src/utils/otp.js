// ZAPIT — OTP primitives (Phase 6.5, S-15)
// Crypto-strong codes, hashed at rest, with a real per-code attempt lockout.
import crypto from 'crypto';

export const OTP_TTL_MS      = 10 * 60 * 1000; // codes live 10 minutes
export const OTP_MAX_ATTEMPTS = 5;             // then the code is dead

/** 6-digit code from a CSPRNG — never Math.random(). */
export function generateOTP() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Codes are stored hashed (sha256 hex); never plaintext. */
export function hashOTP(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** Constant-time comparison of two hex hashes. */
export function safeHashEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Decide whether a stored OTP row can be redeemed by `codeHash`.
 * Pure + deterministic so every branch is unit-testable.
 *
 * @returns {{ ok: boolean, reason: 'ok'|'missing'|'used'|'expired'|'locked'|'mismatch' }}
 */
export function verifyOTPRecord({ record, codeHash, now = Date.now() } = {}) {
  if (!record) return { ok: false, reason: 'missing' };
  if (record.verified) return { ok: false, reason: 'used' };
  const expires = new Date(record.expires_at).getTime();
  if (!Number.isFinite(expires) || expires <= now) return { ok: false, reason: 'expired' };
  if ((record.attempts || 0) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (!safeHashEqual(codeHash, record.code)) return { ok: false, reason: 'mismatch' };
  return { ok: true, reason: 'ok' };
}

/** Attempts to persist after a failed guess (never exceeds the cap). */
export function attemptsAfterFailure(record) {
  return Math.min((record?.attempts || 0) + 1, OTP_MAX_ATTEMPTS);
}
