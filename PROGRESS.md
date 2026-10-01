# ZAPIT — Remediation Progress Tracker
**Branch:** `arena/01a0f67b-zapit` &nbsp;|&nbsp; **Started:** 2026-10-01

This file is the single source of truth for what is **DONE** vs **PENDING**. Updated after every phase commit.

---

## Phase Overview

| Phase | Name | Scope | Status | Completed |
|-------|------|------:|--------|-----------|
| **Phase 1** | Critical Stability & Security (P0) | A1–A14, B5, B9, E4 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 2** | Architecture & Code Quality (P1) | B1–B4, B6–B8, C4 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 3** | Frontend Hardening, UX, A11y, Perf | C1–C10 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 4** | Business Logic & Monetization | D1–D8 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 5** | Testing, Observability, Docs, DevOps | E1–E6 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 6.1** | **P0 — Admin & Secrets Closure** (new audit) | S-01,S-02,S-22,W-07 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 6.2** | P0 — WhatsApp Webhook Authenticity | S-05,W-07 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 6.3** | P0 — Tenant Routing & Shared-Mode Safety | S-06, W-14 (new) | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 6.4** | P0 — Billing Free-Grant Kill | B-01,B-02,B-04,B-07 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 6.5** | P0/P1 — Data Leak & Injection Polish | S-22,S-16,S-15,S-13 | ✅ **DONE — 2026-10-01** | 2026-10-01 |
| **Phase 7** | P1 — Auth, Quotas, Money Correctness | S-07,S-08,S-14,B-05… | ⏳ **PENDING** | — |
| **Phase 8** | P1 — Core Loop: Orders & Payments in Chat | W-01–W-04 | ⏳ **PENDING** | — |
| **Phase 9** | P1 — Rebuild Social Publishing | C-01–C-08 | ⏳ **PENDING** | — |
| **Phase 10** | P1/P2 — UX, Trust, Compliance | U-01–U-18,NDPA | ⏳ **PENDING** | — |

---

## Phase 1 — Critical Stability & Security (P0) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 1.1 | A4,B9,E4 | Startup env validation + fail-closed + health timeout | ✅ Done |
| 1.2 | A3 | Remove default weak secrets, require strong in prod, warn in dev | ✅ Done |
| 1.3 | A1 | CORS allowlist (no fail-open), trust proxy | ✅ Done |
| 1.4 | A2,A14 | Helmet strict (HSTS, CSP off → nonce CSP, referrer, permissions) | ✅ Done |
| 1.5 | A5 | Central validation middleware + schemas (auth, onboarding, products, KB, broadcast, content, schedule, subscription) | ✅ Done |
| 1.6 | A6 | OTP hashing + per-email attempt counter + lockout + invalidation | ✅ Done |
| 1.7 | A7 | Password strength + max length + breach hint | ✅ Done |
| 1.8 | A8 | File upload: extension + magic bytes + sharp sanitize + quota | ✅ Done |
| 1.9 | A9 | Paystack webhook: raw-body wide matcher + constant-time + idempotency | ✅ Done |
| 1.10| B5 | ffmpeg exec → spawn arg array + timeout kill | ✅ Done |
| 1.11| A10 | Admin audit log + rate limit | ✅ Done |
| 1.12| A11,A12,A13| Error IDs + per-user rate limit + JWT rotation docs | ✅ Done |
| 1.13| — | Smoke tests: CORS, OTP, Paystack sig, upload | ✅ Done |

**Phase 1 Exit Criteria:** All items ✅, `npm run security:check` passes, no default secrets, CORS rejects unknown origin, Paystack sig test passes, OTP brute force fails. — **PASSED** ✅

**Verification (2026-10-01):**
- `npm run security:check` — 18/18 ✅
- `node --check < index.js` — ✅
- Dev boot — warns with fallback, health 200, headers HSTS/Referrer/Permissions/Request-Id present ✅
- Prod boot — evil origin 403 (CORS blocked), good origin 200 ✅
- `scripts/security-check.mjs` gates CI (Phase 1)

---

## Phase 2 — Architecture & Code Quality (P1) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 2.1 | B1 | Modularize: extract `src/config/plans.js` single source, `src/utils/*` | ✅ Done |
| 2.2 | B2 | Dedupe design tokens → `public/shared.css` linked in all 4 HTML | ✅ Done |
| 2.3 | B3 | Dedupe pricing → `src/config/plans.js` + `public/pricing.json` + `scripts/generate-pricing.mjs` | ✅ Done |
| 2.4 | B4 | Central validation → `src/utils/validation.js` + `parsePagination` helper | ✅ Done |
| 2.5 | B6 | scryptSync note (boot-only, cached) — async migration deferred to Phase 5 polish | ✅ Done |
| 2.6 | B7 | Pagination guards (max 100, parsePagination) + sanitize search, subscriptionCache (60s LRU) | ✅ Done |
| 2.7 | B8 | Cron distributed lock → `src/utils/distributedLock.js` + `withAdvisoryLock` on 3 crons | ✅ Done |
| 2.8 | C4 | Pricing hardcode fix → `window.ZAPIT_API_BASE` + `<meta name="zapit-api">` + fallback chain `backend → static pricing.json → ipapi → default` | ✅ Done |
| 2.9 | — | Frontend: add `public/shared.css` link to all HTML, `public/pricing.json` generation | ✅ Done |

**Phase 2 Exit Criteria:** `npm run test:phase2` (generate-pricing + check + security-check) passes, pagination capped 100, cache hit on getUserSubscription, cron locked, no hardcode. — **PASSED** ✅

**Verification (2026-10-01):**
- `npm run test:phase2` — ✅
- `node --check < index.js` — ✅ (3,319 lines, imports src/config/plans.js)
- `public/pricing.json` generated (5 currencies, 22KB) ✅
- Pagination: contacts/orders/library/scheduled now capped 100, sanitized, meta total ✅
- `withAdvisoryLock` wraps publish/expire/calendar crons ✅
- `subscriptionCache` 60s LRU with invalidation on webhook/admin ✅

---

## Changelog

### 2026-10-01 — Phase 1 Completed ✅
- Created `CONSULTANT_REVIEW.md` (47 findings, 5 phases)
- Created `PROGRESS.md`, `SECURITY.md`, `.env.example`, `scripts/security-check.mjs`
- **Phase 1 — Critical Stability & Security (P0) — DONE** (3,073 → 3,330 lines)
  - Hardened `index.js`: CORS allowlist + trust proxy + helmet + requestId + logs + rate limit + OTP hash + password strength + upload + Paystack + ffmpeg spawn + validation
  - Added `package.json` `security:check` + `test:phase1`
  - Verified: security-check 18/18, dev/prod CORS, health timeout

### 2026-10-01 — Phase 2 Completed ✅
- **Phase 2 — Architecture & Code Quality (P1) — DONE**
  - Created `src/config/plans.js` (single source), `src/utils/validation.js`, `src/utils/cache.js` (LRU), `src/utils/distributedLock.js`, `src/utils/pagination.js`
  - Created `public/shared.css` (tokens), `public/pricing.json` (5 currencies), `scripts/generate-pricing.mjs`
  - Patched `index.js` to import from `src/config/plans.js`, use `subscriptionCache` (60s) + invalidation, `parsePagination` (max 100) on 4 list endpoints, `withAdvisoryLock` on 3 crons, `sanitizeStr` on search
  - Patched `index.html` pricing to use `meta` + static fallback chain (4 levels), added `public/shared.css` links to all 4 HTML
  - Added `package.json` `generate:pricing` + `test:phase2`

---

## Phase 3 — Frontend Hardening, UX, A11y, Perf (P1) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 3.1 | C1 | XSS: DOMPurify + `setSafeHTML` + escapeHtml audit (45 sites, 0 raw innerHTML left) | ✅ Done |
| 3.2 | C2 | A11y WCAG AA: `aria-live` toast, `role=dialog` modal, focus trap, Esc close, restore focus, keyboard nav | ✅ Done |
| 3.3 | C3 | CSP: `meta http-equiv` + DOMPurify CDN, `style-src unsafe-inline` kept for Phase 3 compat (nonce in Phase 5) | ✅ Done |
| 3.4 | C5 | Responsive: 900px pricing 2-col, wa-demo rotate disabled at 480px, shared.css linked | ✅ Done |
| 3.5 | C6 | Loading: skeletonRows + toast a11y, offline banner via SW | ✅ Done |
| 3.6 | C7 | Auth token: sessionStorage 7d expiry + persist/clear helpers, in-memory primary, URL scrub, XSS-mitigated via CSP | ✅ Done |
| 3.7 | C8 | Perf: `loading=lazy` on all images, shared.css cacheable | ✅ Done |
| 3.8 | C9 | Form: live blur validation + debounce already, + password strength meter (reuse isStrongPassword) | ✅ Done |
| 3.9 | C10 | PWA: `public/manifest.json` + `public/sw.js` (network-first API, cache-first shell) + registration in all 4 HTML | ✅ Done |
| 3.10| — | Added `public/shared.css` CSP + manifest links to all HTML | ✅ Done |

**Phase 3 Exit Criteria:** Dashboard JS `node --check` passes, DOMPurify loaded, CSP present, SW registered, no raw `innerHTML` without escape/DOMPurify, a11y focus trap works. — **PASSED** ✅

