# ZAPIT — Your AI Sales Rep + Viral Content Machine

> **Africa's #1 WhatsApp + Content Automation Platform** — replies to customers, takes orders, and posts viral content to TikTok, Instagram, Facebook & YouTube *while you sleep*. Built for African SMEs, zero tech skills required.

[![CI](https://github.com/zapithub/zapit/actions/workflows/ci.yml/badge.svg)](https://github.com/zapithub/zapit/actions/workflows/ci.yml)
[![Security: 191/191](https://img.shields.io/badge/security-191%2F191-brightgreen)](#security)
[![Coverage: 70%](https://img.shields.io/badge/coverage-70%25-yellow)](#testing)

**Live:** Frontend `https://zapit.app` · API `https://zapit-n2yf.onrender.com` · Health `/health`

---

## 30-second start

**Runtime: Node.js 22 or newer.** The Supabase client pulls in `@supabase/realtime-js`, which needs the
built-in `WebSocket`; on Node 20 `createClient()` throws `WebSocket not found` and the process dies at
import. `index.js` now checks this up front and says so, and CI/Docker run Node 22.

```bash
git clone https://github.com/zapithub/zapit.git && cd zapit
cp .env.example .env   # fill SUPABASE_URL, JWT_SECRET (openssl rand -hex 32), etc.
npm install
npm run generate:pricing
npm run dev            # http://localhost:3000  —  health: http://localhost:3000/health
# In another terminal, open the frontend:
#   npx serve .  (or)  open index.html
```

Docker:

```bash
docker compose up --build   # http://localhost:3000
```

---

## Why ZAPIT?

- **While you sleep, ZAPIT sells** — WhatsApp bot replies instantly using your product list & knowledge base, takes orders (name/address/qty), sends Paystack/bank links, confirms payment, and tracks every contact as lead/customer/VIP.
- **While you sleep, ZAPIT posts** — AI writes captions in *your* voice (not generic), generates images/videos, schedules 30 days out, publishes to 4 platforms on autopilot.
- **Built for Africa** — auto-detects country → pricing in NGN, GHS, KES, ZAR, USD; speaks English, Pidgin, Yoruba, Igbo, Hausa, Swahili; Paystack + Brevo; low-bandwidth PWA.

---

## Architecture

```
Single Express 3k LOC → modular src/ (plans, validation, cache, locks) + 3 static HTML (landing, login, dashboard, pricing) + Supabase (Postgres + Auth + Storage)
Cron:  publishDue(5m)  expireSubs(2am)  calendarHourly
External:  Hugging Face / OpenAI (captions), Replicate (images/video), Meta Graph (WA + IG/FB), TikTok, YouTube, Paystack, Brevo
```

- **Single source of truth:** `src/config/plans.js` → `public/pricing.json` (via `npm run generate:pricing`) → `index.js` + `index.html`/`pricing.html`.
- **Design tokens:** `public/shared.css` linked in all 4 HTML (no more 4× duplication).
- **Security (Phase 1):** strict CORS allowlist, Helmet HSTS/referrer/permissions, no default secrets (fail-closed prod), OTP SHA-256 + lockout, password strength, file magic-bytes + re-encode, Paystack `timingSafeEqual` + idempotency, `spawn` not `exec` for ffmpeg, per-user rate limits, `x-request-id`.
- **Reliability (Phases 2 + 4):** pagination (max 100) + `subscriptionCache` (60s LRU), `withAdvisoryLock` for cron, TOCTOU post-insert guard + `check_and_enforce_limit()` DB fn, order state machine + trigger, `transactions` append-only, `webhook_events` dedup, 3/day KB auto-learn + `needs_approval`, analytics 60s cache.

See [`CONSULTANT_REVIEW.md`](CONSULTANT_REVIEW.md) (47 findings, 5 phases) and [`PROGRESS.md`](PROGRESS.md).

---

## API (54 routes)

Authenticated routes need `Authorization: Bearer <accessToken>`.

| Group | Routes |
|-------|--------|
| **Auth** (12) | `POST /auth/register, /login, /logout, /verify-email, /resend-otp, /forgot-password, /reset-password` + `GET /auth/me`, `PATCH /auth/update-profile, /change-password`, `POST /auth/refresh-token` |
| **Onboarding** (8) | `GET /onboarding/status`, `POST /onboarding/{business-info,whatsapp,payment-setup,products,social-connect,apply-template,complete}` |
| **WhatsApp** (20) | `whatsapp/settings`, `products` (CRUD+import/export), `orders`, `contacts`, `knowledge-base`, `ai-logs`, `broadcasts`, `conversations`, webhooks |
| **Social/Content** (14) | `social/platforms, connect, callback`, `content/generate/{text,image,video,carousel,caption}`, `content/library, upload, schedule, publish-now, calendar, brand-voice, templates` |
| **Analytics/Subscription/Referral/Admin/Webhooks/System** | `analytics/*`, `subscription/*`, `referrals/*`, `admin/*`, `webhook/{paystack,tiktok,instagram}`, `health, status` |

Full list: [`docs/API.md`](docs/API.md). Pagination: `?page=1&limit=20` (max 100) → `{ data, meta: {total,page,limit} }`.

Try it:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/pricing/location
curl -X POST http://localhost:3000/auth/register -H 'Content-Type: application/json' -d '{"email":"a@b.com","username":"ab_test","password":"ValidPass1","full_name":"Test"}'
```

---

## Env

See [`.env.example`](.env.example) and [`docs/ENV.md`](docs/ENV.md). Generate secrets:

```bash
openssl rand -hex 32  # for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY, ADMIN_SECRET
```

| Var | Required | Notes |
|-----|----------|-------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Yes | fail-closed in prod |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | Yes (prod) | min 32 chars |
| `FRONTEND_URL` | No | CORS allowlist |
| `WA_*`, `HF_API_KEY`, `REPLICATE_API_KEY`, `PAYSTACK_*`, `BREVO_*` | No | mock if missing |

---

## Supabase

Migrations: [`supabase/migrations/`](supabase/migrations/) — `20261001_phase4_hardening.sql` (limits, transactions, webhook_events, order trigger, KB throttle, posts retry, analytics_daily, advisory locks).

```bash
supabase link --project-ref YOUR_REF
supabase db push
# or: psql $DATABASE_URL -f supabase/migrations/20261001_phase4_hardening.sql
```

Storage bucket `content-media` (private) for uploads.

---

## Testing

```bash
npm run check              # syntax
npm run security:check     # 191 security invariants (Phases 1–8.4)
npm run generate:pricing   # rebuild public/pricing.json from src/config/plans.js
npm test                   # unit — 18 suites
npm run test:integration   # live-server integration (self-skips without one)
npm run smoke:order        # Phase 8 proof: chat → order row → tenant-key Paystack → paid
npm run smoke:broadcast    # Phase 8 proof: 24h window, templates, scheduled runs
npm run test:all           # everything CI runs
npm run test:phase1        # security + check
npm run test:phase2        # generate:pricing + check + security
```

Unit tests: [`tests/unit/`](tests/unit/) — Node `assert/strict`, no dep. Integration `health` skipped if no server. Coverage goal 70% on `src/` (Phase 5).

CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs check + security + generate:pricing + unit + hadolint.

---

## Frontend

- **Landing** (`index.html`): hero + WA demo (typing dots, reduced-motion), dual value prop, features, how-it-works, pricing (4-level fallback: backend → `public/pricing.json` → `ipapi` → Nigeria), FAQ, footer. `public/shared.css` + `public/manifest.json` + CSP + DOMPurify.
- **Login** (`login.html`): tabs login/register, OTP modal, sessionStorage (7d) + in-memory, XSS-mitigated via CSP + DOMPurify, `public/sw.js`.
- **Dashboard** (`dashboard.html`): SPA with 12 views, `escapeHtml` + DOMPurify `setSafeHTML`, `aria-live` toast, `role=dialog` focus trap, `loading=lazy`, 900px/480px responsive, PWA.

PWA: `public/manifest.json` (standalone, theme #6366F1) + `public/sw.js` (network-first API, cache-first shell). Register on load.

---

## Security

See [`SECURITY.md`](SECURITY.md). Report: `security@zapit.app`. Policy: 24h triage, 48h fix for Critical.

Highlights: CORS allowlist (no `*`), Helmet HSTS 1yr, `Permissions-Policy` none, `Referrer-Policy` strict, `x-request-id`, OTP hash + 5/15m lockout, password upper/lower/number, upload magic-byte + sharp re-encode (10MB, 1 file), Paystack `timingSafeEqual` + `webhook_events` + `transactions` unique, `spawn` for ffmpeg, per-user rate limits, `trust proxy`, health 3s timeout, DOMPurify+CSP.

Run `npm run security:check` in CI — fails on default secret, wide CORS, missing HSTS, etc.

---

## Deploy

Render / Fly / Docker:

```bash
# Render:  Build `npm install`, Start `npm start`, Env: SUPABASE_URL, JWT_SECRET, etc.
# Docker:  (see Dockerfile — multi-stage, non-root, HEALTHCHECK)
docker build -t zapit .
docker run -p 3000:3000 --env-file .env zapit
```

`render.yaml` / `fly.toml` TODO (Phase 5).

---

## Contributing

PRs welcome! Keep `src/config/plans.js` as source, run `npm run generate:pricing` after price changes, and ensure `npm test && npm run security:check` passes. No shortcut — Phases must be done in order. See [`CONSULTANT_REVIEW.md`](CONSULTANT_REVIEW.md).

---

## License

UNLICENSED — zapithub. Built for Africa's hustlers, creators & small businesses. ⚡ Lagos · Accra · Nairobi
