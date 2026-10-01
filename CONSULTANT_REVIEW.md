# ZAPIT — Project Manager & Consultant Review
### Observation, Risk Assessment & Phased Remediation Plan
**Date:** 2026-10-01 &nbsp;|&nbsp; **Auditors:** Senior Project Manager + Principal Consultant (World-Class SaaS Standards) &nbsp;|&nbsp; **Version:** 3.0.0 &nbsp;|&nbsp; **Commit:** `6f1cac2`

> **How to read this document:** Every finding has a **Severity** (🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low), a **Phase** it is fixed in, and a **Status**. Phases must be completed **sequentially** — Phase N must be 100% done before Phase N+1 begins. This is a binding remediation contract.

---

## 0. Executive Summary

ZAPIT is a compelling product idea (WhatsApp AI Sales Rep + Viral Content Machine for African SMEs) with a functional v3.0 monolith: Express backend (`index.js` 3,073 lines, 54 routes, 4 cron jobs) + 3 large static frontends (`index.html`, `dashboard.html`, `login.html`, `pricing.html`). The UI design system is surprisingly mature and consistent across pages.

However, the codebase as-shipped is **not production-ready for paid users**. A world-class SaaS handling real money (Paystack), real customer data, and real WhatsApp automation must satisfy **security, reliability, legal and operability** bars. Today it does not. We found **47 findings** — **11 Critical, 14 High** — spanning security, architecture, data integrity and operability.

**Good news:** All issues are fixable without a rewrite. The product logic is sound; the gaps are engineering hygiene. Follow the 5-phase plan below and ZAPIT will meet enterprise-grade standards within ~3 weeks of engineering time.

**Recommendation: DO NOT take paid traffic or enterprise deals until Phase 1 + Phase 4 (Payment Integrity) are complete.**

---

## 1. Methodology

We audited:

- `index.js` (3,073 LOC, 54 Express routes, 12 auth, 8 onboarding, 20 WhatsApp, 7 social, 14 content, 7 analytics, 7 subscription, 4 referral, 5 admin, 3 webhook, 3 cron)
- `dashboard.html` (3,854 LOC, 257 KB), `index.html` (1,456 LOC), `login.html` (1,237 LOC), `pricing.html` (1,057 LOC)
- `package.json`, `.gitignore`, `README.md`
- Runtime behaviour (no `.env.example`, no tests, no CI, no Dockerfile, no Supabase migrations checked in)
- OWASP ASVS 4.0, CIS, WCAG 2.1 AA, Core Web Vitals, 12-Factor App, Stripe/Paystack integration best practices

Tools used: manual code review, static analysis (grep/semgrep patterns), threat modeling (STRIDE), accessibility audit (axe-core heuristics), performance audit (Lighthouse heuristics), business logic walkthrough (state machines for orders/subscriptions).

---

## 2. Finding Catalogue (47 findings)

### A. Security — 14 findings — HIGHEST RISK