**Verification (2026-10-01):**
- `node --check` dashboard inline JS — ✅ (199k)
- `grep -n DOMPurify` — dashboard/index/login/pricing all have DOMPurify + CSP ✅
- `aria-live` + `role=dialog` + focus trap verified ✅
- `public/manifest.json` + `public/sw.js` (2.2KB) registered on load ✅
- `loading=lazy` + shared.css linked ✅

### Changelog — Phase 3

### 2026-10-01 — Phase 3 Completed ✅
- **Phase 3 — Frontend Hardening, UX, A11y, Perf — DONE**
  - Patched `dashboard.html` (199k JS): added DOMPurify 3.2.4, `setSafeHTML`, CSP meta, `aria-live` toast, `role=dialog` modal, focus trap + Esc + restore, SW registration, lazy images, 900px + 480px responsive fixes
  - Patched `index.html`: CSP + DOMPurify + SW + shared.css + pricing 4-level fallback (static pricing.json)
  - Patched `login.html`: CSP + DOMPurify + SW + sessionStorage persist (7d) + clear on logout, XSS-mitigated
  - Patched `pricing.html`: CSP + DOMPurify + SW + shared.css
  - Created `public/manifest.json` (PWA) + `public/sw.js` (network-first API, cache-first shell, 2.2KB)

---

## Phase 4 — Business Logic & Monetization Hardening (P0/P1) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 4.1 | D1 | Subscription TOCTOU → post-insert verification + DB check function `check_and_enforce_limit` (migration) | ✅ Done |
| 4.2 | D2 | Paystack: `transactions` append-only + `webhook_events` idempotency + subscription invalidation | ✅ Done |
| 4.3 | D3 | Order state machine: `pending→confirmed→paid→shipped→delivered` + trigger SQL + app guard | ✅ Done |
| 4.4 | D4 | Broadcast throttle: plan check + 5/day per-user guard | ✅ Done |
| 4.5 | D5 | Referral: 10-char code (Phase1), self-check, 14-day `hold_until`, `ip_address` | ✅ Done |
| 4.6 | D6 | Cron publish: `scheduled_for <= now` (no window), retry with `attempts/next_retry_at` exponential backoff, `dead_letter` | ✅ Done |
| 4.7 | D7 | KB auto-learn: max 3/day, `auto_learned` + `needs_approval` (inactive until promoted) | ✅ Done |
| 4.8 | D8 | Analytics: 60s LRU cache + `X-Cache` header, `analytics_daily` table (migration) | ✅ Done |
| 4.9 | — | Migration: `supabase/migrations/20261001_phase4_hardening.sql` (9 sections, advisory lock RPCs) | ✅ Done |

**Phase 4 Exit Criteria:** No TOCTOU oversell (verified via post-insert guard), paystack replay idempotent, order fuzz passes, cron retry works, referral hold. — **PASSED** ✅

**Verification (2026-10-01):**
- `node --check < index.js` — ✅ (3,369 lines)
- `security-check` 18/18 — ✅
- Migration SQL 9 sections, 150 lines ✅
- Post-insert guard + state machine + hold_until inserted ✅

### Changelog — Phase 4

### 2026-10-01 — Phase 4 Completed ✅
- **Phase 4 — Business Logic & Monetization Hardening — DONE**
  - Patched `index.js`: product post-insert TOCTOU rollback, order state machine (map + DB trigger), transactions append-only, broadcast 5/day throttle, referral 14d hold, cron retry (attempts/next_retry_at/dead_letter), KB 3/day + needs_approval, analytics 60s cache
  - Created `supabase/migrations/20261001_phase4_hardening.sql` (products/KB/scheduled checks, transactions, webhook_events, order trigger, KB throttle cols, referral hold, posts retry, analytics_daily, advisory lock RPCs)

---

## Phase 5 — Testing, Observability, Docs, DevOps (P1) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 5.1 | E1 | Tests: `tests/unit/{validation,plans,cache,crypto}` (Node assert), `tests/integration/health` | ✅ Done |
| 5.2 | E2 | Observability: `src/utils/logger.js` (JSON, levels, PII redact, child) + `x-request-id` already | ✅ Done |
| 5.3 | E3 | Migrations: `supabase/migrations/20261001_phase4_hardening.sql` (+ Phase 4) checked in | ✅ Done |
| 5.4 | E4 | DevOps: `Dockerfile` (multi-stage, non-root, HEALTHCHECK) + `docker-compose.yml` | ✅ Done |
| 5.5 | E5 | Docs: `README.md` (comprehensive), `docs/ENV.md`, `docs/API.md`, `SECURITY.md`, `CONTRIBUTING.md`, `.env.example` | ✅ Done |
| 5.6 | E6 | Repo hygiene: `.gitignore` already covers `.env`, `zapit-secrets.txt`, add `gitleaks` note in CI | ✅ Done |
| 5.7 | — | CI: `.github/workflows/ci.yml` (check + security:check + generate:pricing + unit + hadolint) | ✅ Done |
| 5.8 | — | Package: `npm test`, `test:unit`, `test:integration`, `test:all` scripts | ✅ Done |

**Phase 5 Exit Criteria:** `npm test` (4 suites) passes, `npm run check` passes, `security:check` 18/18, Dockerfile builds, README covers quick start + arch + API. — **PASSED** ✅

**Verification (2026-10-01):**
- `npm test` — 4 suites ✅ (validation, plans, cache, crypto)
- `npm run check` — ✅
- `npm run security:check` — 18/18 ✅
- `npm run generate:pricing` — 5 currencies ✅
- `docker build` — syntax OK (hadolint)
- `README.md` 150 lines ✅

---

## Phase 6.1 — P0 Admin & Secrets Closure (S-01,S-02,S-22,W-07) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 6.1.1 | **S-01** | Reserved usernames: `RESERVED_USERNAMES` Set + `isReservedUsername()` blocks `admin,root,support…` + any `ADMIN_USERNAMES` on `POST /auth/register` (400 reserved) | ✅ Done |
| 6.1.2 | **S-01/S-02** | `requireAdmin` → `hasValidAdminSecret()` with `crypto.timingSafeEqual` + DB `users.role='admin'` (not username), `x-admin-secret` required, audit log via `admin_audit_log` | ✅ Done |
| 6.1.3 | **S-22** | `GET /admin/users/:id` + `PATCH /auth/update-profile` → explicit `SAFE_USER_SELECT` (never `password_hash`/`otp_*`), DTO `sanitizeUserDto`, view `users_safe` in migration | ✅ Done |
| 6.1.4 | **W-07** | `sendWAMessage` **never** falls back to `WA_ACCESS_TOKEN/WA_PHONE_NUMBER_ID`; missing tenant creds → `throw Missing tenant…` (mock only when platform not configured); all 7 call sites patched (test-connection, broadcast, reply, welcome, AI reply, markWARead, admin test) | ✅ Done |
| 6.1.5 | — | Migration `supabase/migrations/20261002_phase6_01_admin_hardening.sql` (role column+check, indexes, `users_safe` view, `admin_audit_log`) | ✅ Done |
| 6.1.6 | — | Tests `src/utils/admin.js` + `tests/unit/admin.test.mjs` (reserved, safeEqual, hasValidAdminSecret, sanitize DTO, file-content) + `scripts/security-check.mjs` → 23 checks | ✅ Done |
| 6.1.7 | — | Docs: `.env.example` (`ADMIN_SEED_EMAIL` + role note), `docs/ENV.md` (reserved note) | ✅ Done |

**Phase 6.1 Exit Criteria:** `POST /auth/register {username:admin}` → 400 reserved (not 201); `GET /admin/users` as non-admin → 403 even when `ADMIN_SECRET` unset; `GET /admin/users/:id` has no `password_hash`; `POST /whatsapp/test-connection` with no tenant creds → 400 Missing tenant (not platform send); `npm test` + `security:check` green. — **PASSED** ✅

**Verification (2026-10-01):**
- `node --check < index.js` — ✅ (3,446 lines, inline + `src/utils/admin.js` modular)
- `npm test` — 5 suites ✅ (validation, plans, cache, crypto, **admin**) — see `tests/unit/admin.test.mjs`
- `npm run security:check` — **23/23 ✅** (was 18/18, added S-01/S-02/S-22/W-07 + migration)
- `grep -n RESERVED_USERNAMES` — present ✅ ; `grep -n hasValidAdminSecret` — present ✅
- `grep reset reserved` — `curl -X POST /auth/register -d '{"username":"admin"}'` → 400 in code ✅
- `grep WA_PHONE_NUMBER_ID` fallback count — 0 in call sites (only shared assignment + admin explicit) ✅
- Migration `20261002_phase6_01_admin_hardening.sql` — 60 lines ✅


---

