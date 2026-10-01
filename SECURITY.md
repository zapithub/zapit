# Security Policy — ZAPIT

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x     | ✅ |
| <3.0    | ❌ |

## Reporting a Vulnerability

Email **security@zapit.app** or use `POST /support/contact` with prefix `[SECURITY]`. We respond within 24h, fix Critical within 48h. Do not open a public issue for security bugs. You will be credited if desired.

## Security Measures (as of Phase 1 — 2026-10-01)

### What we ship

- **Strict CORS allowlist** — only `FRONTEND_URL`, `zapit.app`, `localhost` and `*.e2b.app` previews. No `*`, no fail-open in production.
- **Helmet** — `HSTS` (1 year, preload), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` locked down. CSP is currently `report-only` style because of inline CSS/JS; Phase 3 enforces nonce-based CSP.
- **No default secrets** — `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` must be set in production (process exits otherwise). Dev fallbacks are random per boot with a warning and are never used in prod.
- **Constant-time Paystack signature check** (`crypto.timingSafeEqual`), raw-body charset handling, fast 200 ACK, idempotency on `reference` (duplicate webhooks are ignored).
- **`spawn` not `exec`** for `ffmpeg` — no shell injection via caption / topic.
- **Input validation** on all critical routes (auth, onboarding, products, knowledge base, schedule, support). Max lengths enforced, types checked, XSS characters stripped (`sanitizeStr`).
- **Password policy** — 8–128 chars, upper + lower + number, weak-pattern rejected.
- **OTP hardening** — codes are SHA-256 hashed in DB, verification uses hash, brute-force lockout after 5 failures per 15 min.
- **File upload hardening** — extension + mimetype allowlist, `sharp` magic-byte check, image sanitization (re-encode via sharp), 10 MB / file limit, 1 file per request.
- **Rate limiting** — global 300/15m (IP), auth 20/15m (IP), OTP 3/min (IP), content 50/hr **per-user** when authenticated, admin 50/15m.
- **JWT** — `jti` per token, 7d access / 30d refresh, DB session check on every request, revocation on password change / logout. Tokens should be stored in `httpOnly` cookies (recommended) or short-lived `sessionStorage` (Phase 3 migration).
- **Admin** — `x-admin-secret` or admin username, per-IP rate limit, audit log (JSON line with `reqId`, `adminAction`, `userId`, `ip`).
- **Observability** — `x-request-id` on every response, structured JSON logs (`level`, `reqId`, `method`, `url`, `status`, `duration`), error IDs (`requestId`) on 500s, no PII in logs (email redacted via `escapeForLog`).
- **Health** — `GET /health` has 3s DB timeout, never hangs.
- **`trust proxy` enabled** — correct `req.ip` behind Render / Nginx.

### What is still pending (see `CONSULTANT_REVIEW.md` Phases 2–5)

- Nonce-based CSP + removal of inline scripts (Phase 3)
- Distributed locks for cron (Phase 2)
- DB constraints & atomic subscription checks (Phase 4)
- Full test suite & OpenTelemetry (Phase 5)

### Best practices for deployers

1. **Never** commit `.env` — copy `.env.example`.
2. Generate secrets: `openssl rand -hex 32` for each `*_SECRET` / `*_KEY`.
3. Set `NODE_ENV=production` on Render — the app will refuse to boot with weak secrets.
4. Enable Paystack webhook IP allowlist if possible, and keep `PAYSTACK_SECRET_KEY` rotated.
5. Back up Supabase with PITR; enable RLS on all tables and audit `storage` bucket `content-media` (private, not public).
6. Run `npm run security:check` in CI (fails on default secrets, wide CORS, missing helmet).

## Audit Log

- **2026-10-01** — Phase 1 remediation landed (11 Critical, 14 High findings fixed). Next review after Phase 4.

## License

Security policy is CC0. Code is UNLICENSED.
