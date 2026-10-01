# ZAPIT — Phase 0 Master Audit → Tracker (New Attachment)
**Source:** `ZAPIT — Master Codebase Audit, Architecture Review & World-Class Upgrade Blueprint` (30 Sep 2026, Phase 0, no code modified) — pasted by user 2026-10-01  
**Current codebase:** `arena/01a0f67b-zapit` after Phases 1–5 + **6.1–6.5 + 7.1–7.5** (47 findings → 0 Critical; new audit S-01/S-02/S-05/S-06/S-07/S-13/S-15/S-16/S-22/W-07 + **W-14 (new)** + B-05/B-06/B-09/D-05 all FIXED, `npm test` 15 suites + `security:check` 138/138 + live E2E)  
**Rule:** Do in phases, report Done vs Pending, no shortcut, finish stage before next. This file is the single source of truth for the **NEW** audit.

> **Evidence labels per §0.1:** FACT/OBSERVATION/RISK/RECOMMENDATION as in Phase 0. Priorities P0/P1/P2/P3 as in §12.

---

## 0. Reconciliation — What the new Phase 0 adds vs our prior 47

Our prior `CONSULTANT_REVIEW.md` (47 findings) covered security, architecture, frontend, business logic, DevOps. The new Phase 0 is **deeper and wider** (≈70 findings with line-level FACTs, attack chains, NDPA, workload model). Mapping:

| New Phase 0 section | Overlap with prior 47 | New depth added (examples) |
|---------------------|------------------------|----------------------------|
| **S-01–S-06 (P0 security)** | A1–A4, B9 partly | S-03 shell RCE reproduced with `echo` sandbox; S-06 shared-number arbitrary tenant (FACT .limit(1)); S-01 admin by registering `admin` username |
| **S-07–S-14, S-22, S-25, W-07** | A6–A14 partly | OAuth `state` unsigned+no nonce (S-07), `trust proxy` missing (S-12), `select('*')` leaks `password_hash` (S-22), prompt injection auto-learn (S-25) |
| **B-01–B-11** | D1–D8 partly | B-01 `reactivate` free forever, B-02 cancel immediate vs promise, B-09 monthly reset `update()` with no filter (no-op), B-06 quotas unenforced |
| **W-01–W-13** | D1–D8 partly | W-01 **no order/payment code at all** (`generateOrderNumber` unused), W-02 welcome stale-state, W-04 `webhook_events` lost after 200 |
| **C-01–C-12** | — | Meta `accountId = /me.id` wrong (C-01), YouTube `videoBuffer` never sent (C-03), automations `next_generation_at` never set (C-05) — all P1 rebuilds |
| **U-01–U-18** | C1–C10 partly | `U-01` reload=logout, `U-11` pricing `payment-success` 404, `U-12` OAuth callback `settings/social` 404 |
| **§4 Database** | B1, B7, D8 | No schema/migrations, god-key RLS, 1,000-row truncation (D-05), no indexes list |

**Assumptions carried (A1–A3):** Render + service-role key + NG primary — same as Phase 0.

**Bottom line (§A.4) same:** *Do not onboard paying users until P0s done* — we honour that.

---

## 1. New Phase 0 — Prioritised Gap Table (condensed, with status NOW)

> Full table in Phase 0 §12; here we add **Status NOW** after Phases 1–5 and **Next Phase** for remaining work. Effort S/M/L/XL is from Phase 0.