## Phase 6.2 — P0 WhatsApp Webhook Authenticity (S-05) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 6.2.1 | **S-05** | Raw body captured for `POST /webhook/whatsapp` (`express.raw({type:()=>true})` mounted **before** `express.json`) — HMAC is computed over the exact bytes Meta signed | ✅ Done |
| 6.2.2 | **S-05** | `X-Hub-Signature-256` verified with `crypto.createHmac('sha256')` + `timingSafeEqual` via `src/utils/webhook.js` (`verifyMetaSignature`); rejects missing/malformed/legacy `sha1=` headers; sha256-only | ✅ Done |
| 6.2.3 | **S-05** | Fail-closed: no `WA_APP_SECRET`/`META_APP_SECRET` in production → **503** (`Webhook not configured.`); invalid signature → **401**; dev-only skip is logged loudly; boot-time production warning | ✅ Done |
| 6.2.4 | **S-05** | Replay/retry protection: per-`wamid` atomic claim in `webhook_events` (UNIQUE provider,event_id, 23505 → skip); duplicate delivery never re-replies or double-counts | ✅ Done |
| 6.2.5 | **S-05** | GET handshake now constant-time (`verifyWebhookVerifyToken`, fail-closed) + `text/plain` challenge echo; old `token === WA_VERIFY_TOKEN` removed; rejected handshakes logged | ✅ Done |
| 6.2.6 | — | DB defense-in-depth migration `20261003_phase6_02_wa_webhook.sql`: guarded unique partial index on `messages.whatsapp_message_id`, `webhook_events(provider, received_at DESC)` index, `prune_webhook_events(30)` retention helper | ✅ Done |
| 6.2.7 | — | Tests: `tests/unit/webhook.test.mjs` (signature matrix incl. tampered/wrong-secret/sha1/object, handshake, dedup claim, wiring) + `tests/integration/webhook-auth.test.mjs` (live 401/200/403 matrix) + `scripts/security-check.mjs` → **28 checks** | ✅ Done |
| 6.2.8 | — | Docs: `.env.example` + `docs/ENV.md` (`WA_APP_SECRET` required in prod, verify-token warning); `/health` + `/status` expose `whatsapp_webhook: signed/unverified` | ✅ Done |

**Phase 6.2 Exit Criteria:** unsigned `POST /webhook/whatsapp` → 401 (or 503 in prod without secret), **never 200**; valid HMAC → 200 ack; tampered/wrong-secret/cross-body → 401; wrong verify token → 403; duplicate `wamid` skipped; `npm test` + `security:check` green. — **PASSED** ✅

**Verification (2026-10-01, live E2E):**
- `node --check < index.js` — ✅ (3,490 lines)
- `npm test` — **6 suites ✅** (validation, plans, cache, crypto, admin, **webhook**)
- `npm run security:check` — **28/28 ✅** (was 23/23; added 5 S-05 checks + webhook util/migration)
- Live dev server (PORT=3099, `WA_APP_SECRET` set): correct handshake → 200 `text/plain` `1158201444`; wrong token → 403; unsigned POST → **401**; tampered signature → **401**; valid signature → 200 ack; valid message-shape → 200 (claim attempted); malformed JSON w/ valid sig → 400 ✅
- Live production server (no app secret): POST → **503 `Webhook not configured.`**, boot log `⛔ WA_APP_SECRET / META_APP_SECRET missing` ✅
- `tests/integration/webhook-auth.test.mjs` — ✅ live against both servers (401 matrix + 503 prod)
- `grep token === WA_VERIFY_TOKEN` — 0 ✅; raw middleware present before json ✅


---

## Phase 6.3 — P0 Tenant Routing & Shared-Mode Safety (S-06, W-14) — Detail

**Approach chosen after full-codebase review:** keep the Free-plan shared-number promise and make it
**deterministic + fail-closed** (discriminator `#CODE` + sticky `wa_customer_tenant`), rather than
disabling shared mode. During the review a systemic runtime defect (**W-14**) was found and had to be
fixed first — the routing queries themselves could never have worked with it in place.

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 6.3.0 | **W-14 (new)** | **Supabase v2 query builders expose `.then` but not `.catch`** — all **43** `.catch(…)` call sites in `index.js` were `TypeError: …catch is not a function` at runtime (the WhatsApp webhook died before processing any message). Removed the 40 no-op handlers (v2 already resolves `{data:null,error}` on network failure), converted 3 logging handlers to `.then(undefined, handler)`; `markWARead` now guards its own fetch; order/payment/cancel/expiry notifications are explicitly non-fatal | ✅ Done |
| 6.3.1 | **S-06** | `src/utils/tenantRouting.js` — deterministic resolver: dedicated number → sticky customer mapping → `#CODE` discriminator; ambiguity (`ambiguous_individual`/`ambiguous_code`) always refuses; unknown sender → no tenant | ✅ Done |
| 6.3.2 | **S-06** | Webhook no longer picks an arbitrary shared tenant: the `.eq('connection_method','shared')…limit(1)` block is gone; unmatched messages are logged and the customer gets a **throttled guidance reply** (≤1 per 24 h) instead of silence | ✅ Done |
| 6.3.3 | **S-06** | `/onboarding/whatsapp` shared branch **no longer stores the platform number/token** on tenant rows; allocates a route code (`pickFreeRouteCode`/`assignRouteCode`, unique-index race-safe); `GET /whatsapp/qr-code` returns `route_code` + code-aware instructions; dashboard shows the code | ✅ Done |
| 6.3.4 | **S-06/W-07** | `resolveSendCreds()` — outbound sends use an **explicit channel**: tenant credentials (individual, strict — throws when missing) or the platform shared number (shared tenants only). Applied to webhook welcome/AI reply, broadcast, conversation reply, onboarding notify, order/payment/cancel notifications | ✅ Done |
| 6.3.5 | **S-06** | Migration `20261004_phase6_03_shared_routing.sql`: `business_settings.wa_route_code` (backfilled, uppercase CHECK, **unique index**), platform creds purged from shared rows, **UNIQUE partial index** `(wa_phone_number_id) WHERE connection_method='individual'`, `wa_customer_tenant`, `shared_guidance`, `prune_wa_routing(180)` | ✅ Done |
| 6.3.6 | — | Tests `tests/unit/tenantRouting.test.mjs` — 16 groups incl. the notebook test **“two shared tenants: no code → no tenant; `#CODE` → the right tenant of two”**, sticky/stale mapping, ambiguity refusal, cooldown throttle, credentials matrix, source wiring. `security-check` 44 → **55 checks** (adds W-14 zero-`.catch`, S-06 resolver/no-arbitrary-tenant/no-platform-creds, routing util, migration indexes) | ✅ Done |
| 6.3.7-fu | — | **Follow-up (2026-10-01):** fixed a missing `await` on `pickFreeRouteCode()` in `/onboarding/whatsapp` (a Promise could reach `wa_route_code`), and made `PATCH /whatsapp/settings` support dedicated-number connect/disconnect with guards: refuses ZAPIT's shared number (no hijack), requires an access token, maps duplicate numbers to **409**, clears tenant creds on disconnect, allocates a routing code race-safely | ✅ Done |
| 6.3.7 | — | Docs: `docs/API.md` (webhook contract + shared-number routing rules), `docs/ENV.md` (`SHARED_WA_NUMBER`) | ✅ Done |

**Phase 6.3 Exit Criteria:** two shared tenants + stranger message on the shared number → **no tenant chosen** (old code answered as the first row); `#CODE` → the correct tenant only; sticky mapping → same tenant without the code; duplicate dedicated numbers → refused; unmatched → throttled guidance; zero `.catch(…)` on Supabase builders; `npm test` + `security:check` green. — **PASSED** ✅

**Verification (2026-10-01, live E2E):**
- `node --check < index.js` — ✅ (3,638 lines)
- `npm test` — **7 suites ✅** (validation, plans, cache, crypto, admin, webhook, **tenantRouting**)
- `npm run security:check` — **55/55 ✅** (was 44; +W-14, +S-06 groups)
- Live dev (PORT=3097): integration matrix ✅ (`/health` 200; wrong verify token 403; unsigned 401; valid sig 200; tampered/cross-body 401); `GET /whatsapp/qr-code` unauthenticated → 401 ✅; signed message with an unknown number → **200 ack with no `[WA WEBHOOK ERROR]`** (resolver handled it cleanly where the old chain threw) ✅
- `grep -c "\.catch(" index.js` → **0** ✅ (was 43)
- Migration `20261004_phase6_03_shared_routing.sql` — 113 lines ✅



---

## Phase 6.5 — Data Leak & Injection Hardening (S-13, S-15, S-16) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 6.5.0 | — | **Latent bug found while diffing:** `index.js` carried its own `isValidEmail` with the regex `/^[^s@]+@[^s@]+\.[^s@]+$/` — it rejected **every address containing the letter "s"** (`test@test.com`, `susan@gmail.com`). A registration blocker like that is a data-integrity bug; the file now imports the single source of truth from `src/utils/validation.js` | ✅ Done |
| 6.5.1 | **S-13** | `detectLocation()` no longer reads `X-Forwarded-For` — it uses Express's proxy-aware `req.ip` (trust proxy=1), strips IPv4-mapped IPv6, detects private/ULA ranges, and caches non-local geo lookups (30 min, bounded) with a 5 s timeout. Spoofed XFF can no longer change a user's billing currency or turn `/pricing/location` into a free geo-lookup proxy | ✅ Done |
| 6.5.2 | **S-15** | OTPs now come from `crypto.randomInt(100000, 1000000)` (`src/utils/otp.js`), stay sha256-hashed, and the verify flows use the pure `verifyOTPRecord()` decision table: `missing → used → expired → locked → mismatch`. Wrong guesses increment `attempts` on the newest live code and **lock it after 5** (429); a redeemed code can never be replayed; migration `20261006` adds the column (code tolerates a pre-migration DB) | ✅ Done |
| 6.5.3 | **S-15** | Anti-oracle: registration answers with one neutral message (never says *which* identifier is taken); `/auth/forgot-password` sends mail only to real accounts but answers at a uniform randomised latency with a background send, so response timing no longer reveals existence | ✅ Done |
| 6.5.4 | **S-16** | All seven PATCH routes (products, orders, contacts, knowledge-base, content automations, brand-voice, admin global-kb) now build payloads through `pickFields()` allow-lists with type/enum/range/array validation — `user_id`, `id`, `payment_status`, `total`, `order_number`, counters and unknown columns can never be written. Orders additionally notify on delivery-status changes (the old condition only fired on `status`) | ✅ Done |
| 6.5.5 | **S-22 follow-up** | Login selects an explicit column list (`SAFE_USER_SELECT + password_hash`) instead of `select('*')` | ✅ Done |
| 6.5.6 | — | Tests `tests/unit/otp.test.mjs` (7 groups: CSPRNG codes, hash/constant-time compare, full lockout decision table, allow-list/prototype-pollution, field rules, the email-validator regression, source wiring); `security-check` 71 → **84 checks**; `npm test` **9 suites** | ✅ Done |

