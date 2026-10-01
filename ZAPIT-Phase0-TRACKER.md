# ZAPIT — Phase 0 Master Audit → Tracker (New Attachment)
**Source:** `ZAPIT — Master Codebase Audit, Architecture Review & World-Class Upgrade Blueprint` (30 Sep 2026, Phase 0, no code modified) — pasted by user 2026-10-01  
**Current codebase:** `arena/01a0f67b-zapit` after Phases 1–5 + **6.1** (47 findings → 0 Critical, plus new audit: S-01/S-02/S-22/W-07 now FIXED, `npm test` 5 suites + `security:check` 23/23)  
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
| **S-05** | WhatsApp webhook unsigned | **P0** | S | 🔴 **OPEN** — Paystack fixed, **WhatsApp not**. `POST /webhook/whatsapp` has no `X-Hub-Signature-256` check | **Phase 6.2** |
| **S-06** | Shared-number routes to arbitrary tenant (`.limit(1)`) | **P0** | M | 🔴 **OPEN** — still copies platform `WA_PHONE_NUMBER_ID` into each tenant, webhook `limit(1)` | **Phase 6.3** |
| **B-01** | `reactivate` gives free 30d forever | **P0** | S | 🔴 **OPEN** — `POST /subscription/reactivate` still finds latest `cancelled` and sets `active` no payment | **Phase 6.4** |
| **W-07** | Platform-credential fallback → spam via platform number | **P0** | S | ✅ **FIXED 6.1** — `sendWAMessage` strict tenant (no fallback, throw), 7 call sites patched | **DONE 6.1** |
| **S-22** | `select('*')` leaks `password_hash` via `/admin/users/:id` + `update-profile` | **P0/H** | S | ✅ **FIXED 6.1** — `SAFE_USER_SELECT` DTO + `users_safe` view, `sanitizeUserDto` | **DONE 6.1** |
| **S-07** | OAuth `state` unsigned, no nonce/expiry | P1 | S | 🔴 OPEN | Phase 7 |
| **S-08** | JWT 7d + raw `sessions` + no reuse detection | P1 | M | 🟡 PARTIAL — added `jti`, still 7d/30d, still raw at rest | Phase 7 |
| **S-09** | Tokens in URL `?token=` → logs/CDN, reload=logout | P1 | M | 🟡 PARTIAL — sessionStorage + scrub, still URL handoff; needs httpOnly cookie/code exchange | Phase 7 |
| **S-10** | Open CORS (`cb(null,true)`) + CSP disabled | P1 | S–M | ✅ FIXED Phase 1 (allowlist, HSTS) — CSP meta added Phase 3, still `unsafe-inline` (needs split) |
| **S-11** | `50mb` JSON + 50 MB multer memory | P1 | S | ✅ FIXED Phase 1 (1mb JSON, 10MB/1 file) — still memory, needs streaming |
| **S-12** | No `trust proxy` → one bucket for all users | P1 | S | ✅ FIXED Phase 1 (`trust proxy 1`) |
| **S-13** | `X-Forwarded-For[0]` → currency arbitrage | P1 | S | 🔴 OPEN — still `req.headers['x-forwarded-for'].split(',')[0]` trusted |
| **S-14** | Paystack no amount/currency check, no idempotency | P1 | M | 🟡 PARTIAL — idempotency added, **amount/currency not checked** | Phase 7 |
| **B-02** | `cancel` drops access immediately vs promise period-end | P1 | S | ✅ FIXED? No — we keep immediate; needs period-end (`cancel_at`) | Phase 7 |
| **B-03** | No recurring billing/dunning | P1 | L | 🔴 OPEN — `auto_renew` flag no worker | Phase 9 |
| **B-05** | Currency GBP/EUR → `price.USD` mis-pricing | P1 | M | 🔴 OPEN — `COUNTRY_CURRENCY` still GB→GBP, `price[GBP] ?? price.USD` → mislabel | Phase 7 |
| **B-06** | Most quotas unenforced (text/image/video/contacts) | P1 | M | 🟡 PARTIAL — some enforced; need usage_counters + middleware | Phase 7 |
| **B-09** | Monthly reset `update({reply_count:0})` **no filter** → no-op | P1 | S–M | 🔴 OPEN — `L2994` still unfiltered | Phase 7 |
| **W-01** | **No order/payment creation at all** | P1 | XL | 🔴 OPEN — `generateOrderNumber` unused, tenant `paystack_secret_key` never read | **Phase 8 (core loop)** |
| **W-02** | Welcome stale-state (msg 1 & 2 both only welcome) | P1 | M | 🔴 OPEN | Phase 8 |
| **W-03** | Broadcast free-text outside 24h → fails; scheduled never runs | P1 | L | 🔴 OPEN — scheduled insert no cron | Phase 8 |
| **W-04** | Webhook: only first message, no dedup, no human-takeover | P1 | M | 🔴 OPEN | Phase 8 |
| **C-01** | Meta `accountId=/me.id` wrong (needs Page/IG Business id) | P1 | L | 🔴 OPEN — OAuth still stores `/me.id` | **Phase 9 (rebuild publishing)** |
| **C-02** | No token refresh anywhere | P1 | L | 🔴 OPEN | Phase 9 |
| **C-03** | YouTube sends JSON only, no media | P1 | L | 🔴 OPEN | Phase 9 |
| **C-04** | IG URL/30s sleep, FB ignores video, TikTok `PULL_FROM_URL` unverified | P1 | L | 🔴 OPEN | Phase 9 |
| **C-05** | Automation `next_generation_at` never set, caption-only | P1 | M | 🔴 OPEN | Phase 9 |
| **D-05** | 1,000-row truncation in analytics/revenue | P1 | S–M | 🟡 PARTIAL — pagination max 100 added in Phase 2, but analytics still `count` then `select` loops that can truncate | Phase 7 |
| **S-15** | OTP `Math.random`, plaintext, no per-code lockout, email existence oracle | P1 | S | 🟡 PARTIAL — `hashOTP` + 5/15m, still `Math.random` | Phase 7 |
| **S-16** | Mass assignment (`{...req.body}`) on 7 PATCH routes | P1 | S | 🟡 PARTIAL — some allow-lists, but `products/:id`, `orders/:id`, `contacts/:id`, `brand-voice` still spread | Phase 7 |
| **…** | *Remaining P1/P2s (S-17–S-28, D-01–D-11, U-01–U-18 etc.)* | — | — | See full Phase 0 §12 — most remain **OPEN** | Phases 7–10 |