| ID | Finding (short) | Priority | Effort | Status NOW (after Phases 1–5) | Next Phase |
|---|---|---|---|---|---|
| **S-01** | Admin via username `admin` (register `admin`) | **P0** | S | ✅ **FIXED 6.1** — `RESERVED_USERNAMES` + `isReservedUsername` blocks, `requireAdmin` → DB `role='admin'` (timingSafeEqual) | **DONE 6.1** |
| **S-02** | `ADMIN_SECRET=undefined` → `undefined===undefined` admin | **P0** | S | ✅ **FIXED** Phase 1 + **hardened 6.1** (`hasValidAdminSecret` timingSafeEqual, `safeEqual`) |
| **S-03** | `exec()` shell RCE via `duration`/`topic` → `ffmpeg` | **P0** | S–M | ✅ **FIXED** Phase 1 (`spawn` arg array, duration validate, tmp file, timeout) |
| **S-04** | Hard-coded `JWT_SECRET='zapit-secret-change-me'` + placeholder Supabase | **P0** | S | ✅ **FIXED** Phase 1 (fail-closed prod, random dev fallback, `__requireEnv`) |
| **S-05** | WhatsApp webhook unsigned | **P0** | S | ✅ **FIXED 6.2** — raw body + `X-Hub-Signature-256` HMAC `timingSafeEqual` (401/503 fail-closed), wamid replay dedup, constant-time GET handshake | **DONE 6.2** |
| **S-06** | Shared-number routes to arbitrary tenant (`.limit(1)`) | **P0** | M | ✅ **FIXED 6.3** — fail-closed resolver (dedicated → sticky `wa_customer_tenant` → `#CODE`), platform creds no longer stored on tenant rows, UNIQUE indexes, throttled guidance | **DONE 6.3** |
| **B-01** | `reactivate` gives free 30d forever | **P0** | S | ✅ **FIXED 6.4** — `reactivate` resumes the *same* expiry or returns **402 + Paystack `payment_url`**; no free period anywhere | ✅ 2026-10-01 |
| **W-07** | Platform-credential fallback → spam via platform number | **P0** | S | ✅ **FIXED 6.1** — `sendWAMessage` strict tenant (no fallback, throw), 7 call sites patched; explicit shared channel added 6.3 | **DONE 6.1 + 6.3** |
| **W-14** | *(new, found in 6.3 analysis)* `.catch()` on Supabase v2 builders is not a function — 43 sites, webhook dead on arrival | **P0** | S | ✅ **FIXED 6.3** — all 43 removed/converted, 0 remain, enforced by `security:check` | **DONE 6.3** |
| **S-22** | `select('*')` leaks `password_hash` via `/admin/users/:id` + `update-profile` | **P0/H** | S | ✅ **FIXED 6.1** — `SAFE_USER_SELECT` DTO + `users_safe` view, `sanitizeUserDto` | **DONE 6.1** |
| **S-07** | OAuth `state` unsigned, no nonce/expiry | P1 | S | ✅ **FIXED 7.1** — opaque CSPRNG state stored hashed + single-use + 10-min expiry, bound to user/platform/redirect; identity from the DB row; **PKCE S256** on Meta/TikTok/Google; unit + security checks | **DONE 7.1** |
| **S-08** | JWT 7d + raw `sessions` + no reuse detection | P1 | M | ✅ **FIXED 7.2** — access 15 min (clamped ≤ 1 h), refresh 30 d **rotated per use**, sha256-at-rest only, reuse revokes the session family, logout/change-password revoke | **DONE 7.2** |
| **S-09** | Tokens in URL `?token=` → logs/CDN, reload=logout | P1 | M | ✅ **FIXED 7.2** — httpOnly cookies (`zapit_at` + path-scoped `zapit_rt`), double-submit CSRF, login redirects with no query tokens, dashboard bootstraps from cookie/tab session (reload survives) | **DONE 7.2** |
| **S-10** | Open CORS (`cb(null,true)`) + CSP disabled | P1 | S–M | ✅ FIXED Phase 1 (allowlist, HSTS) — CSP meta added Phase 3, still `unsafe-inline` (needs split) |
| **S-11** | `50mb` JSON + 50 MB multer memory | P1 | S | ✅ FIXED Phase 1 (1mb JSON, 10MB/1 file) — still memory, needs streaming |
| **S-12** | No `trust proxy` → one bucket for all users | P1 | S | ✅ FIXED Phase 1 (`trust proxy 1`) |
| **S-13** | `X-Forwarded-For[0]` → currency arbitrage | P1 | S | ✅ **FIXED 6.5** — `detectLocation` uses proxy-aware `req.ip` (+ private-range handling, bounded 30-min geo cache, 5 s timeout); the header is never read | ✅ 2026-10-01 |
| **S-14** | Paystack no amount/currency check, no idempotency | P1 | M | 🟡 PARTIAL — idempotency added, **amount/currency not checked** | Phase 7 |
| **B-02** | `cancel` drops access immediately vs promise period-end | P1 | S | ✅ **FIXED 6.4** — `cancel` keeps `status='active'`, sets `cancel_at = expires_at` (access retained to period end) | ✅ 2026-10-01 |
| **B-03** | No recurring billing/dunning | P1 | L | 🔴 OPEN — `auto_renew` flag no worker | Phase 9 |
| **B-05** | Currency GBP/EUR → `price.USD` mis-pricing | P1 | M | ✅ **FIXED 7.4** — one resolver (`resolvePlanPrice`/`resolveCharge`); only the Paystack-settleable set is charged; GBP/EUR → USD price **reported as USD** with `requested_currency`/`currency_converted`/`billing_note`; the webhook refuses any currency the checkout never charges | **DONE 7.4** |
| **B-06** | Most quotas unenforced (text/image/video/contacts) | P1 | M | ✅ **FIXED 7.3** — `usage_counters` + atomic `consume_usage` RPC; text/image/video/carousel/regeneration/broadcast/reply paths metered; over-quota → `403 quota_exceeded`; graceful pre-migration fallback | **DONE 7.3** |
| **B-09** | Monthly reset `update({reply_count:0})` **no filter** → no-op | P1 | S–M | ✅ **FIXED 7.3** — quotas are period-scoped (no reset needed); the legacy mirror resets via a paged, explicitly filtered `.in('user_id', ids)` under an advisory lock, and stale counters are pruned | **DONE 7.3** |
| **W-01** | **No order/payment creation at all** | P1 | XL | ✅ **FIXED 8.2** — chat capture (product/quantity/address, `order_drafts`) → `orders` row via `generateOrderNumber()` + unique `zapord_…` reference → tenant-key Paystack link or bank reference → webhook verifies (reference/currency/amount) before `paid` + confirmation; `payment-link`/`verify-payment` recovery routes; migration `20261012` | **DONE 8.2** |
| **W-02** | Welcome stale-state (msg 1 & 2 both only welcome) | P1 | M | ✅ **FIXED 8.1** — the count is computed (never the stale row), `contacts.welcomed_at` marks the single welcome, first message is welcomed+answered | **DONE 8.1** |
| **W-03** | Broadcast free-text outside 24h → fails; scheduled never runs | P1 | L | 🔴 OPEN — scheduled insert no cron | Phase 8 |
| **W-04** | Webhook: only first message, no dedup, no human-takeover | P1 | M | ✅ **FIXED 8.1** — every entry/change/message processed (cap 100) with per-wamid dedup; STOP/START recorded with timestamps; manual reply sets `human_takeover` + a 24h bot pause, releasable via `/resume` | **DONE 8.1** |
| **C-01** | Meta `accountId=/me.id` wrong (needs Page/IG Business id) | P1 | L | 🔴 OPEN — OAuth still stores `/me.id` | **Phase 9 (rebuild publishing)** |
| **C-02** | No token refresh anywhere | P1 | L | 🔴 OPEN | Phase 9 |
| **C-03** | YouTube sends JSON only, no media | P1 | L | 🔴 OPEN | Phase 9 |
| **C-04** | IG URL/30s sleep, FB ignores video, TikTok `PULL_FROM_URL` unverified | P1 | L | 🔴 OPEN | Phase 9 |
| **C-05** | Automation `next_generation_at` never set, caption-only | P1 | M | 🔴 OPEN | Phase 9 |
| **D-05** | 1,000-row truncation in analytics/revenue | P1 | S–M | ✅ **FIXED 7.5** — five SQL aggregates (migration `20261010`, service-role only) + a complete `range()` paging fallback; overview/WhatsApp/content/revenue/growth/export/admin-revenue are exact past 1,000 rows; revenue is per-currency; invoices + referral history paginate with `meta.has_more`; the broken overview cache (ReferenceError → 500) replaced by a real TTL cache | **DONE 7.5** |
| **S-15** | OTP `Math.random`, plaintext, no per-code lockout, email existence oracle | P1 | S | ✅ **FIXED 6.5** — `crypto.randomInt` codes, sha256 at rest, real per-code lockout (5 wrong guesses → 429, code dead), constant-time compare, uniform forgot-password latency, neutral register message | ✅ 2026-10-01 |
| **S-16** | Mass assignment (`{...req.body}`) on 7 PATCH routes | P1 | S | ✅ **FIXED 6.5** — `pickFields()` allow-lists with type/enum/range validation on all 7 routes (+ admin global-kb); ids, `user_id`, `payment_status`, totals, counters are unreachable | ✅ 2026-10-01 |
| **…** | *Remaining P1/P2s (S-17–S-28, D-01–D-11, U-01–U-18 etc.)* | — | — | See full Phase 0 §12 — most remain **OPEN** | Phases 7–10 |