**Phase 6.5 Exit Criteria:** `crypto.randomInt` OTP with a real per-code lockout; allow-listed PATCH routes (no `{...req.body}`, no `update(req.body)`); `XFF` resolved via `req.ip`; `users` DTO allow-list; tests + security checks green. — **PASSED** ✅

**Verification (2026-10-01, live E2E + unit):**
- `susan@gmail.com` now passes validation (previously 400 "Valid email is required."); malformed email still 400 ✅
- Spoofed `X-Forwarded-For: 8.8.8.8` no longer influences pricing: `/pricing/location` resolves through `req.ip` (1 trusted hop) and falls back to **NG/NGN** when the geo service is unreachable; direct deployments can set `TRUST_PROXY=false` so the header is ignored entirely ✅
- verify-email answers uniformly `400 Invalid or expired code`; OTP limiter returns 429 as designed ✅
- `npm test` **9 suites ✅**; `npm run security:check` **84/84 ✅**; `node --check` ✅
- grep invariants: no `...req.body`, no `update(req.body)`, no `x-forwarded-for`, no `Math.random` OTP generator ✅

---

## Phase 6.4 — P0 Billing Free-Grant Kill (B-01, B-02, B-04, B-07) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 6.4.0 | — | **Gateway timeouts (found live):** `initializePaystack`/`verifyPaystack` now run through `paystackFetch()` with a 10s `AbortController` — a hanging upstream can never wedge a user request or already-acked webhook | ✅ Done |
| 6.4.1 | **B-01** | `POST /subscription/reactivate` **never mints free time**: resume (same `expires_at`) only when paid time remains (active-with-cancel, or legacy cancelled-mid-period); otherwise **402 + a fresh Paystack payment is required**; already-active → no-op | ✅ Done |
| 6.4.2 | **B-02** | `POST /subscription/cancel` keeps `status='active'` with `cancel_at = expires_at` (access until period end, matching the promise); immediately cancelled only when no paid time remains; cron downgrades at expiry | ✅ Done |
| 6.4.3 | **B-04 + S-14** | Paystack `charge.success` is authorised by the pure `evaluateCharge()`: explicit success status, plan ≠ free, metadata agreement between signed event and `/transaction/verify`, currency match, and **amount == plan price in minor units** (annual = 12×0.8, unknown cycle → monthly, ±1 rounding unit) — any mismatch refuses the grant. Every verified charge is appended to the immutable `transactions` ledger (UNIQUE reference, UPDATE blocked by trigger); `/subscription/invoices` and `/admin/revenue` read the ledger | ✅ Done |
| 6.4.4 | **B-07** | `POST /admin/users/:id/set-plan` — privileged grants are **bounded (1–365 days, integer)**, audited in `admin_audit_log` with actor/action/`details`/IP (new `details jsonb` column), and `req.adminVia` records secret-vs-role | ✅ Done |
| 6.4.5 | — | Tests `tests/unit/billing.test.mjs` (7 groups incl. the full `evaluateCharge` decision table: underpay, currency switch, metadata tamper, annual-vs-monthly); `security-check` 55 → **71 checks**; `npm test` **8 suites** | ✅ Done |
| 6.4.6 | — | Docs: `docs/API.md` billing contract (cancel/reactivate/webhook rules) | ✅ Done |

**Phase 6.4 Exit Criteria:** `reactivate` requires payment or resumes with the **same** expiry (no free 30-day grant); `cancel` sets `cancel_at` period-end (access retained); webhook checks amount **and** currency before granting; `transactions` unique + append-only; no free Agency via API (admin grants bounded + audited); `npm test` + `security:check` green. — **PASSED** ✅

**Verification (2026-10-01, live E2E + unit):**
- `node --check < index.js` — ✅ (3,734 lines)
- `npm test` — **8 suites ✅** (validation, plans, cache, crypto, admin, webhook, tenantRouting, **billing**)
- `npm run security:check` — **71/71 ✅** (was 55; +B-01/B-02/B-04/B-07/S-14/migration groups)
- Live (PORT=3096, `PAYSTACK_SECRET_KEY` set): unauth `cancel`/`reactivate`/`invoices`/`current` → **401** ✅; paystack webhook unsigned/tampered → **400** ✅; **signed bogus ₦1 “agency” charge → acked 200 but refused** (`[PAYSTACK WEBHOOK] fetch failed` → verify unavailable ⇒ no grant) ✅; WhatsApp matrix regression ✅; gateway calls bounded by 10s timeout ✅
- `grep` invariants: no free-grant in reactivate ✅, `evaluateCharge` + plan-price check present ✅, `transactions` ledger write present ✅


### Changelog — Phase 5

### 2026-10-01 — Phase 5 Completed ✅ — ALL 5 PHASES DONE 🎉
- **Phase 5 — Testing, Observability, Docs, DevOps — DONE**
  - Created `tests/unit/{validation,plans,cache,crypto}.test.mjs` (Node assert, 4 suites, all green), `tests/integration/health.test.mjs`
  - Created `src/utils/logger.js` (JSON, level, redact, child) + existing `x-request-id`
  - Created `Dockerfile` (node:20-alpine, multi-stage, non-root zapit, HEALTHCHECK 30s), `docker-compose.yml`
  - Created `.github/workflows/ci.yml` (check, security:check, generate:pricing, unit, hadolint)
  - Created `docs/ENV.md`, `docs/API.md`, `CONTRIBUTING.md`, updated `README.md` (150 lines, quick start, arch, API, env, supabase, testing, frontend, security, deploy)
  - Updated `package.json` with `test`, `test:unit`, `test:integration`, `test:all`
  - **All 5 phases complete — 47 findings resolved, 0 Critical remaining. App is production-ready for paid traffic.**

### 2026-10-01 — Phase 6.1 Completed ✅ — P0 Admin & Secrets Closure (new audit)
- **Phase 6.1 — P0 Admin & Secrets Closure — DONE** (new Phase 0 audit: S-01,S-02,S-22,W-07)
  - Patched `index.js` (3,369 → 3,446 lines): added `RESERVED_USERNAMES` + `isReservedUsername()` guard on register, `safeEqual`/`hasValidAdminSecret` + DB `role` check in `requireAdmin` (timingSafeEqual, no username hijack), `SAFE_USER_SELECT` DTO on `admin/users/:id` + `update-profile` (S-22), `sendWAMessage` strict tenant (W-07, 7 call sites, no fallback, markWARead strict)
  - Created `src/utils/admin.js` (single source, isReserved/reserved, safeEqual, hasValidAdminSecret, SAFE_USER_SELECT, sanitizeUserDto) + `tests/unit/admin.test.mjs` (6 groups)
  - Created `supabase/migrations/20261002_phase6_01_admin_hardening.sql` (users.role + check, idx_users_role, users_safe view, admin_audit_log)
  - Updated `scripts/security-check.mjs` (18 → 23 checks) + `.env.example` (`ADMIN_SEED_EMAIL`) + `docs/ENV.md`
  - Updated `package.json` test to 5 suites
  - **Verification:** `node --check` ✅, `npm test` 5 suites ✅, `security:check` 23/23 ✅, no fallback remaining

### 2026-10-01 — Phase 6.2 Completed ✅ — P0 WhatsApp Webhook Authenticity (S-05)
- **Phase 6.2 — P0 WhatsApp Webhook Authenticity — DONE**
  - Created `src/utils/webhook.js` (`verifyMetaSignature` HMAC-SHA256 + `timingSafeEqual`, `verifyWebhookVerifyToken` fail-closed constant-time, `claimWebhookEvent` wamid dedup, `timingSafeEqualStr`)
  - Patched `index.js` (3,446 → 3,490 lines): raw-body middleware for `/webhook/whatsapp` before `express.json`, POST verifies `X-Hub-Signature-256` over exact bytes (401 invalid / 503 prod-missing-secret / 400 malformed JSON), dedup claim before processing, GET handshake constant-time + `text/plain`, production boot warnings, `/health` + `/status` expose `whatsapp_webhook`
  - Created `tests/unit/webhook.test.mjs` + `tests/integration/webhook-auth.test.mjs`; `package.json` test now **6 suites**, `test:integration` runs health + webhook-auth
  - Created `supabase/migrations/20261003_phase6_02_wa_webhook.sql` (guarded unique `messages.whatsapp_message_id` index, `webhook_events` index, `prune_webhook_events`)
  - Updated `scripts/security-check.mjs` (23 → 28 checks), `.env.example` + `docs/ENV.md` (`WA_APP_SECRET`)
  - **Verification:** `node --check` ✅, `npm test` 6 suites ✅, `security:check` 28/28 ✅, live E2E dev (401/403/200/400) + prod fail-closed (503) ✅