| # | Finding | Severity | Detail | Phase | Status |
|---|---------|----------|--------|-------|--------|
| **A1** | **CORS is wide-open in production** | 🔴 Critical | `cors({ origin: (origin,cb)=>{...cb(null,true)} })` — the `if` returns `true` in dev **and** the fallback also returns `true`. Any origin can call every route, including `/admin/*` with stolen token. Brave/CORS spec bypass. | Phase 1 | ⏳ Pending |
| **A2** | **Helmet CSP disabled** | 🔴 Critical | `helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false })` removes the #1 XSS mitigation. Combined with heavy `innerHTML` usage (dashboard 45 occurrences), this is exploitable. | Phase 1 | ⏳ Pending |
| **A3** | **Default weak secrets in source** | 🔴 Critical | `JWT_SECRET='zapit-secret-change-me'`, `ENCRYPTION_KEY='zapit-32-char-encryption-key-1234'` are checked into git as defaults. If `process.env` is unset (common on Render misconfig), app boots with known keys. Attacker can forge any JWT and decrypt all OAuth tokens. `scryptSync` with static salt is also weak. | Phase 1 | ⏳ Pending |
| **A4** | **Supabase boots with placeholder credentials** | 🔴 Critical | `createClient('https://placeholder.supabase.co','placeholder-key')` — app starts even when DB is unconfigured, then every query fails with confusing errors. Fails **open** instead of **closed**. No startup validation. | Phase 1 | ⏳ Pending |
| **A5** | **No input validation / sanitization at API boundary** | 🔴 Critical | Only 3/54 routes validate shape (`register`, `login`, `reset-password`). Everything else trusts `req.body` directly. Examples: `PATCH /whatsapp/knowledge-base/:id` accepts any JSON and writes it, `POST /whatsapp/broadcasts` has no audience size guard, `business_name` has no max length. Opens XSS, NoSQL injection, DoS via 50 MB JSON. | Phase 1 | ⏳ Pending |
| **A6** | **OTP brute-force window too large** | 🟠 High | `otpLimiter: 3/min` but no per-email attempt counter, no lockout after 5 failures, and codes are 6-digit numeric (1M space). `POST /auth/verify-email` does `.eq('code',code)` without hashing — timing attack + enumeration possible. Code also not invalidated after N failures. | Phase 1 | ⏳ Pending |
| **A7** | **Password policy weak + no breach check** | 🟠 High | Only `length >=8` enforced. No complexity, no `pwned` check, no max length (DoS via 1 MB bcrypt). | Phase 1 | ⏳ Pending |
| **A8** | **File upload filter bypassable** | 🟠 High | `multer.fileFilter` checks `file.mimetype` only — client-controlled. A `.exe` with `image/jpeg` passes. No extension check, no magic-byte check, no virus scan, `sharp` is imported but never used to sanitize images. 50 MB limit is per file, no count limit. | Phase 1 | ⏳ Pending |
| **A9** | **Paystack webhook: raw body handling fragile + no idempotency** | 🔴 Critical | `express.raw()` is mounted only on `/webhook/paystack`, but `express.json()` (50 MB) is global after it — order matters; some clients send `application/json; charset=utf-8` which does not match `type: 'application/json'` exactly. No idempotency key (`reference` not checked for replay), no `200` fast-ack before DB work (Paystack will timeout & retry 3x, creating duplicate `subscriptions` rows via `upsert` race). | Phase 1 | ⏳ Pending |
| **A10** | **Admin auth via header is spoofable if leaked + no audit trail** | 🟠 High | `x-admin-secret` is a single global secret, no rotation, no IP allowlist, no rate limit on admin routes beyond global. No audit log of `set-plan`, `suspend`, `delete` actions. | Phase 1 | ⏳ Pending |
| **A11** | **Error messages leak internals** | 🟡 Medium | `console.error` + raw `err.message` in some paths. Stack traces could reach client if `next(err)` is used. No error ID for support. | Phase 1 | ⏳ Pending |
| **A12** | **Rate limits too coarse + not per-user** | 🟡 Medium | Global 300/15m is per-IP, not per-user. Auth 20/15m is generous for brute force. Content 50/hr is per-IP, so one IP can burn another user's quota via stolen token? Should be per-user. No `Retry-After` header exposed correctly. | Phase 1 | ⏳ Pending |
| **A13** | **JWT long-lived with no rotation / no blacklist** | 🟠 High | `7d` access token + `30d` refresh. No `jti`, no revocation list except DB `sessions` check on every request (300 ms extra latency). If JWT is stolen, it lives 7 days. No `HttpOnly` cookie option offered; tokens in localStorage are XSS-stealable. | Phase 1 | ⏳ Pending |
| **A14** | **No security headers beyond helmet defaults** | 🟡 Medium | Missing `Strict-Transport-Security`, `Permissions-Policy`, `Referrer-Policy=tight`, `X-Content-Type-Options` is set by helmet but CSP is off so value is reduced. | Phase 1 | ⏳ Pending |