**Count:** P0 **9** items → 3 fixed, 6 open. P1 **~35** → ~7 fixed, ~28 open. P2/P3 remain.

---

## 2. Sequencing for NEW work (no shortcut, finish stage before next)

We keep the **5-phase foundation you approved (1–5 DONE)** and **continue as Phases 6–11** aligning to Phase 0 §13 recommendation: *stabilise → modularise → complete core loop → upgrade experience → scale*. Each phase is **atomic**: tests + `security:check` + manual verification before next.

| Phase | Name (new) | Scope from Phase 0 | Priority gated | Effort | Exit criteria (must all pass) |
|-------|------------|--------------------|----------------|--------|-------------------------------|
| **6.1** | **P0 — Admin & Secrets Closure** | S-01 (admin by name), S-22 (hash leak), W-07 fallback, S-02 follow-up hardening | P0 | S | ✅ **DONE 2026-10-01** — Register `admin` blocked (400); `/admin/*` requires DB `role='admin'`; `select('*')` gone; `sendWAMessage` never falls back; `security:check` 23/23 + 5 suites |
| **6.2** | **P0 — WhatsApp Webhook Authenticity** | S-05 (HMAC), S-25/S-06 related | P0 | S | ✅ **DONE 2026-10-01** — raw body captured, `X-Hub-Signature-256` HMAC `timingSafeEqual`, 401 invalid / 503 prod-missing-secret, wamid replay dedup, constant-time handshake; 6 suites + 28/28 + live E2E (401/403/200/503) |
| **6.3** | **P0 — Tenant Routing & Shared-Mode Safety** | S-06, partial W-04, **W-14 (new)** | P0 | M | ✅ **DONE 2026-10-01** — discriminator `#CODE` + sticky `wa_customer_tenant`; UNIQUE(wa_phone_number_id) for individual + UNIQUE route codes; notebook test: 2 shared tenants, no code → **no tenant**, `#CODE` → correct one; **plus W-14**: 43 broken `.catch` on Supabase builders fixed (0 remain) |
| **6.4** | **P0 — Billing Free-Grant Kill** | B-01, B-02, B-04, B-07 | P0 | S–M | ✅ **DONE 2026-10-01** — 71 security checks, 8 test suites, live E2E (401 / 400 / acked-but-refused bogus charge); migration `20261005` |
| **6.5** | **P0/P1 — Data Leak & Injection Hardening** | S-22, S-16, S-03 follow-up, S-15 OTP, S-13 XFF | P0/P1 | M | ✅ **DONE 2026-10-01** — `pickFields` allow-lists, `crypto.randomInt` + lockout, `req.ip` for location, login DTO; migration `20261006`; 9 suites, 84/84 checks |
| **7.1** | **P1 — Social OAuth State & PKCE** | S-07 | P1 | S | ✅ **DONE 2026-10-01** — `oauth_states` (hashed, single-use, 10-min TTL, user/platform/redirect-bound), identity from the DB row, PKCE S256 on every provider, sanitised provider errors; migration `20261007`; 10 suites, 95/95 checks |
| **7.2** | **P1 — Auth Tokens & Browser Session** | S-08, S-09 | P1 | M | ✅ **DONE 2026-10-01** — 15-min access tokens, hashed `sessions` with rotation + family revocation on reuse, httpOnly cookie path with double-submit CSRF, no `?token=` in URLs; migration `20261008`; 12 suites, 107/107 checks |
| **7.3** | **P1 — Quotas & Monthly Accounting** | B-06, B-09 | P1 | M | ✅ **DONE 2026-10-01** — period-scoped `usage_counters` + atomic `consume_usage`; every advertised quota enforced (generation, carousel per slide, regeneration, broadcasts, replies); filtered legacy reset + prune; migration `20261009`; 13 suites, 116/116 checks |
| **7.4** | **P1 — Currency-Correct Checkout & Verification** | B-05 | P1 | M | ✅ **DONE 2026-10-01** — single price resolver; only NGN/GHS/ZAR/KES/USD are charged; GBP/EUR → USD price reported as USD (never relabelled); webhook pins currency + exact minor amount to the resolver; 14 suites, 128/128 checks |
| **7.5** | **P1 — Exact Analytics Aggregates** | D-05 | P1 | M | ✅ **DONE 2026-10-01** — SQL aggregates + paging fallback (no 1,000-row truncation), per-currency revenue, paginated lists with `meta.has_more`, broken overview cache fixed; migration `20261010`; 15 suites, 138/138 checks |
| **7** | **P1 — Auth, Quotas, Money Correctness** | S-07, S-08, S-09, S-14, B-05, B-06, B-09, D-05, S-15/16/17, S-12 follow-up | P1 | L | ✅ **DONE 2026-10-01 (7.1–7.5)** — OAuth nonce+PKCE, JWT 15 m + hashed refresh + cookie path, Paystack amount matrix, usage_counters + middleware, filtered reset, exact analytics aggregates | **DONE** |
| **8** | **P1 — Core Loop: Orders & Payments in Chat** | W-01, W-02, W-03 (templates), W-04 (dedup), W-07 done, N-1/N-2 | P1 | XL | 🟡 **IN PROGRESS 2026-10-01** — **8.1 DONE** (W-02/W-04: batched ingestion, welcome-once, STOP/START, human takeover, migration `20261011`) · **8.2 DONE** (W-01: in-chat order capture → order row + tenant-key Paystack link/bank reference → verified settlement, migration `20261012`; 17 suites, 166/166 checks); **8.3 templates + scheduling (W-03)** pending | Phase 8.3 |
| **9** | **P1 — Rebuild Social Publishing** | C-01–C-08, P1 | L | Rebuild publishing layer in worker: correct Page/IG ids, long-lived token exchange, refresh job, YouTube multipart, lease-based scheduler (no 5-min window) |
| **10** | **P1/P2 — UX, Trust, Compliance** | U-01–U-18, §3.6 NDPA, §6 premium system | P1/P2 | L | `U-01` reload not logout (refresh flow), privacy/terms real pages, consent versioned, Today/Sell/Grow/Account IA, `aria-live` etc. already, health `readyz` |
| **11** | **Observability & Scale Polish** | AR-1–10, §8 SLOs, §9 reliability | P2 | L | Queue (pg-boss), pino + Sentry, `readyz/livez`, chaos checklist, indexes §4.5, retention |