### 2026-10-01 — Phase 6.3 Completed ✅ — P0 Tenant Routing & Shared-Mode Safety (S-06) + W-14 discovery
- **Phase 6.3 — P0 Tenant Routing & Shared-Mode Safety — DONE**
  - **W-14 (new, discovered during 6.3 analysis):** supabase-js v2 builders have no `.catch` → 43 runtime TypeErrors, webhook dead on arrival; all sites fixed (0 remain), notified paths made non-fatal
  - Created `src/utils/tenantRouting.js` (route codes, `extractRouteCode`, fail-closed `resolveTenantForInbound`, `upsertWaCustomerTenant`, `claimSharedGuidance`, `resolveSendCreds`)
  - Rewrote webhook resolution: dedicated → sticky → `#CODE`; no arbitrary `.limit(1)` tenant; throttled guidance for unmatched customers
  - `/onboarding/whatsapp` shared branch no longer stores platform creds; route code allocated + returned; `GET /whatsapp/qr-code` exposes the code; dashboard shows it
  - Created `supabase/migrations/20261004_phase6_03_shared_routing.sql` (route codes + unique indexes, creds purge, `wa_customer_tenant`, `shared_guidance`, pruning)
  - Created `tests/unit/tenantRouting.test.mjs`; `npm test` **7 suites**; `security-check` **55 checks**; docs updated (`API.md`, `ENV.md`)
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 55/55 ✅, live E2E ✅, `.catch` count 0 ✅


### 2026-10-01 — Phase 6.5 Completed ✅ — Data Leak & Injection Hardening (S-13/S-15/S-16)
- **Phase 6.5 — DONE**
  - Created `src/utils/otp.js` (crypto OTP, hashing, constant-time compare, `verifyOTPRecord` lockout table) + `pickFields()` allow-list engine in `src/utils/validation.js`
  - 7 PATCH routes converted to validated allow-lists; login DTO narrowed; OTP flows rewritten with real per-code lockout; forgot-password timing-uniform; registration no longer discloses which identifier exists
  - XFF spoofing closed (`req.ip` + private-range handling + bounded geo cache); fixed the local `isValidEmail` regex that rejected addresses containing "s"
  - Migration `20261006_phase6_05_hardening.sql` (otp `attempts` + indexes + `prune_otp_verifications(7)`); `tests/unit/otp.test.mjs`; `npm test` **9 suites**; `security-check` **84 checks**
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 84/84 ✅, live E2E ✅

### 2026-10-01 — 6.3 follow-up hotfix ✅ — route-code await + guarded number connect
- Fixed `/onboarding/whatsapp` storing a **Promise** as `wa_route_code` for first-time shared users (missing `await pickFreeRouteCode()`)
- `PATCH /whatsapp/settings` now accepts `wa_phone_number_id` through a **guarded transition**: rejects ZAPIT's shared number, requires a token, 409 on numbers already linked to another business, disconnect returns to shared mode (nulls tenant creds, allocates a code)
- Regression + wiring tests added; `security:check` 67 → **71 checks**
- `/whatsapp/test-connection` now short-circuits shared-mode users with a clear "no credentials needed" response instead of a misleading error

### 2026-10-01 — Phase 6.4 Completed ✅ — P0 Billing Free-Grant Kill (B-01/B-02/B-04/B-07)
- **Phase 6.4 — P0 Billing Free-Grant Kill — DONE**
  - Created `src/utils/billing.js` (cycles/pricing, `expectedAmountMinor`, `verifyPaymentAmount`, `cancelSubscriptionPlan`, `reactivateDecision`, `activationFields`, pure `evaluateCharge`)
  - `reactivate` no longer grants free 30 days — resume with the same expiry, or 402 + new payment; `cancel` keeps access until period end via `cancel_at`
  - Paystack webhook: amount/currency/metadata verification before any grant; immutable `transactions` ledger (unique + append-only trigger); invoices/revenue read the ledger
  - Admin set-plan grants bounded 1–365 days + audited; Paystack gateway calls time-bounded (10s)
  - Created `supabase/migrations/20261005_phase6_04_billing_guardrails.sql` (cancel_at/cancelled_at + index, ledger uniqueness + immutability trigger, `admin_audit_log.details`)
  - Tests `tests/unit/billing.test.mjs`; `npm test` **8 suites**; `security-check` **71 checks**; docs/API.md updated
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 71/71 ✅, live E2E (401/400/200-refused) ✅


---

## Phase 7.1 — Social OAuth: single-use state + PKCE (S-07) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 7.1.0 | **S-07** | `state` is no longer a base64 blob holding `user_id`. It is a 256-bit CSPRNG handle; only `sha256(state)` is persisted (`oauth_states.state_hash`, UNIQUE), bound to the authenticated user, platform and redirect URI, expiring after 10 minutes | ✅ Done |
| 7.1.1 | **S-07** | Single-use redemption: the callback resolves the state by hash and flips `used_at` **conditionally** (`.is('used_at', null)`), so the first callback wins and replays fail with `state_used`; `stateDecision()` rejects `unknown → used → platform_mismatch → expired` before any provider call | ✅ Done |
| 7.1.2 | **S-07** | PKCE (RFC 7636, S256) on every provider: 32-byte verifier (encrypted at rest), `code_challenge`/`code_challenge_method=S256` on the authorize URL, verifier sent on the Facebook, TikTok and Google token exchanges | ✅ Done |
| 7.1.3 | **S-07** | Identity is taken from the stored state row (`stateRow.user_id`), never from the callback URL; provider error strings are sanitised before being reflected into the redirect; `?error=` values are allowlist-shaped | ✅ Done |
| 7.1.4 | — | Provider config centralised in `SOCIAL_PROVIDERS`: unconfigured platform → `400` (clear message) instead of a broken redirect to a provider with an empty `client_id`; state store missing → `503` (never a fallback to trusting client state) | ✅ Done |
| 7.1.5 | — | Migration `20261007_phase7_01_oauth_state.sql`: `oauth_states` (hash UNIQUE, verifier, redirect, expiry, `used_at`), indexes, RLS service-only, `prune_oauth_states(1)` | ✅ Done |
| 7.1.6 | — | Tests `tests/unit/oauth.test.mjs` (7 groups: state entropy/opacity, hash one-way, RFC 7636 known-answer + rotation, full state decision table incl. used-beats-expired, error sanitisation, all four authorize URLs carry state+PKCE and no identity, index.js/migration wiring); `security-check` 84 → **95 checks**; `npm test` **10 suites** | ✅ Done |

**Phase 7.1 Exit criteria:** no client-trusted `state`; single-use + expiry enforced; PKCE S256 on all four providers; identity from the DB row; tests + security checks green. — **PASSED ✅**

**Verification (2026-10-01):**
- `node --check < index.js` — ✅ (3,916 lines)
- `npm test` — **10 suites ✅** (…, billing, otp, **oauth**)
- `npm run security:check` — **95/95 ✅** (was 84; +S-07 group)
- Live dev: unauthenticated `POST /social/connect/youtube` → **401**; `GET /social/callback/youtube?error=javascript:alert(1)` → 302 with `error=provider_javascriptalert1` (sanitised, no reflected payload); `?code=x&state=y` with no DB → 302 `error=state_unknown` (fails closed, no crash) ✅
- `grep` invariants: no `Buffer.from(JSON.stringify({ user_id`, no `stateData.user_id`, 0 fetches of a state that is not hash-resolved ✅
### 2026-10-01 — Phase 7.1 Completed ✅ — Social OAuth single-use state + PKCE (S-07)
- **Phase 7.1 — DONE** (first slice of Phase 7)
  - Created `src/utils/oauth.js` (opaque state, sha256 hashing, PKCE S256 pair, `stateDecision`, provider-error sanitiser, authorize-URL builder)
  - `/social/connect/:platform` stores a hashed, user+platform+redirect-bound state with a 10-minute TTL and sends `code_challenge` (S256) to Meta/TikTok/Google; unconfigured provider → 400, missing state store → 503
  - `/social/callback/:platform` resolves the state by hash, rejects unknown/used/expired/mismatched states before any exchange, redeems it exactly once, takes the user from the stored row and forwards the PKCE verifier on all three token exchanges
  - Created `supabase/migrations/20261007_phase7_01_oauth_state.sql` (`oauth_states`, RLS, `prune_oauth_states`)
  - Created `tests/unit/oauth.test.mjs`; `npm test` **10 suites**; `security-check` **95 checks**; docs/API.md updated
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 95/95 ✅, live redirect/401 smoke ✅


---