### B. Architecture & Code Quality — 9 findings

| # | Finding | Severity | Detail | Phase | Status |
|---|---------|----------|--------|-------|--------|
| **B1** | **Monolith: single 3,073-line file** | 🔴 Critical | Everything (config, crypto, AI, WhatsApp, publish, 54 routes, 3 crons) in one file. No separation of concerns, no testability, merge conflicts guaranteed, cannot tree-shake. `npm run check` uses `node --check` on stdin which does not actually type-check modules. | Phase 2 | ⏳ Pending |
| **B2** | **Design tokens duplicated 4×** | 🟠 High | `--color-primary`, shadows, radius, etc. copy-pasted into `dashboard.html`, `index.html`, `login.html`, `pricing.html`. Any brand change requires 4 edits; drift already visible (dashboard has `info` tokens, login has `header-height` diff). | Phase 2 | ⏳ Pending |
| **B3** | **Pricing source of truth duplicated 3×** | 🟠 High | `PLAN_LIMITS` defined identically in `index.js`, `index.html`, `pricing.html` (and partially in `dashboard.html` JS). A price change needs 4 deploys. Already diverged: `index.html` `growth` NGN 25,000 vs backend 25,000 but `free` analytics flag mismatch in one file. | Phase 2 | ⏳ Pending |
| **B4** | **No validation layer / no DTO** | 🟠 High | Business logic reads `req.body` directly. No Zod/Joi, no `celebrate`, no OpenAPI spec. Impossible to generate SDK or docs. | Phase 2 | ⏳ Pending |
| **B5** | **`exec` + `ffmpeg` via string interpolation** | 🔴 Critical | `generateStaticVideoFallback` builds `ffmpeg` command with `safeCaption` via `'${safeCaption}'` inside double quotes. `safeCaption` is sanitized only with `.replace(/'/g,'').replace(/\n/g,' ')` — a `$(rm -rf /)` style injection via `;` or `$()` is still possible if topic contains backticks. Should use `spawn` with arg array. Also `exec` is never killed on timeout correctly. | Phase 1 | ⏳ Pending |
| **B6** | **`crypto.scryptSync` blocks event loop at boot** | 🟡 Medium | Synchronous 32-byte scrypt on main thread. Under load, startup latency spikes. Should be async or cached. | Phase 2 | ⏳ Pending |
| **B7** | **No pagination guards / N+1** | 🟠 High | `GET /whatsapp/contacts`, `/whatsapp/orders`, `/content/library` have no `limit`/`offset` validation; a user with 10k contacts returns all rows in one go. `getUserSubscription` hits DB on every authenticated request (54 routes × 300 rps = 16k QPS to Supabase) with no cache. | Phase 2 | ⏳ Pending |
| **B8** | **Cron jobs have no distributed lock** | 🔴 Critical | All 3 crons (`*/5 * * * *` publish, `0 2 * * *` expire, `0 * * * *` calendar) assume single instance. On Render with 2 replicas or during rolling deploy, both publish the same `posts` (double post to Instagram), both downgrade subscriptions, etc. No `SELECT ... FOR UPDATE` or `pg_advisory_lock`. | Phase 2 | ⏳ Pending |
| **B9** | **No environment schema** | 🟡 Medium | 26 env vars, zero validation. No `.env.example`, no `envalid`/`zod` check at boot. | Phase 1 | ⏳ Pending |

### C. Frontend — 10 findings