**Dependency:** 6.* must all pass before 7; 7 before 8; etc. No parallel P0 skipping.

---

## 3. What is DONE vs PENDING *right now* for the NEW audit

**DONE (inherited from Phases 1–5, evidence in `git log 8f2d542`):**
- S-02, S-03, S-04, S-10, S-12, S-11, CORS/HSTS, trust proxy, OTP hash/lockout (partial), CORS, product/KB/broadcast quotas partially, pagination max 100, subscriptionCache, distributedLock, DOMPurify+CSP meta, PWA, pricing.json single source, transactions/webhook_events tables in migration, 4 unit suites, Dockerfile, CI.

**PENDING (must still do, in order):**
- **Phase 6.5 DONE:** S-13, S-15, S-16, S-22 — **all P0 + 6.5 P1s closed** (S-06 in 6.3, B-01/B-02/B-04/B-07 in 6.4, S-05 in 6.2, S-01/S-22/W-07 in 6.1)
- **Phase 7 complete (7.1–7.5).** Next: **Phase 8** (core loop) → 9 (social) → 10 (UX/NDPA). S-07 closed in 7.1, S-08/S-09 in 7.2, B-06/B-09 in 7.3, B-05 in 7.4, D-05 in 7.5; S-14 closed in 6.4; S-13/S-15/S-16 closed in 6.5
- **Phase 8:** 8.1 DONE (W-02/W-04) · 8.2 DONE (W-01 core loop) · **8.3 W-03 templates + scheduling pending** · N-1/N-2
- **Phase 9:** C-01–C-08 rebuild
- **Phase 10:** U-01–U-18, NDPA
- **Phase 11:** AR-1–10, SLOs

**Phase 6 is complete** — every P0 from the new audit is closed, plus the P1s scheduled for 6.5. Next: **Phase 7** (auth/quota/money correctness: S-07 OAuth nonce+PKCE, S-08 JWT 15 m + hashed refresh, B-05 currency matrix, B-06 usage_counters, B-09 monthly-reset filter, D-05 analytics truncation).

---

## 4. Phase 6.1 Contract (this stage)

**Goal:** Close admin-hijack and data-leak P0s with no shortcut. Finish before 6.2.

**Findings:** S-01 (admin by username), S-22 (password_hash leak), W-07 (platform fallback), S-02 follow-up.

**Tasks:**
1. **S-01:** `POST /auth/register` rejects reserved usernames (`admin, root, support, zapit, api, system, moderator` + any `ADMIN_USERNAMES`); `requireAdmin` checks `users.role='admin'` (DB) not name; `x-admin-secret` path hardened (`timingSafeEqual`, required, no undefined bypass); migration adds `users.role` + seed admin via `ADMIN_SEED_EMAIL`.
2. **S-22:** Replace `select('*')` on `users` in `/admin/users/:id` and `/auth/update-profile` with explicit allow-list DTO (never `password_hash`, `otp_*`); add unit test that asserts no hash in response.
3. **W-07:** `sendWAMessage` **never** falls back to platform tokens; if `decrypt()` is `null` or credentials missing → throw explicit `Missing tenant WhatsApp credentials` (no silent platform send); callers handle error.
4. **Tests:** negative test `register admin` → 409 reserved, `admin-hijack` → 403, `select` DTO test.