**Count:** P0 **9** items → 3 fixed, 6 open. P1 **~35** → ~7 fixed, ~28 open. P2/P3 remain.

---

## 2. Sequencing for NEW work (no shortcut, finish stage before next)

We keep the **5-phase foundation you approved (1–5 DONE)** and **continue as Phases 6–11** aligning to Phase 0 §13 recommendation: *stabilise → modularise → complete core loop → upgrade experience → scale*. Each phase is **atomic**: tests + `security:check` + manual verification before next.

| Phase | Name (new) | Scope from Phase 0 | Priority gated | Effort | Exit criteria (must all pass) |
|-------|------------|--------------------|----------------|--------|-------------------------------|
| **6.1** | **P0 — Admin & Secrets Closure** | S-01 (admin by name), S-22 (hash leak), W-07 fallback, S-02 follow-up hardening | P0 | S | ✅ **DONE 2026-10-01** — Register `admin` blocked (400); `/admin/*` requires DB `role='admin'`; `select('*')` gone; `sendWAMessage` never falls back; `security:check` 23/23 + 5 suites |
| **6.2** | **P0 — WhatsApp Webhook Authenticity** | S-05 (HMAC), S-25/S-06 related | P0 | S | `POST /webhook/whatsapp` verifies `X-Hub-Signature-256` with `timingSafeEqual`, raw-body captured, 401 on fail, replay dedup, no platform fallback |
| **6.3** | **P0 — Tenant Routing & Shared-Mode Safety** | S-06, partial W-04 | P0 | M | Shared-mode either disabled with 410 + migration guide, or discriminator code + sticky `wa_customer_tenant` table; `UNIQUE(wa_phone_number_id)` enforced; notebook test shows 2 shared tenants route correctly |
| **6.4** | **P0 — Billing Free-Grant Kill** | B-01, B-02, B-04, B-07 | P0 | S–M | `reactivate` requires payment or removed; `cancel` sets `cancel_at` period-end; webhook checks amount/currency; `transactions` unique; no free Agency via API |
| **6.5** | **P0/P1 — Data Leak & Injection Hardening** | S-22, S-16, S-03 follow-up, S-15 OTP, S-13 XFF | P0/P1 | M | `users` DTO allow-list; `crypto.randomInt` OTP; allow-list PATCH; `XFF` uses `req.ip` (trust proxy) |
| **7** | **P1 — Auth, Quotas, Money Correctness** | S-07, S-08, S-09, S-14, B-05, B-06, B-09, D-05, S-15/16/17, S-12 follow-up | P1 | L | OAuth nonce+PKCE, JWT 15m + hashed refresh, httpOnly cookie path documented, Paystack amount matrix, usage_counters + middleware, reset cron filtered, analytics `count` not truncated |
| **8** | **P1 — Core Loop: Orders & Payments in Chat** | W-01, W-02, W-03 (templates), W-04 (dedup), W-07 done, N-1/N-2 | P1 | XL | Customer can type quantity/address → order row + `generateOrderNumber` + Paystack link/bank ref → webhook marks `paid` → confirmation; welcome bug fixed; STOP handled; human takeover flag |
| **9** | **P1 — Rebuild Social Publishing** | C-01–C-08, P1 | L | Rebuild publishing layer in worker: correct Page/IG ids, long-lived token exchange, refresh job, YouTube multipart, lease-based scheduler (no 5-min window) |
| **10** | **P1/P2 — UX, Trust, Compliance** | U-01–U-18, §3.6 NDPA, §6 premium system | P1/P2 | L | `U-01` reload not logout (refresh flow), privacy/terms real pages, consent versioned, Today/Sell/Grow/Account IA, `aria-live` etc. already, health `readyz` |
| **11** | **Observability & Scale Polish** | AR-1–10, §8 SLOs, §9 reliability | P2 | L | Queue (pg-boss), pino + Sentry, `readyz/livez`, chaos checklist, indexes §4.5, retention |