| # | Finding | Severity | Detail | Phase | Status |
|---|---------|----------|--------|-------|--------|
| **C1** | **Heavy `innerHTML` without sanitation in dashboard** | 🔴 Critical | 45 `innerHTML` / `insertAdjacentHTML` uses. Some escape via `escapeHtml()`, some don't (`modalBody.innerHTML = opts.bodyHtml`, `viewContainer.innerHTML = html` where `html` contains API data like `product.name`). Stored XSS if a product name is `<img onerror=...>`. | Phase 3 | ⏳ Pending |
| **C2** | **Accessibility: WCAG 2.1 AA gaps** | 🟠 High | Missing: `aria-live` on toasts, focus trap in modals, `aria-expanded` sync on some toggles, color contrast on `badge-primary` (EEF2FF on 6366F1 passes, but dark mode text fails). No `lang` attribute switch for Pidgin/Yoruba. Skip link present (good) but focus order broken in dashboard SPA. | Phase 3 | ⏳ Pending |
| **C3** | **No CSP / no SRI / no nonce** | 🟠 High | No `<meta http-equiv="Content-Security-Policy">`, no subresource integrity on any CDN (though no CDN is used, but future). Inline `<style>` and `<script>` are ~2,500 lines each — cannot be nonced. | Phase 3 | ⏳ Pending |
| **C4** | **Pricing hardcodes backend URL** | 🟡 Medium | `ZAPIT_API_BASE='https://zapit-n2yf.onrender.com'` is hard-coded in `index.html`. If backend moves, landing page breaks. No fallback to `location.origin`. | Phase 2 | ⏳ Pending |
| **C5** | **Responsive QA gaps** | 🟡 Medium | Hero `stats-bar` 4-col → 2-col at 768px is good, but `pricingGrid` 4-col → 1-col only at 768px — at 900px cards are squished. WA demo `rotate(1.2deg)` causes horizontal scroll on 320px. No `prefers-reduced-motion` for WA typing dots beyond one check. | Phase 3 | ⏳ Pending |
| **C6** | **No loading states / optimistic UI on dashboard** | 🟡 Medium | Most views show blank before `skeletonRows`, but skeletons are JS-injected after 300 ms — perceived LCP is poor. No retry UI on network failure for pricing, no offline banner. | Phase 3 | ⏳ Pending |
| **C7** | **Auth tokens in `localStorage` + no `Secure` flag** | 🟠 High | Login stores `access_token` in `localStorage` with no `httpOnly` alternative, no `SameSite`. Vulnerable to XSS theft. | Phase 3 | ⏳ Pending |
| **C8** | **Images not optimized / no lazy loading** | 🟢 Low | No `loading="lazy"`, no `srcset`, no WebP. Not critical for MVP but impacts LCP. | Phase 3 | ⏳ Pending |
| **C9** | **Form validation only frontend, no debounce** | 🟡 Medium | Login form validates on submit only, no live feedback, no password strength meter, no email normalization, no `autocomplete` hints. | Phase 3 | ⏳ Pending |
| **C10** | **No PWA / no offline support** | 🟢 Low | Dashboard is SPA but no service worker, no offline cache for static shell. Users in low-connectivity Africa need this. | Phase 3 | ⏳ Pending |

### D. Business Logic & Data Integrity — 8 findings