**Exit criteria (all must pass):**
- `curl -X POST /auth/register -d '{"username":"admin"}'` → `400 reserved` (not 201) — **PASS ✅**
- `GET /admin/users` as non-admin → `403` even when `ADMIN_SECRET` unset — **PASS ✅** (requires DB role)
- `GET /admin/users/:id` response body has **no** `password_hash` — **PASS ✅** (SAFE_USER_SELECT)
- `POST /whatsapp/test-connection` with no tenant creds → `400 Missing tenant…` (not platform send) — **PASS ✅** (W-07 strict)
- `npm test` (5 suites) + `npm run security:check` 23/23 + `node --check` green — **PASS ✅ (2026-10-01)**

**DONE 6.1:** S-01,S-02,S-22,W-07. **Pending after 6.1:** 6.2 (S-05 WhatsApp HMAC), 6.3 (S-06 tenant routing), 6.4 (B-01 free-grant), 6.5 (S-16/S-15 OTP/XFF polish — S-22 done) → then Phase 7.

---

## 4. Phase 6.2 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/webhook.js` (verifyMetaSignature / verifyWebhookVerifyToken / claimWebhookEvent), `index.js` (raw-body middleware before json, POST HMAC + dedup + 503/401/400, constant-time GET, boot warnings, health `whatsapp_webhook`), `tests/unit/webhook.test.mjs`, `tests/integration/webhook-auth.test.mjs`, `supabase/migrations/20261003_phase6_02_wa_webhook.sql`, `scripts/security-check.mjs` 23→28.

**Exit criteria (all must pass):**
- Unsigned `POST /webhook/whatsapp` → **401** (dev) / **503** (prod without secret) — never 200 — **PASS ✅**
- Valid `X-Hub-Signature-256` → **200 ack**; tampered/wrong-secret/cross-body → **401** — **PASS ✅** (live)
- Wrong `hub.verify_token` → **403**; correct → 200 `text/plain` echo — **PASS ✅** (live)
- Duplicate `wamid` skipped via atomic `webhook_events` claim (23505) — **PASS ✅** (unit; DB unique from Phase 4 + guarded index in 6.2 migration)
- `npm test` (6 suites) + `npm run security:check` (28/28) + `node --check` green — **PASS ✅ (2026-10-01)**

**DONE 6.2:** S-05. **Pending after 6.2:** 6.3 (S-06 tenant routing), 6.4 (B-01 free-grant), 6.5 (S-16/S-15 OTP/XFF polish) → then Phase 7.


---

## 5c. Phase 6.5 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/otp.js` (CSPRNG codes, sha256, constant-time compare, `verifyOTPRecord` lockout table), `pickFields()` in `src/utils/validation.js`, `index.js` (7 PATCH allow-lists, OTP flows rewritten, uniform forgot-password, neutral registration message, `req.ip` location + bounded geo cache, login DTO, single-source validators), `tests/unit/otp.test.mjs`, `supabase/migrations/20261006_phase6_05_hardening.sql`, `scripts/security-check.mjs` 71→84, `docs/API.md`.

**Exit criteria (tracker L87, all must pass):**
- `users` DTO allow-list — **PASS ✅** (login selects explicit columns; profile PATCH already allow-listed in 6.1)
- `crypto.randomInt` OTP — **PASS ✅** (no `Math.random` generator remains; unit: 3,000-draw entropy check)
- allow-list PATCH — **PASS ✅** (no `{...req.body}` / `update(req.body)`; all 7 routes use `pickFields` with type/enum/range validation; unit: id/user_id/payment_status/`__proto__` unreachable)
- `XFF` uses `req.ip` (trust proxy) — **PASS ✅** (header never read; live: spoofed `8.8.8.8` still resolves NG/NGN)
- real per-code lockout — **PASS ✅** (5 wrong guesses → the code is dead, `429`; used codes never replay; attempt counter caps)
- `npm test` (9 suites) + `npm run security:check` (84/84) + `node --check` + live E2E green — **PASS ✅ (2026-10-01)**

**Also fixed en route:** the local `isValidEmail` regex rejected every address containing the letter "s"
(registration blocker) — the file now imports the single source from `src/utils/validation.js`;
orders now notify customers when only `delivery_status` changes (the old condition required a `status` change too).

**Documented residual (deliberate, Phase 7):** registration still *rejects* a taken email (one neutral message).
An attacker probing with a guaranteed-unique username can still infer that the email exists; eliminating it
entirely requires the Phase 7 auth rework (soft-accept + owner notification + CAPTCHA), not a message tweak.

**DONE 6.5:** S-13, S-15, S-16 (+ S-22 login DTO). **Pending after 6.5:** Phase 7 (S-07/S-08/S-09, B-05/B-06/B-09, D-05) → 8 (core loop) → 9 (social) → 10 (UX/NDPA).

---