**Dependency:** 6.* must all pass before 7; 7 before 8; etc. No parallel P0 skipping.

---

## 3. What is DONE vs PENDING *right now* for the NEW audit

**DONE (inherited from Phases 1–5, evidence in `git log 8f2d542`):**
- S-02, S-03, S-04, S-10, S-12, S-11, CORS/HSTS, trust proxy, OTP hash/lockout (partial), CORS, product/KB/broadcast quotas partially, pagination max 100, subscriptionCache, distributedLock, DOMPurify+CSP meta, PWA, pricing.json single source, transactions/webhook_events tables in migration, 4 unit suites, Dockerfile, CI.

**PENDING (must still do, in order):**
- **Phase 6.2–6.5 (P0):** S-05, S-06, B-01 (+ S-04 follow-up) — **S-01,S-22,W-07 DONE in 6.1**
- **Phase 7:** S-07, S-08, S-09, S-14, B-05/B-06/B-09, D-05, S-15/16 etc.
- **Phase 8:** W-01 core loop (largest), W-02–W-04, N-1/N-2
- **Phase 9:** C-01–C-08 rebuild
- **Phase 10:** U-01–U-18, NDPA
- **Phase 11:** AR-1–10, SLOs

**Do not onboard paying users until Phase 6 is complete** (Phase 0 §A.4). We now execute **Phase 6.1**.

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