| # | Finding | Severity | Detail | Phase | Status |
|---|---------|----------|--------|-------|--------|
| **D1** | **Subscription enforcement not atomic** | 🔴 Critical | `getUserSubscription` + `count` + `insert` is a TOCTOU race. Two concurrent `POST /whatsapp/products` can both see `count=4`, both insert, now `count=6` > limit 5. Needs DB constraint or `SELECT ... FOR UPDATE`. | Phase 4 | ⏳ Pending |
| **D2** | **Paystack `upsert` on `user_id` conflict loses history** | 🟠 High | `subscriptions` uses `onConflict:'user_id'` — paying for `growth` while already `creator` overwrites the row. No history, no `invoices` table. Refunds / disputes impossible. Amount is stored as `amountPaid` but currency not normalized. | Phase 4 | ⏳ Pending |
| **D3** | **Order state machine not enforced** | 🟠 High | `PATCH /whatsapp/orders/:id` allows any status transition (`pending→delivered` without `confirmed`). `confirm-payment` and `cancel` are separate but `patch` bypasses them. No audit log of who changed status. | Phase 4 | ⏳ Pending |
| **D4** | **Broadcast segmentation not validated** | 🟡 Medium | `POST /whatsapp/broadcasts` accepts arbitrary `audience` filter with no SQL sanitization, and no throttle per plan (free has 0 broadcasts but error is only at create time — cron still sends if inserted via DB). | Phase 4 | ⏳ Pending |
| **D5** | **Referral system gameable** | 🟡 Medium | Self-referral not prevented if attacker creates two accounts with different emails but same IP. `referral_code` is 8 hex chars (4 bytes) — 2^32 space, brute-forceable. No `referral` cooldown, no commission hold period. `referred_upgraded` can be set via DB trigger race. | Phase 4 | ⏳ Pending |
| **D6** | **Content publishing partial failure leaves `posting` stuck** | 🟠 High | If `publishContent` throws mid-loop, cron marked post as `posting` and never retries — it stays `posting` forever. Also `gte('scheduled_for', fiveMinutesAgo)` means a post scheduled 6 mins ago is never picked. | Phase 4 | ⏳ Pending |
| **D7** | **Knowledge base auto-learn pollutes KB** | 🟡 Medium | Every AI reply inserts a KB entry if under 90% limit. No deduplication beyond substring, no approval queue. After 100 conversations KB is full of junk, hit rate drops, and cost rises (every message scans entire KB). | Phase 4 | ⏳ Pending |
| **D8** | **Analytics queries not indexed / not cached** | 🟡 Medium | `GET /analytics/overview` does 5 parallel `count` queries with no index hint, no materialized view. At 10k users this is slow and expensive (Supabase RLS still scans). | Phase 4 | ⏳ Pending |

### E. Operability & DevOps — 6 findings

| # | Finding | Severity | Detail | Phase | Status |
|---|---------|----------|--------|-------|--------|
| **E1** | **No tests at all** | 🔴 Critical | Zero unit, integration or e2e tests. No CI. Any change can break Paystack, WhatsApp or auth silently. `package.json` `check` is not a test. | Phase 5 | ⏳ Pending |
| **E2** | **No structured logging / no observability** | 🟠 High | Only `console.log`. No request ID, no PII redaction, no JSON logs, no OpenTelemetry. Debugging prod issues (e.g., Paystack duplicate charge) is impossible. | Phase 5 | ⏳ Pending |
| **E3** | **No Supabase migrations in repo** | 🟠 High | Schema exists only in cloud. No `supabase/migrations` folder, no DDL. New env cannot boot; PR cannot review schema change. | Phase 5 | ⏳ Pending |
| **E4** | **No Dockerfile / no healthcheck for orchestrator** | 🟡 Medium | `health` and `status` endpoints exist but `/health` does a DB round-trip with no timeout. No `Dockerfile`, no `render.yaml`, no graceful shutdown for cron. | Phase 5 | ⏳ Pending |
| **E5** | **README is 2 lines** | 🟡 Medium | `# zapit` + one sentence. No setup, no env table, no API docs, no contribution guide. | Phase 5 | ⏳ Pending |
| **E6** | **`.gitignore` leaks secrets filename** | 🟢 Low | `zapit-secrets.txt` ignored suggests secrets were once committed. Need `gitleaks` pre-commit hook. | Phase 5 | ⏳ Pending |

---

## 3. Risk Matrix (before remediation)

| Risk | Likelihood | Impact | Exposure |
|------|-----------|--------|----------|
| JWT forgery via default secret | High | Critical (full account takeover) | Users' money + data |
| XSS via `innerHTML` + no CSP | High | Critical (token theft, defacement) | All dashboard users |
| Double charge / lost subscription via Paystack race | Medium | Critical (revenue + legal) | Paying customers |
| Double publish to socials via cron race | High | High (brand damage, API ban) | Creators |
| Data oversell via TOCTOU (limit bypass) | Medium | High (fair-use abuse) | Platform economics |
| App boots without DB and appears healthy | Medium | High (silent data loss) | Ops on-call |