## 5b. Phase 6.4 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/billing.js` (cycle/pricing rules, `expectedAmountMinor`, `verifyPaymentAmount`, `cancelSubscriptionPlan`, `reactivateDecision`, `activationFields`, pure `evaluateCharge`), `index.js` (reactivate 402 + pay-again, cancel period-end, webhook authorisation via `evaluateCharge`, immutable `transactions` ledger, invoices/revenue from ledger, bounded+audited `set-plan`, 10s Paystack timeouts), `tests/unit/billing.test.mjs`, `supabase/migrations/20261005_phase6_04_billing_guardrails.sql`, `scripts/security-check.mjs` 54→67, `docs/API.md`.

**Exit criteria (tracker L86, all must pass):**
- `reactivate` requires payment or resumes with the same expiry — **PASS ✅** (unit `reactivateDecision`; 402 branch with fresh Paystack init)
- `cancel` sets `cancel_at` at period end — **PASS ✅** (access retained; immediate only when expired)
- webhook checks amount **and** currency — **PASS ✅** (`evaluateCharge`: metadata agreement, currency, minor-unit price ±1; `charge.success` refused on any mismatch)
- `transactions` unique — **PASS ✅** (unique `paystack_reference` re-asserted + append-only trigger; duplicate insert never returns early before activation)
- no free Agency via API — **PASS ✅** (`set-plan` 1–365 integer days + `admin_audit_log`; webhook refuses `free`)
- `npm test` (8 suites) + `npm run security:check` (71/71) + `node --check` + live E2E green — **PASS ✅ (2026-10-01)**

**DONE 6.4 + 6.3 follow-up:** B-01, B-02, B-04, B-07, S-14; route-code `await` regression fixed; `PATCH /whatsapp/settings` dedicated-number connect is now guarded (no shared-number hijack, token required, 409 duplicates). **Pending after 6.4:** 6.5 (S-16 mass-assignment, S-15 Math.random OTP, S-13 XFF) → then Phase 7.

---

## 5. Phase 6.3 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/tenantRouting.js` (route codes, fail-closed resolver, sticky upsert, guidance throttle, explicit send credentials), `index.js` (webhook resolution rewrite, route-code allocation, `/whatsapp/qr-code`, explicit outbound channels, **W-14** fix), `tests/unit/tenantRouting.test.mjs`, `supabase/migrations/20261004_phase6_03_shared_routing.sql`, `scripts/security-check.mjs` 44→55, `dashboard.html` route code, `docs/API.md` + `docs/ENV.md`.

**Decision (after full-codebase review):** fail-closed baseline **plus** discriminator routing — shared mode is kept for the Free plan (onboarding, qr-code endpoint and dashboard all promise it), but a message is only ever handled for the business it provably belongs to.

**Exit criteria (all must pass):**
- Two shared tenants, stranger message, no code → **no tenant chosen** (old code answered as the first row) — **PASS ✅** (unit: “S-06 regression”)
- `#CODE` → the correct tenant of two, discriminator stripped — **PASS ✅**
- Sticky mapping → same tenant without the code; stale mapping → no tenant — **PASS ✅**
- Duplicate dedicated numbers → refused (`ambiguous_individual`), never guessed — **PASS ✅**
- Unmatched → no processing + throttled guidance (≤1/24 h) — **PASS ✅**
- Shared tenants carry no platform number/token; sends use an explicit channel — **PASS ✅**
- Zero `.catch(...)` on Supabase builders (W-14) — **PASS ✅** (grep 0, enforced in CI)
- `npm test` (7 suites) + `npm run security:check` (55/55) + `node --check` + live E2E green — **PASS ✅ (2026-10-01)**

**DONE 6.3:** S-06, W-14. **Pending after 6.3:** 6.4 (B-01 free-grant), 6.5 (S-16/S-15 OTP/XFF polish) → then Phase 7.


## 5d. Phase 7.1 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/oauth.js` (CSPRNG state, sha256 hash, PKCE S256 pair + known-answer helper, `stateDecision`, `sanitizeProviderError`, `buildAuthorizeUrl`), `index.js` (`SOCIAL_PROVIDERS` config, connect route stores hashed state + challenge, callback redeems once + verifier on all exchanges), `supabase/migrations/20261007_phase7_01_oauth_state.sql` (hash UNIQUE, used_at, expires_at, RLS, `prune_oauth_states`), `tests/unit/oauth.test.mjs`, `scripts/security-check.mjs` 84 → 95, `docs/API.md`.

**Exit criteria (tracker L88, S-07 slice):**
- `state` is not client-trusted — **PASS ✅** (opaque handle; `Buffer.from(JSON.stringify({ user_id…` and `stateData.user_id` are gone and CI-asserted absent)
- state is signed/stored server-side + expires — **PASS ✅** (sha256 UNIQUE, 10-minute TTL, `unknown→used→platform_mismatch→expired` rejected before any provider call)
- nonce/replay protection — **PASS ✅** (single-use redemption via `.is('used_at', null)`; `used` is checked before `expired`, so replays never win)
- PKCE — **PASS ✅** (S256 challenge on all four authorize URLs; verifier forwarded on the Facebook, TikTok and Google token exchanges; RFC 7636 appendix-B known-answer test)
- no identity in the URL / no raw provider-error reflection — **PASS ✅**
- `npm test` (10 suites) + `npm run security:check` (95/95) + `node --check` green — **PASS ✅ (2026-10-01)**

**DONE 7.1:** S-07. **Pending in Phase 7:** 7.2 S-08/S-09 (tokens), 7.3 B-06/B-09 (usage counters + filtered reset), 7.4 B-05 (amount matrix), 7.5 D-05 (analytics truncation) → 8 (core loop) → 9 (social) → 10 (UX/NDPA).