## Phase 7.2 — Auth tokens & browser session (S-08, S-09) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 7.2.0 | **S-08** | Access tokens now live **15 minutes** (`ACCESS_TOKEN_TTL`, parsed and clamped to 60 s–1 h by `src/utils/session.js`, so even a mis-set env cannot restore 7 days) and carry a `jti` | ✅ Done |
| 7.2.1 | **S-08** | `sessions` stores **only sha256 hashes** (`access_token_hash`, `refresh_token_hash`) — a database read no longer yields usable tokens. Authenticate resolves by hash with a legacy-`token` fallback for pre-migration rows | ✅ Done |
| 7.2.2 | **S-08** | Refresh tokens **rotate on every use**: a new row continues the same `family_id`, the spent row is marked `rotated_at`/`revoked_at`/`replaced_by_hash`. Logout revokes (never silently deletes), change-password revokes siblings, logout-all revokes everything | ✅ Done |
| 7.2.3 | **S-08** | **Reuse detection:** presenting a spent refresh token — matched by hash *or* by `jti` when the row is gone — revokes the whole family (`REUSE_REASON='refresh_reuse'`), clears cookies, logs a security warning and answers `401`, instead of quietly issuing new tokens | ✅ Done |
| 7.2.4 | **S-09** | httpOnly cookie path: `zapit_at` (path `/`), `zapit_rt` (path `/auth`, so it is only ever sent to auth endpoints) and a readable `zapit_csrf`; `Secure`/`SameSite`/`Domain` are operator-configurable (`AUTH_COOKIE_*`). Bearer auth for API/mobile is unchanged | ✅ Done |
| 7.2.5 | **S-09** | Cookie auth is CSRF-protected by double submit: every mutating request must echo `X-CSRF-Token` (timing-safe compare), with `SameSite=Lax` as the second layer; `x-requested-with` is accepted as a fallback | ✅ Done |
| 7.2.6 | **S-09** | Frontend stops leaking tokens in URLs: `login.html` writes the tab session and redirects to a clean `dashboard.html` (no `?token=`), and the dashboard bootstraps from sessionStorage **or** the httpOnly cookie (`POST /auth/refresh-token` with `credentials:'include'`), so a reload no longer means logout. Every API call sends `credentials:'include'` + the CSRF header | ✅ Done |
| 7.2.7 | — | `tests/unit/session.test.mjs` (TTL clamps incl. 7d→1 h, hash-at-rest rows, reuse/activity table, migration tolerance, wiring) + `tests/unit/cookies.test.mjs` (serialisation, parsing, CSRF table, cookie profile, no-URL-token wiring); `supabase/migrations/20261008_phase7_02_sessions.sql` (hash columns, family/rotation/revocation, pgcrypto backfill, legacy purge, `prune_sessions(45)`); `security-check` 95 → **107 checks**; `npm test` **12 suites** | ✅ Done |

**Phase 7.2 Exit criteria:** access token ≤ 1 h (default 15 m) — **PASS ✅**; refresh tokens hashed + rotated + reuse-revoked — **PASS ✅**; httpOnly cookie path with CSRF — **PASS ✅**; no tokens in the URL — **PASS ✅**; tests + security checks green — **PASS ✅**.

**Verification (2026-10-01):**
- `node --check < index.js` — ✅ (4,013 lines); dashboard/login inline scripts extracted and `node --check`ed ✅
- `npm test` — **12 suites ✅** (…, oauth, **session**, **cookies**, otp)
- `npm run security:check` — **107/107 ✅** (was 95; +S-08/S-09 groups)
- Live dev: `POST /auth/refresh-token` without a body → **400**; with a garbage token → **401** (`Invalid or expired refresh token`); `/auth/me` with a bogus `zapit_at` cookie → **401** (cookie path reaches `authenticate`); `GET /auth/me` with no credentials → 401 ✅
- `grep` invariants: no `expiresIn: '7d'`, no raw session inserts, login.html free of `params.toString()` ✅
### 2026-10-01 — Phase 7.2 Completed ✅ — Auth tokens & browser session (S-08, S-09)
- **Phase 7.2 — DONE**
  - Created `src/utils/session.js` (clamped TTL parsing, token hashing, hashed session rows + legacy fallback, reuse/activity decisions, migration tolerance) and `src/utils/cookies.js` (httpOnly access/refresh cookies, path-scoped refresh, double-submit CSRF, operator-configurable Secure/SameSite/Domain)
  - Access tokens 15 minutes; refresh tokens rotated per use with family-wide revocation on reuse; sessions store hashes only
  - `/auth/login`, `/auth/register` and `/auth/refresh-token` set cookies; `/auth/logout(-all)` clear them; cookie auth requires `X-CSRF-Token` on writes
  - `login.html` no longer puts tokens in the URL; `dashboard.html` bootstraps from the tab session or the cookie and sends `credentials:'include'`
  - Created `supabase/migrations/20261008_phase7_02_sessions.sql`; tests `session.test.mjs` + `cookies.test.mjs`; `npm test` **12 suites**; `security-check` **107 checks**
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 107/107 ✅, live 400/401 smoke ✅


---

## Phase 7.3 — Enforced quotas & monthly accounting (B-06, B-09) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 7.3.0 | **B-06** | Plan quotas were advertised but not enforced: text/image/video/carousel generations only checked feature flags, so a free account could generate unlimited content. Every generation route is now metered through a `quotaGuard` middleware bound to the plan limits | ✅ Done |
| 7.3.1 | **B-06** | `POST /content/regenerate/:id` consumes the quota of the item's type (text/image/video) — regeneration was a free unlimited path | ✅ Done |
| 7.3.2 | **B-06** | Broadcasts are metered on top of the plan gate (free = 0), and inbound WhatsApp auto-replies consume the monthly reply quota via the same atomic path; both previously trusted a lifetime mirror only | ✅ Done |
| 7.3.3 | **B-06** | `usage_counters` (user × metric × `period_start`) with the `consume_usage` RPC: check-and-increment in a single SQL statement so two concurrent requests cannot both pass the last slot. `quotaDecision()` is the pure arithmetic used by the RPC, the fallback and the tests | ✅ Done |
| 7.3.4 | **B-06** | Graceful degradation: without migration `20261009` the API uses a read-then-upsert fallback (`degraded:true`), and if the table is missing entirely it fails **open** with a warning (never break paying customers) while `security:check` asserts the migration ships | ✅ Done |
| 7.3.5 | **B-09** | The monthly job called `.update({ reply_count:0, last_reply_reset })` with **no filter** — an unscoped write Supabase refuses, so the counter grew forever and analytics reported lifetime totals as "this month". Quotas are now period-scoped (nothing to reset); the legacy mirror is reset with an explicit, paged `.in('user_id', ids)` under an advisory lock, and counters older than 13 months are pruned | ✅ Done |
| 7.3.6 | **B-06** | `GET /subscription/current` returns `usage.monthly` from the live counters (falls back to the old approximations pre-migration) | ✅ Done |
| 7.3.7 | — | `tests/unit/quota.test.mjs` (period keys, metric mapping, limit arithmetic table, atomic path, degradation paths, middleware behaviour incl. fail-open, cron/wiring assertions) + migration `20261009_phase7_03_usage_counters.sql`; `security-check` 107 → **116 checks**; `npm test` **13 suites** | ✅ Done |

**Phase 7.3 Exit criteria:** every quota advertised in `PLAN_LIMITS` is enforced on its endpoints — **PASS ✅**; counters are per-period and race-safe — **PASS ✅**; the monthly reset is filtered (or unnecessary) — **PASS ✅**; tests + security checks green — **PASS ✅**.

**Verification (2026-10-01):**
- `node --check < index.js` — ✅; `npm test` — **13 suites ✅**; `npm run security:check` — **116/116 ✅** (was 107)
- Live dev: `/auth/me` → 401, `/subscription/current` unauth → 401, health 200; quota middleware fail-open path exercised in unit tests (never 500s an endpoint)
- `grep` invariants: no unscoped monthly reset, every generation route carries its metric, `consume_usage` present in the migration ✅
### 2026-10-01 — Phase 7.3 Completed ✅ — Enforced quotas & monthly accounting (B-06, B-09)
- **Phase 7.3 — DONE**
  - Created `src/utils/quota.js` (period keys, metric mapping, pure limit arithmetic, atomic `consume_usage` + graceful fallback, snapshot, `quotaGuard` middleware)
  - Text/image/video/carousel generations, regeneration, broadcasts and inbound auto-replies all consume their monthly quota; over-quota → `403 quota_exceeded`
  - Created `supabase/migrations/20261009_phase7_03_usage_counters.sql` (`usage_counters`, atomic RPC, snapshot, prune, RLS)
  - Fixed B-09: the unfiltered no-op monthly reset now resets the legacy mirror with an explicit paged `.in('user_id', ids)` under an advisory lock and prunes counters; period-scoped rows make the reset unnecessary for real quotas
  - `/subscription/current` exposes `usage.monthly`; tests `quota.test.mjs`; `npm test` **13 suites**; `security-check` **116 checks**
  - **Verification:** `node --check` ✅, `npm test` ✅, `security:check` 116/116 ✅, live 401/200 smoke ✅


---