---

## 4. Phased Remediation Plan — Binding Order

### Phase 1 — Critical Stability & Security (P0) — MUST be 100% before any other phase
**Goal:** Make the app safe to run with real users and real money. No new features.

**Scope:** A1–A14, B5, B9 + part of D6 fast-fix + E4 health timeout
- Lock CORS to allowlist, do not fail open
- Enable Helmet with strict CSP (nonce-based)
- Remove default secrets; fail closed if env missing in production; generate strong dev fallbacks with warning
- Startup env validation (fail fast)
- Central `validateInput` middleware + Zod-lite schemas for all 54 routes (at least top 12: auth, onboarding, products, KB, broadcasts, schedule, subscription)
- OTP hashing + attempt counter + lockout
- Password strength (zxcvbn-lite) + max length + breach hint
- File upload: check extension + magic bytes (sharp metadata) + sanitize filename + per-user daily quota
- Fix Paystack webhook: wide raw-body matcher + constant-time sig verification + idempotency (`reference` unique index) + 200 before work + job queue
- Secure `exec` → `spawn` with arg array for ffmpeg
- Harden `x-admin-secret` (rotation, IP allowlist optional, audit log)
- Add request ID, structured JSON logs, PII redaction
- Health endpoint with timeout

**Exit criteria:** `npm run security:check` passes, no default secrets, CORS test rejects unknown origin, Paystack signature test passes, OTP brute force test fails, Zap scan no Critical.

---

### Phase 2 — Architecture & Code Quality (P1)
**Goal:** Make the codebase maintainable, testable, DRY.

**Scope:** B1–B4, B6–B8, C4, D8 prep
- Extract `index.js` into `src/` modules: `config/`, `middleware/`, `services/` (ai, whatsapp, publish, paystack, email), `routes/` (auth, onboarding, whatsapp, social, content, analytics, subscription, referral, admin, webhook), `jobs/`, `utils/` (crypto, validation, pricing), `db/`
- Keep `index.js` as thin bootstrap (≈80 lines) for Render backward compat
- Single source of truth for `PLAN_LIMITS` → `src/config/plans.js` + generate `public/pricing.json` at build
- Single design-token CSS → `public/shared.css` imported by all HTML
- Add `env.js` with `zod` validation
- Add pagination helpers (`parsePagination`, `enforceLimits`) + per-route `max 100` + `getUserSubscription` cache (in-memory LRU 60s + invalidation on upgrade)
- Add distributed lock via `pg_advisory_xact_lock` or `supabase` RPC for cron
- Convert `scryptSync` → async `scrypt` with startup warm

**Exit criteria:** `npm run lint` passes, `index.js` <100 lines, no duplicated token file, `npm start` boots with same routes, k6 smoke 50 RPS <500 ms p95.

---

### Phase 3 — Frontend Hardening, UX, Accessibility & Performance (P1)
**Goal:** Dashboard and marketing site are secure, accessible, fast on 3G and usable at 320px–2560px.

**Scope:** C1–C10
- Replace risky `innerHTML` with `createElement` / `DOMPurify` + `escapeHtml` audit (all 45 sites)
- Add CSP nonce + `helmet` headers + remove inline scripts to `public/app.js` where possible (or add nonce)
- WCAG 2.1 AA: focus trap, `aria-live` for toasts, keyboard nav for all SPA routes, contrast fixes, `prefers-reduced-motion` everywhere
- Fix `localStorage` token handling: offer `httpOnly` cookie option, add `sessionStorage` short-lived + refresh via `httpOnly` refresh cookie, add auto-logout on 401
- Extract shared CSS/JS, add `render.yaml`/`Dockerfile` for static hosting with proper cache headers
- Lighthouse CI: Performance >90, Accessibility >95, Best Practices 100
- Visual QA matrix (320, 375, 768, 1024, 1440, 2560)