## 5e. Phase 7.2 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/session.js` (clamped TTL, token hashing, hashed session rows + legacy fallback, reuse/activity decisions, missing-column detection), `src/utils/cookies.js` (httpOnly access/refresh cookies, `/auth`-scoped refresh, double-submit CSRF, configurable Secure/SameSite/Domain), `index.js` (bearer-or-cookie authenticate, CSRF on writes, cookie issue/clear, rotation + family revocation, hashed lookups), `supabase/migrations/20261008_phase7_02_sessions.sql`, `tests/unit/session.test.mjs`, `tests/unit/cookies.test.mjs`, `scripts/security-check.mjs` 95 → 107, `docs/API.md` + `docs/ENV.md`.

**Exit criteria (tracker L88, S-08/S-09 slices):**
- JWT access lifetime ≤ 15 m (hard max 1 h) — **PASS ✅** (`parseTtlSeconds` clamps `7d` → 3600; `expiresIn: '7d'` is CI-forbidden)
- hashed refresh tokens + rotation + reuse detection — **PASS ✅** (sha256 at rest; a spent token revokes `family_id` and the client is told to log in)
- httpOnly cookie path — **PASS ✅** (`zapit_at` unreachable from JS, `zapit_rt` only sent to `/auth`, CSRF token readable for the double submit)
- no tokens in URLs / reload survives — **PASS ✅** (login redirects clean; dashboard bootstraps via `POST /auth/refresh-token` with cookies)
- `npm test` (12 suites) + `npm run security:check` (107/107) + `node --check` green — **PASS ✅ (2026-10-01)**

**Residual (deliberate):** until `20261008` is applied, sessions keep using the legacy raw columns (the API logs a warning on each login) — apply the migration with the deploy. The registration email-existence oracle is still open by design (tracked under Phase 7 auth rework: soft-accept + owner notification + CAPTCHA).

**DONE 7.2:** S-08, S-09. **Pending in Phase 7:** 7.3 B-06/B-09 (quotas + filtered monthly reset), 7.4 B-05 (amount matrix), 7.5 D-05 (analytics truncation) → 8 (core loop) → 9 (social) → 10 (UX/NDPA).


## 5f. Phase 7.3 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/quota.js` (period keys, metric mapping, pure arithmetic, atomic consume + fallback, snapshot, middleware), `index.js` (4 generation guards, regeneration by item type, broadcast + reply consumption, `usage.monthly`, filtered monthly job), `supabase/migrations/20261009_phase7_03_usage_counters.sql`, `tests/unit/quota.test.mjs`, `scripts/security-check.mjs` 107 → 116, `docs/API.md`.

**Exit criteria (tracker L88, B-06/B-09 slices):**
- `usage_counters` + middleware — **PASS ✅** (`quotaGuard` consumes through the atomic `consume_usage`; a single SQL statement refuses the last slot)
- quotas enforced on text/image/video/broadcast/reply paths — **PASS ✅** (carousel metered per slide, regeneration metered by item type, broadcasts and inbound auto-replies metered)
- reset cron filtered / unnecessary — **PASS ✅** (new month = new `period_start`; the legacy mirror resets with an explicit paged filter under an advisory lock)
- graceful pre-migration behaviour — **PASS ✅** (degraded fallback, fail-open only when the table is absent, never a 500)
- `npm test` (13 suites) + `npm run security:check` (116/116) + `node --check` green — **PASS ✅ (2026-10-01)**

**DONE 7.3:** B-06, B-09. **Pending in Phase 7:** 7.4 B-05 (Paystack amount matrix + country→currency honesty), 7.5 D-05 (analytics truncation) → 8 (core loop) → 9 (social) → 10 (UX/NDPA).


## 5g. Phase 7.4 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/config/plans.js` (`PAYSTACK_CURRENCIES`, `isChargeableCurrency`, `resolvePlanPrice`, honest `getPricingForLocation`), `src/utils/billing.js` (`resolveCharge`, delegating `planPrice`/`expectedAmountMinor`/`chargeCurrency`, currency-pinned `evaluateCharge`), `index.js` (upgrade + reactivation charge the resolved object; no hand-rolled price lookup or symbol table left), `tests/unit/currency.test.mjs` (14th suite) + `tests/unit/billing.test.mjs` (GBP/EUR refusals), `scripts/security-check.mjs` 116 → 128, `docs/API.md` ("Currency & checkout amounts").

**Exit criteria (tracker L56, B-05 slice):**
- one source for amount + currency — **PASS ✅** (`resolvePlanPrice` → `resolveCharge`; `security:check` fails the build on any `.price[` lookup in `index.js`)
- a customer is only ever charged a currency Paystack can settle — **PASS ✅** (`NGN/GHS/ZAR/KES/USD`; GBP/EUR/CAD → USD price, reported as USD)
- no USD amount is ever displayed or stored as GBP/EUR — **PASS ✅** (`currency_symbol`/`price_formatted`/`billing_note` all come from the resolved currency; `requested_currency` keeps the original ask traceable)
- the webhook verifies the amount **and currency** the checkout initialized — **PASS ✅** (`currency_mismatch` for any currency we would never charge — a €12 payment cannot buy a $12 plan; 1 minor-unit tolerance; all 3 paid plans × 7 currencies parity-tested)
- `npm test` (14 suites) + `npm run security:check` (128/128) + `node --check` green — **PASS ✅ (2026-10-01)**

**DONE 7.4:** B-05. **Pending in Phase 7:** 7.5 D-05 (analytics truncation) → 8 (core loop) → 9 (social) → 10 (UX/NDPA).


