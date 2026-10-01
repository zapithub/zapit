# ZAPIT — Phase 0 Master Audit → Tracker (New Attachment)
**Source:** `ZAPIT — Master Codebase Audit, Architecture Review & World-Class Upgrade Blueprint` (30 Sep 2026, Phase 0, no code modified) — pasted by user 2026-10-01  
**Current codebase:** `arena/01a0f67b-zapit` after Phases 1–5 + **6.1–6.5** (47 findings → 0 Critical, plus new audit: S-01/S-02/S-05/S-06/S-13/S-15/S-16/S-22/W-07 + **W-14 (new)** all FIXED, `npm test` 9 suites + `security:check` 84/84 + live E2E)  
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
| **S-07** | OAuth `state` unsigned, no nonce/expiry | P1 | S | 🔴 OPEN | Phase 7 |
| **S-08** | JWT 7d + raw `sessions` + no reuse detection | P1 | M | 🟡 PARTIAL — added `jti`, still 7d/30d, still raw at rest | Phase 7 |
| **S-09** | Tokens in URL `?token=` → logs/CDN, reload=logout | P1 | M | 🟡 PARTIAL — sessionStorage + scrub, still URL handoff; needs httpOnly cookie/code exchange | Phase 7 |
| **S-10** | Open CORS (`cb(null,true)`) + CSP disabled | P1 | S–M | ✅ FIXED Phase 1 (allowlist, HSTS) — CSP meta added Phase 3, still `unsafe-inline` (needs split) |
| **S-11** | `50mb` JSON + 50 MB multer memory | P1 | S | ✅ FIXED Phase 1 (1mb JSON, 10MB/1 file) — still memory, needs streaming |
| **S-12** | No `trust proxy` → one bucket for all users | P1 | S | ✅ FIXED Phase 1 (`trust proxy 1`) |
| **S-13** | `X-Forwarded-For[0]` → currency arbitrage | P1 | S | ✅ **FIXED 6.5** — `detectLocation` uses proxy-aware `req.ip` (+ private-range handling, bounded 30-min geo cache, 5 s timeout); the header is never read | ✅ 2026-10-01 |
| **S-14** | Paystack no amount/currency check, no idempotency | P1 | M | 🟡 PARTIAL — idempotency added, **amount/currency not checked** | Phase 7 |
| **B-02** | `cancel` drops access immediately vs promise period-end | P1 | S | ✅ **FIXED 6.4** — `cancel` keeps `status='active'`, sets `cancel_at = expires_at` (access retained to period end) | ✅ 2026-10-01 |
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
- **Phase 6.5 DONE:** S-13, S-15, S-16, S-22 — **all P0 + 6.5 P1s closed** (S-06 in 6.3, B-01/B-02/B-04/B-07 in 6.4, S-05 in 6.2, S-01/S-22/W-07 in 6.1)
- **Phase 7:** S-07, S-08, S-09, B-05/B-06/B-09, D-05, etc. (S-14 closed in 6.4; S-13/S-15/S-16 closed in 6.5)
- **Phase 8:** W-01 core loop (largest), W-02–W-04, N-1/N-2
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