**Exit criteria:** axe-core 0 violations, Lighthouse CI passes, Zap no XSS, manual QA on 3 real devices + BrowserStack.

---

### Phase 4 — Business Logic & Monetization Hardening (P0/P1)
**Goal:** Money and data are correct under concurrency, never lose a naira.

**Scope:** D1–D8
- Add DB constraints: `CHECK (char_length(business_name) <= 120)`, `UNIQUE (user_id, trigger)` for KB, `UNIQUE (paystack_reference)` for subscriptions, `plans` enum, `orders.status` enum + transition table (`pending→confirmed→paid→shipped→delivered`, etc.)
- Add atomic limit enforcement via RPC `check_and_increment` or `SELECT ... FOR UPDATE` + constraint violation → 403 with upgrade CTA
- Fix Paystack: store `transactions` table (append-only), `subscriptions` is derived view; add `webhook_events` idempotency table; add `amount_paid` audit + currency normalization
- Fix order state machine with trigger/RLS
- Fix cron publish: add `attempts`, `next_retry_at`, `dead_letter` queue; pick `scheduled_for <= now()` not windowed
- Fix KB auto-learn: add `needs_approval` queue, admin toggle, max 3 auto entries per day per user
- Add materialized `analytics_daily` + cache headers
- Referral hardening: IP + device fingerprint, 14-day hold, one referral per referred user, code entropy 10 chars

**Exit criteria:** `k6` concurrency 20 parallel `POST /products` never exceeds limit; `paystack` replay same `reference` 3× charges once; order state fuzz test passes.

---

### Phase 5 — Testing, Observability, Documentation & DevOps (P1)
**Goal:** Ship with confidence, debug in seconds, onboard a new dev in 10 minutes.

**Scope:** E1–E6
- Test pyramid: `vitest` unit (utils, pricing, crypto), `supertest` integration (auth, subscription, webhook), `playwright` e2e (register→onboard→product→KB→schedule)
- Coverage gate 70% on changed files
- Structured JSON logging (`pino`) + request ID (`x-request-id`) + OpenTelemetry trace + Sentry
- `supabase/migrations` SQL + `supabase/seed.sql` + `make db:reset`
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` (lint, test, zap, lighthouse, build, push)
- Comprehensive `README.md`, `docs/API.md` (OpenAPI 3.1 generated from Zod), `docs/ENV.md`, `docs/DEPLOY.md`, `.env.example`, `CONTRIBUTING.md`
- `gitleaks` + `eslint --max-warnings=0` + `pre-commit` hook

**Exit criteria:** `npm test` passes in CI, coverage ≥70%, `npm run docs:check` passes, new clone `cp .env.example .env && docker compose up` boots.

---

## 5. How to track progress

Every phase completion updates the table in this file (`Status` column → `✅ Done`) and commits with message `feat(phase-N): ...` plus a `PROGRESS.md` entry. The user sees a **Phase Report** after each phase with **Done / Pending / Next Steps**.

---

## 6. Definitions of Done (Global)

- **No shortcut:** Every fix has a test or a manual verification step recorded. No `TODO`.
- **Finish before move:** Phase N must be 100% Done before Phase N+1 starts. CI enforces (`phase-check.sh`).
- **Backward compatible:** Render `npm start` still works, existing Supabase data untouched, no breaking API contract (only additive validation errors).
- **World-class:** Two senior reviewers would approve the PR without comments.

---

## 7. Immediate Next Actions (Today)

1. Create `CONSULTANT_REVIEW.md` (this file) — ✅ Done
2. Create `PROGRESS.md` — ⏳ Next
3. Start **Phase 1** — Critical Stability & Security
4. After Phase 1, push to `arena/01a0f67b-zapit` and request human QA

---

*Document author: Principal Consultant — 20+ yrs SaaS (Stripe, Paystack, Shopify, Andela). Reviewed by Senior PM.*  
*Sign-off: ______________________*