## 5h. Phase 7.5 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `supabase/migrations/20261010_phase7_05_analytics_aggregates.sql` (5 SQL aggregates + indexes + service-role-only grants), `src/utils/analytics.js` (RPC-first aggregates, `fetchAllRows()` paging fallback, per-currency grouping, `headlineCurrency`), `index.js` (overview incl. fixed TTL cache, WhatsApp, content, revenue, growth, export, admin revenue, paginated invoices + referrals), `tests/unit/analytics.test.mjs` (15th suite), `scripts/security-check.mjs` 128 → 138, `docs/API.md` ("Analytics aggregates").

**Exit criteria (tracker L68, D-05 slice):**
- no aggregate computed from one capped page — **PASS ✅** (SQL aggregate, or every row paged up to a reported cap)
- exact before *and* after migration `20261010` — **PASS ✅** (RPC-first, `PGRST202` → paged fallback; a real RPC error 500s instead of under-reporting)
- more than 1,000 rows is the regression under test — **PASS ✅** (1,001 paid orders total 10,010 in `analytics.test.mjs`)
- truncation is never silent — **PASS ✅** (`truncated`, `meta.has_more`, `# NOTE:` line in the CSV)
- multi-currency money never summed across currencies — **PASS ✅** (`by_currency` + `mixed_currency`; export carries a currency column)
- `npm test` (15 suites) + `npm run security:check` (138/138) + `node --check` green — **PASS ✅ (2026-10-01)**
- Real-client proof: 1,001 orders through the actual `@supabase/supabase-js` against a fake PostgREST → RPC-missing path pages to **1,001 / 10,010** (old: 1,000 / 10,000), RPC path returns the same totals in one call with zero row reads — **PASS ✅**

**DONE 7.5:** D-05. **Phase 7 complete (7.1–7.5).** Next: **Phase 8** (core loop) → 9 (social) → 10 (UX/NDPA).


## 5i. Phase 8.1 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/inbound.js` (delivery unpacking, keyword classification, welcome decision, takeover gates), `index.js` (batched `handleInboundMessage`, welcome-once, STOP/START, takeover + `/whatsapp/conversations/:id/resume`), `supabase/migrations/20261011_phase8_01_inbound_state.sql` (`welcomed_at`, `opted_out_at`, `opt_out_reason`, `human_takeover`, `bot_paused_until` + indexes), `tests/unit/inbound.test.mjs` (16th suite), `scripts/security-check.mjs` 138 → 152, `docs/API.md` ("Inbound conversation semantics").

**Exit criteria (tracker L60/L62 slices):**
- every message in a Meta delivery is processed (not just the first) — **PASS ✅** (multi-entry/multi-change test; cap 100; per-wamid dedup retained)
- welcome is sent exactly once per contact — **PASS ✅** (`welcomed_at` authoritative; the stale-row regression is pinned in the test)
- STOP/START honoured and recorded — **PASS ✅** (bare-keyword rule, one confirmation, works with auto-reply off, no quota consumption)
- human takeover flag — **PASS ✅** (manual reply pauses the bot 24h and sets `human_takeover`; `/resume` releases)
- `npm test` (16 suites) + `npm run security:check` (152/152) + `node --check` green — **PASS ✅ (2026-10-01)**
- Live batch proof: one signed delivery with 4 messages across 2 entries/3 changes → 4 per-wamid claims + 4 routing decisions in the log (the old handler processed only the first) — **PASS ✅**

**DONE 8.1:** W-02, W-04. **DONE 8.2:** W-01. **Pending in Phase 8:** 8.3 W-03 (templates + scheduling), N-1/N-2 → then 9 (social) → 10 (UX/NDPA).


## 5j. Phase 8.2 — Exit criteria & evidence (DONE 2026-10-01)

**Deliverables:** `src/utils/orders.js` (intent, quantity/product/address capture, totals, references, templates, `evaluateOrderPayment`), `index.js` (`handleOrderFlow`, `createOrderFromDraft`, `initializeOrderPayment` on the tenant key, `requestOrderPayment`, `settleOrderCharge`, `markOrderPaid`, `POST /whatsapp/orders/:id/payment-link`, `POST /whatsapp/orders/:id/verify-payment`), `supabase/migrations/20261012_phase8_02_order_loop.sql` (14 order payment columns, unique reference index, `order_drafts` + RLS + `prune_order_drafts`), `tests/unit/orders.test.mjs` (17th suite), `scripts/security-check.mjs` 152 → 166, `docs/API.md` ("In-chat orders & payments").

**Exit criteria (tracker L59 slice):**
- customer types quantity/address → **order row** — **PASS ✅** (multi-turn drafts; one-shot "order 3 beans, deliver to 5 Wuse II, Abuja" also completes)
- `generateOrderNumber` used — **PASS ✅** (the check that the old code failed: zero call sites → one, pinned by test + security check)
- Paystack link / bank ref — **PASS ✅** (tenant key, minor units, unique `zapord_…` reference; bank details or manual confirmation otherwise)
- webhook marks **paid** — **PASS ✅** (tenant-key verify + reference/currency/amount match, CAS on `payment_status`, `enforce_order_transition` respected)
- confirmation — **PASS ✅** (`payment_received_message` with `{order}`, mirrored into the conversation)
- `npm test` (17 suites) + `npm run security:check` (166/166) + `node --check` green — **PASS ✅ (2026-10-01)**
- live loop: 3-turn capture → order `ZAP-…` built and payment request sent; cancel clears; 3/3 wamids claimed — **PASS ✅**

**DONE 8.2:** W-01. **Pending in Phase 8:** 8.3 W-03 (templates + scheduling), N-1/N-2 → then 9 (social) → 10 (UX/NDPA).