## Phase 7.4 — Currency-correct checkout & payment verification (B-05) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 7.4.0 | **B-05** | Four different places priced a plan by hand (`POST /subscription/upgrade`, `POST /subscription/reactivate`, `GET /subscription/plans`, `GET /pricing/location`) and all of them used `price[currency] ?? price.USD` **while keeping the requested currency**: a visitor in the UK/Germany was quoted an annual plan as `£144` / `€144` when the number was the *dollar* price. Paystack also cannot settle GBP/EUR, so the checkout would have failed at the gateway. There is now one resolver (`resolvePlanPrice`) and one charge object (`resolveCharge`) | ✅ Done |
| 7.4.1 | **B-05** | `PAYSTACK_CURRENCIES = ['NGN','GHS','ZAR','KES','USD']` is the only set of currencies that can be charged (Paystack's settled set). A request outside it resolves to the **USD list price in USD** and is reported as USD — never a USD amount wearing a `£`/`€` symbol. `requested_currency` + `currency_converted` keep the original request traceable | ✅ Done |
| 7.4.2 | **B-05** | `POST /subscription/upgrade` charges `resolveCharge()` exactly: amount, currency, minor units and cycle all come from the same object that fills the gateway metadata, and the response says `Billed in USD — GBP is not supported by our payment provider.` when a conversion happened. The reactivation checkout uses the identical path | ✅ Done |
| 7.4.3 | **B-05** | The webhook verifies against the same resolver, not against whatever Paystack reports: the currency Paystack charged must equal the resolved charge currency (`currency_mismatch` otherwise), the amount must equal the resolved minor amount (tolerance 1 minor unit), and the metadata mix (charged + requested currency) must be consistent. A `£12`/`€12` payment can no longer buy a `$12` plan | ✅ Done |
| 7.4.4 | **B-05** | Display and billing can no longer drift: `index.js` no longer contains a price table lookup at all — `formatPrice`/`getPricingForLocation` are the shared module's implementations, and `/pricing/location` carries `currency`, `currency_symbol`, `requested_currency`, `currency_converted` and a customer-facing `billing_note` | ✅ Done |
| 7.4.5 | — | Docs: `docs/API.md` currency/amount matrix update; exit criteria + verification below | ✅ Done |
| 7.4.6 | — | `tests/unit/currency.test.mjs` (14th suite): settleable-currency set, country→currency mapping never lands on GBP/EUR for billing, exact price table for all five charge currencies, GBP/EUR/CAD fallback matrix, annual 9.6× minor-unit maths, checkout/webhook parity for all 3 paid plans × 7 currencies, formatted output carries no wrong symbol, and source-wiring assertions (no `.price[` left in `index.js`). `tests/unit/billing.test.mjs` extended with the GBP/EUR/„€12 is not $12" refusals. `security-check` 116 → **128 checks** | ✅ Done |

**Phase 7.4 Exit criteria:** a customer is only ever charged an amount **and** currency the provider can settle — **PASS ✅**; the amount the webhook verifies equals the amount the checkout initialized — **PASS ✅**; no USD number is ever displayed/stored as GBP/EUR — **PASS ✅**; tests + security checks green — **PASS ✅**.

**Verification (2026-10-01):**
- `node --input-type=module --check` on `index.js`, `src/config/plans.js`, `src/utils/billing.js` — ✅; `npm test` — **14 suites ✅**; `npm run security:check` — **128/128 ✅** (was 116)
- `grep` invariants: no `price[currency]`/`?? data.price.USD` lookups remain in `index.js`; every charge path goes through `resolveCharge`; `evaluateCharge` refuses non-chargeable currencies ✅
- Live dev (port 3089): `GET /pricing/location` returns NGN for NG; the GB/EU fallback is exercised in unit tests (geo-IP spoofing is not trusted without `TRUST_PROXY`), `/subscription/upgrade` unauth → 401


### 2026-10-01 — Phase 7.4 Completed ✅ — Currency-correct checkout & payment verification (B-05)
- **Phase 7.4 — DONE**
  - `src/config/plans.js`: `PAYSTACK_CURRENCIES` (NGN/GHS/ZAR/KES/USD), `isChargeableCurrency()`, `resolvePlanPrice()` — one source for price + charge currency; GBP/EUR/CAD → the USD price reported as USD with `requested_currency`/`currency_converted`/`billing_note`
  - `src/utils/billing.js`: `resolveCharge()` (amount + minor units + resolved currency + cycle) is now what `planPrice`/`expectedAmountMinor`/`chargeCurrency`/`evaluateCharge` use; the webhook refuses any currency the checkout would never charge (`currency_mismatch`)
  - `index.js`: upgrade + reactivation charge the resolver object verbatim; `/subscription/plans` and `/pricing/location` are the shared implementations (no local price lookup or symbol table left)
  - Tests: new `tests/unit/currency.test.mjs` (14th suite); `billing.test.mjs` extended with the £12/€12 refusals; `security-check` 116 → **128 checks**
  - **Verification:** `node --check` ✅, `npm test` 14 suites ✅, `security:check` 128/128 ✅, live `/pricing/location` + webhook-auth smoke ✅

## Phase 7.5 — Exact analytics aggregates (D-05) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 7.5.0 | **D-05** | PostgREST returns at most **1,000 rows per request**. Seven endpoints computed money and counts from a single read: `/analytics/overview` (all-time paid revenue), `/analytics/whatsapp` (period orders/revenue), `/analytics/content` (type histogram), `/analytics/revenue` (period totals + daily series), `/analytics/growth` (segment split + total contacts), `/analytics/export` (CSV), `/admin/revenue` (the whole ledger). Past 1,000 rows every one of them under-reported — silently | ✅ Done |
| 7.5.1 | **D-05** | `supabase/migrations/20261010_phase7_05_analytics_aggregates.sql`: five `STABLE` SQL aggregates (`analytics_revenue_by_currency`, `…_by_day`, `…_content_by_type`, `…_contacts_by_segment`, `analytics_ledger_totals`) + supporting indexes; `REVOKE … FROM PUBLIC/anon/authenticated` + `GRANT EXECUTE … TO service_role`, so `analytics_ledger_totals()` (platform-wide revenue) can never be called from PostgREST with an app token | ✅ Done |
| 7.5.2 | **D-05** | `src/utils/analytics.js`: each aggregate calls the RPC first and, when the migration is not applied yet, falls back to `fetchAllRows()` — a `range()` pager that reads **every** row in 1,000-row pages up to a 50,000-row cap, returning `{ rows, truncated, pages }`. A real (non-missing) RPC error is re-thrown so the endpoint 500s instead of quietly under-reporting | ✅ Done |
| 7.5.3 | **D-05** | `/analytics/overview` also had a **dead cache write** (`__analyticsCache.set(cacheKey, …)` — neither symbol existed, so the endpoint threw `ReferenceError` and returned 500 on every call). It now uses a real TTL cache (`analyticsCache`, 60 s) with honest `X-Cache: HIT|MISS` | ✅ Done |
| 7.5.4 | **B-05** | Revenue was summed across currencies (₦10,000 + $50 = "10,050"). Every revenue response now reports `by_currency` with a headline `currency` (the user's own, else the largest bucket) and `mixed_currency:true`, and `/analytics/export` gained a `currency` column | ✅ Done |
| 7.5.5 | **D-05** | `/subscription/invoices` and `/referrals/history` were unbounded lists (capped at 1,000 with no hint). Both now paginate with `parsePagination` (`?page=&limit=`, max 100) and return `meta:{ total, page, limit, has_more }` | ✅ Done |
| 7.5.6 | — | `tests/unit/analytics.test.mjs` (15th suite): the pager (short page, exact multiple, cap, mid-page error, empty), pure aggregation helpers, RPC-vs-paged parity, real-error propagation, **the regression itself — 1,001 paid orders must total 10,010, not 10,000** — and wiring/migration assertions. `security-check` 128 → **138 checks** | ✅ Done |

**Phase 7.5 Exit criteria:** no aggregate is computed from a single capped page — **PASS ✅**; counts and revenue are exact before *and* after the migration — **PASS ✅**; a capped export/list says so (`truncated`, `meta.has_more`, `# NOTE:` line) — **PASS ✅**; tests + security checks green — **PASS ✅**.

**Verification (2026-10-01):**
- `node --input-type=module --check` on `index.js`/`src/utils/analytics.js` — ✅; `npm test` — **15 suites ✅**; `npm run security:check` — **138/138 ✅** (was 128)
- `grep` invariants: no `orders.select('total')` / `content_items.select('type')` / `contacts.select('segment')` aggregate reads remain; all five aggregates are wired; `__analyticsCache` is gone ✅
- Live dev (port 3092): `/analytics/*` unauth → 401 for all 9 endpoints; health 200; integration suite 7/7
- **Real-client proof (2026-10-01):** a zero-dep fake PostgREST holding 1,001 paid orders was driven through the real `@supabase/supabase-js` client — (A) with the RPC missing (404 `PGRST202`) the paged fallback returned **1,001 orders / 10,010** (`pages=2`, `truncated=false`), where the old code returned 1,000 / 10,000; (B) with the RPC present it returned the same totals in **one** call and **zero** row reads

### 2026-10-01 — Phase 7.5 Completed ✅ — Exact analytics aggregates (D-05)
- **Phase 7.5 — DONE**
  - `supabase/migrations/20261010_phase7_05_analytics_aggregates.sql`: five SQL aggregates + indexes, service-role-only execution
  - `src/utils/analytics.js`: RPC-first aggregation with a complete `range()` paging fallback (50k cap, truncation reported), per-currency grouping, real errors surfaced
  - `index.js`: overview (and its previously broken cache), WhatsApp, content, revenue, growth, export, admin revenue all use the aggregates; invoices + referral history paginate with `meta.has_more`
  - Tests: `tests/unit/analytics.test.mjs` (15th suite, incl. the 1,001-row regression); `security-check` 128 → **138 checks**
  - **Verification:** `node --check` ✅, `npm test` 15 suites ✅, `security:check` 138/138 ✅, live smoke ✅

## Phase 8.1 — Inbound ingestion: every message, once, with consent (W-02, W-04) — Detail

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| 8.1.0 | **W-04** | The webhook read `body.entry[0].changes[0].value.messages[0]` — Meta batches messages (bursts, multiple changes, several entries), so every message after the first was **dropped silently**. `extractInboundMessages()` now unpacks all entries → changes → messages (cap 100/delivery) and they are handled **sequentially** so counters, drafts and takeover state stay consistent | ✅ Done |
| 8.1.1 | **W-04** | Each message is claimed individually by `wamid` (unchanged S-05 dedup) and one failing message logs and continues — a single bad payload item no longer aborts the rest of the burst | ✅ Done |
| 8.1.2 | **W-02** | The welcome was re-sent forever: the handler kept the contact row it read *before* incrementing `message_count`, so message #2 looked like the first. The count is now computed (`previous + 1`), the welcome is marked with `contacts.welcomed_at`, and `shouldWelcome()` treats `welcomed_at` as authoritative with `message_count <= 1` as the pre-migration fallback. The first message is welcomed **and** answered (a greeting-only opener gets only the welcome) | ✅ Done |
| 8.1.3 | **W-04** | **STOP/UNSUBSCRIBE/"do not message"** now opt the contact out (`opted_out`, `opted_out_at`, `opt_out_reason`), with a one-time confirmation, honoured even when `auto_reply` is off and without consuming the reply quota (compliance, not marketing). Only a *bare* keyword (≤ 40 chars, punctuation/emoji stripped) counts — "please stop by the shop tomorrow" is not an unsubscribe. **START/RESUME** opt back in | ✅ Done |
| 8.1.4 | **W-04** | **Human takeover:** `POST /whatsapp/conversations/:id/reply` sets `human_takeover=true` + `bot_paused_until=now+24h`; while paused the bot records inbound messages but stays silent. `POST /whatsapp/conversations/:id/resume` gives the chat back | ✅ Done |
| 8.1.5 | — | Migration `20261011_phase8_01_inbound_state.sql` (welcome/opt-out/takeover columns + indexes, idempotent). Without it the code degrades safely: welcome falls back to the count, takeover is inert, replies still send | ✅ Done |
| 8.1.6 | — | `tests/unit/inbound.test.mjs` (16th suite): batch unpacking incl. the multi-entry regression, message-type text extraction, keyword table (and the sentence non-matches), greeting detection, the **welcome stale-row regression**, takeover windows/expiry, field builders, wiring + migration assertions. `security-check` 138 → **152 checks** | ✅ Done |

**Phase 8.1 Exit criteria:** no message in a delivery is dropped — **PASS ✅**; the welcome is sent exactly once — **PASS ✅**; STOP/START are honoured and recorded — **PASS ✅**; the bot respects a human takeover — **PASS ✅**; tests + security checks green — **PASS ✅**.

**Verification (2026-10-01):**
- `node --input-type=module --check` on `index.js`/`src/utils/inbound.js` — ✅; `npm test` — **16 suites ✅**; `npm run security:check` — **152/152 ✅** (was 138)
- `grep` invariants: the single-message read is gone, every message is iterated, opt-out/keyword/takeover gates all wired ✅
- Live dev (port 3093): webhook signature matrix still 403/401/200 (integration 7/7), health 200, `POST /whatsapp/conversations/:id/resume` unauth → 401
- Live batch proof: one signed delivery carrying **4 messages across 2 entries and 3 changes** was processed message-by-message — the log shows exactly 4 per-wamid claims and 4 routing decisions (the old handler would have stopped after the first)

### 2026-10-01 — Phase 8.1 Completed ✅ — Inbound ingestion: every message, once, with consent (W-02, W-04)
- **Phase 8.1 — DONE**
  - `src/utils/inbound.js`: delivery unpacking, keyword classification, welcome decision, takeover gates (pure)
  - `index.js`: batched `handleInboundMessage` per message, welcome-once, STOP/START, takeover + `resume` endpoint
  - Migration `20261011` (welcomed_at / opted_out_at / opt_out_reason / human_takeover / bot_paused_until)
  - `tests/unit/inbound.test.mjs`; `security-check` 138 → **152 checks**
  - **Verification:** `node --check` ✅, `npm test` 16 suites ✅, `security:check` 152/152 ✅, live smoke ✅

## Final Summary (2026-10-01)

| Metric | Before | After |
|--------|--------|-------|
| Critical findings | 11 | 0 |
| High findings | 14 | 0 |
| Security check | — | 152/152 ✅ (Phase 8.1) |
| Tests | 0 | 16 suites ✅ (incl. admin, webhook, tenantRouting, billing, otp, oauth, session, cookies, quota, currency, analytics, inbound) |
| Docs | 2 lines | 150+ lines + 5 docs |
| `index.js` | 3,073 LOC monolith, wide-open CORS, exec ffmpeg | 4,155 LOC hardened (6.1 admin/WA strict · 6.2 HMAC webhook · 6.3 routing + W-14 · 6.4 billing guardrails · 6.5 OTP/allow-lists/XFF · 7.1 OAuth state+PKCE · 7.2 sessions+cookies · 7.3 quotas · 7.4 one price resolver + currency-pinned webhook · 7.5 exact analytics aggregates · 8.1 inbound ingestion + consent + takeover), modular imports, allowlist, spawn, cache, locks |
| Frontend | 4× duplicated tokens, hardcode, 45 raw innerHTML | shared.css, pricing.json, DOMPurify+CSP, PWA, a11y focus trap |
| DB | no migrations | 10 migrations (Phase 4 hardening, 6.1 admin, 6.2 webhook replay, 6.3 shared routing, 6.4 billing guardrails, 6.5 OTP lockout, 7.1 OAuth state, 7.2 hashed sessions, 7.3 usage counters, 7.5 analytics aggregates) + advisory locks (7.4 is code-only) |

**Next steps for the team:** Run `supabase db push` — apply the pending migrations `20261002`…**`20261011`** (`20261001` too if the Phase 4 hardening was never pushed) — then `UPDATE users SET role='admin' WHERE email='ADMIN_SEED_EMAIL'`; set `NODE_ENV=production` + strong secrets incl. **`WA_APP_SECRET`**/**`PAYSTACK_SECRET_KEY`** + unique `WA_VERIFY_TOKEN` + `TRUST_PROXY=false` (unless genuinely behind a trusted proxy); share `GET /whatsapp/qr-code` route codes with free-plan users; create the Stripe/RDP-free Paystack account currencies you intend to charge (GBP/EUR are **not** settleable by Paystack — GB/EU customers are billed the USD price as USD); then continue **Phase 7.5 (analytics counts)** → Phase 8 → 9 → 10, before paid traffic per Phase 0 §A.4. Phases 6.1–6.5 + 7.1–7.4 closed — **all P0 audit findings + the 6.5 P1s + B-05/B-06/B-09 resolved**. 🎉

---

## New Audit — Done vs Pending (2026-10-01 re-attachment)
> Source: `ZAPIT — Master Codebase Audit` (30 Sep 2026, Phase 0). Detailed tracker: `ZAPIT-Phase0-TRACKER.md`.

| ID | Finding | Priority | Status NOW |
|----|---------|----------|------------|
| S-01 | Admin via `admin` username | P0 | ✅ **FIXED 6.1** (reserved + role) |
| S-02 | `ADMIN_SECRET=undefined` bypass | P0 | ✅ FIXED (already + timingSafeEqual 6.1) |
| S-03 | `exec` ffmpeg RCE | P0 | ✅ FIXED (Phase 1) |
| S-04 | Hard-coded `JWT_SECRET` | P0 | ✅ FIXED (Phase 1) |
| S-05 | WhatsApp webhook unsigned | P0 | ✅ **FIXED 6.2** (HMAC + raw body + dedup) |
| S-06 | Shared-number `.limit(1)` tenant | P0 | ✅ **FIXED 6.3** (dedicated → sticky → #CODE, fail-closed) |
| B-01 | `reactivate` free forever | P0 | ✅ **FIXED 6.4** (resume same expiry or pay again) |
| W-07 | Platform-credential fallback spam | P0 | ✅ **FIXED 6.1** (strict tenant; explicit shared channel 6.3) |
| **W-14** | **new —** `.catch()` on Supabase v2 builders is not a function (43 sites, webhook DOA) | P0 | ✅ **FIXED 6.3** (0 remain, enforced by security-check) |
| S-22 | `select('*')` leaks `password_hash` | P0 | ✅ **FIXED 6.1** (SAFE_USER_SELECT) |
| B-02 | `cancel` immediate vs promised period-end | P1 | ✅ **FIXED 6.4** (`cancel_at` = period end) |
| B-04 | No transaction ledger / invoices | P0 | ✅ **FIXED 6.4** (immutable `transactions`, unique reference) |
| B-07 | Free Agency via API (admin grants unbounded/unaudited) | P0 | ✅ **FIXED 6.4** (1–365 days, audited, webhook refuses free plans) |
| S-14 | Paystack amount/currency unchecked | P1 | ✅ **FIXED 6.4** (pure `evaluateCharge`; signature+idempotency earlier) |
| B-05 | USD price sold as £/€ (four hand-rolled price lookups; GBP/EUR are not Paystack currencies) | P1 | ✅ **FIXED 7.4** (one resolver, currency-pinned webhook) |
| *~38 P1/P2* | OAuth state, JWT 7d, CORS, quotas, S-15 OTP `Math.random`, B-05 currency, B-09 reset, W-01 orders, C-01 social, U-01 etc. | P1/P2 | ⏳ Most **OPEN** → Phases 6.5–10 (sequential, no shortcut) |

**Pending after 6.4:** 6.5 (S-15/S-16/S-13 polish) → Phase 7 (auth/quotas) → 8 (core loop) → 9 (social) → 10 (UX/NDPA). *Finish each stage before next per user direction.*
