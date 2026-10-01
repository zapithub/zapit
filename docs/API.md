# ZAPIT API — Overview

Base: `https://zapit-n2yf.onrender.com` or `http://localhost:3000`

All authenticated routes accept either `Authorization: Bearer <accessToken>` **or** the
httpOnly session cookies set by `/auth/login`, `/auth/register` and `/auth/refresh-token`
(Phase 7.2 — S-09). With cookie auth, every non-GET request must also send
`X-CSRF-Token` with the value of the readable `zapit_csrf` cookie (double submit);
`SameSite=Lax` is the second layer. `/auth/refresh-token` reads the refresh token from
the body **or** the path-scoped `zapit_rt` cookie, so browsers never handle it in JS.

## Auth (12)

- `POST /auth/register` — `{email, username, password, full_name, referral_code}`
- `POST /auth/login` — `{email, password}`
- `POST /auth/logout` / `/auth/logout-all`
- `POST /auth/verify-email` / `/auth/resend-otp` / `/auth/forgot-password` / `/auth/reset-password`
- `GET /auth/me` / `PATCH /auth/update-profile` / `PATCH /auth/change-password` / `POST /auth/refresh-token`

### Session contract (Phase 7.2 — S-08)
- Access tokens live **15 minutes** (`ACCESS_TOKEN_TTL`, clamped to 1 h) and carry a `jti`.
- Refresh tokens live 30 days and are **rotated on every use**; only their sha256 hashes are
  stored, so a leaked database row cannot be replayed.
- Presenting an already-rotated/revoked refresh token is treated as theft: the whole session
  family is revoked and the client must log in again (`401 Session revoked…`).
- `POST /auth/logout` revokes the current session; `/auth/logout-all` revokes every session.
- `sessions` rows keep `family_id`, `rotated_at`, `revoked_at`, `revoked_reason`; the legacy
  raw `token`/`refresh_token` columns are backfilled to hashes and emptied by migration
  `20261008` (the API falls back to the legacy columns until it is applied).

## Onboarding (8)

- `GET /onboarding/status`, `POST /onboarding/business-info`, `/whatsapp`, `/payment-setup`, `/products`, `/social-connect`, `/apply-template`, `/complete`

## WhatsApp (20)

- `GET/PATCH /whatsapp/settings`, `POST /whatsapp/test-connection`, `GET /whatsapp/qr-code`
- `GET/POST/PATCH/DELETE /whatsapp/products`, `POST /whatsapp/products/import`, `GET /whatsapp/products/export`
- `GET/PATCH/DELETE /whatsapp/contacts`, `GET /whatsapp/knowledge-base` (CRUD + toggle), `GET /whatsapp/ai-logs`, `POST /whatsapp/broadcasts`

## Social & Content (14+)

- `GET /social/platforms`, `POST /social/connect/:platform`, `GET /social/callback/:platform`
- `POST /content/generate/{text,image,video,carousel,caption}`, `GET/PATCH/DELETE /content/library`, `POST /content/upload`, `POST /content/schedule`, `POST /content/schedule/bulk`, `POST /content/publish-now`, `GET /content/calendar`, `POST /content/calendar/automation`

## Analytics, Subscription, Referrals, Admin, Webhooks, System

See `index.js` for full list (54 routes). OpenAPI 3.1 to be generated from `src/utils/validation.js` SCHEMAS (Phase 5 TODO: `npm run openapi:generate`).

## Input validation, OTP & client location (Phase 6.5 — S-13/S-15/S-16)

- **PATCH allow-lists.** Every update route accepts only its documented fields
  (`pickFields`). System columns (`id`, `user_id`, `payment_status`, `total`, `order_number`,
  counters, `auto_learned`, …) are unreachable from a request body; unknown fields are ignored
  and a body with no valid field returns `400 No valid fields to update.` Wrong types, enums,
  ranges and array shapes return `400` with a single readable reason.
- **Order updates** accept only `status` (`pending|confirmed|processing|shipped|delivered|cancelled|refunded`)
  and `delivery_status` (`pending|packed|shipped|out_for_delivery|delivered|returned`); payment fields
  move only through `POST /whatsapp/orders/:id/confirm-payment` or the Paystack webhook.
- **OTP.** Codes are 6-digit CSPRNG values (`crypto.randomInt`), stored sha256-hashed, valid 10 minutes.
  Five wrong guesses kill the code (`429 Too many failed attempts…`); a used code can never be replayed;
  a new code is issued by `/auth/resend-otp`. `/auth/forgot-password` always answers
  `If this email exists…` at a uniform latency, and registration never discloses which
  identifier already exists.
- **Location/pricing.** `GET /pricing/location` and `GET /subscription/plans` derive the country from
  the proxy-aware client IP (`req.ip`); `X-Forwarded-For` values from clients are ignored, so billing
  currency cannot be chosen by header spoofing.

## Billing & subscriptions (Phase 6.4 — B-01/B-02/B-04/B-07)

Plans: `free`, `creator`, `growth`, `agency` (`src/config/plans.js`). Prices are per currency
(NGN/GHS/KES/ZAR/USD); **annual = 12 × monthly × 0.80** (20% off), billed 365 days → `billing_cycle: "annual"`.

- `POST /upgrade` `{plan, billing_cycle?}` → Paystack `payment_url`. The signed metadata carries
  `user_id`, `plan`, `billing_cycle`, `currency` **and `amount_minor`**, so the webhook can verify
  the charge against the server-side price table. Free plan is not purchasable.
- `POST /subscription/cancel` → `200 {data:{plan, status:"active", access_until, cancel_at}}`.
  **Access continues until the paid period ends** (`cancel_at = expires_at`, `auto_renew=false`);
  if no paid time remains the subscription is cancelled immediately.
- `POST /subscription/reactivate` → one of:
  - `200 {message:"Subscription is already active"}` — nothing to do;
  - `200 {data:{status:"active", access_until}}` — **resume with the same expiry** (never extends it);
  - **`402 {success:false, payment_required:true, payment_url, reference, amount, currency, plan, billing_cycle}`**
    when the paid period has ended — a *new* Paystack payment is required before access returns;
  - `404` — no subscription on record.
### WhatsApp connection settings (S-06 follow-up)

`PATCH /whatsapp/settings` accepts business fields plus a **guarded** `wa_phone_number_id`:

- non-empty → dedicated (individual) mode: must be digits (5–30), must **not** be ZAPIT's shared
  number, and an access token must exist (new or already stored) → else `400`; a number already
  linked to another business → **`409`**.
- `""` (empty) → disconnect: returns the tenant to the shared number, clears stored tenant
  credentials and allocates a routing code if none exists.
- The raw column is never mass-assignable; the response returns
  `data:{connection_method, wa_phone_number_id, route_code}`.

- `GET /subscription/invoices` — reads the immutable `transactions` ledger first (legacy
  `subscriptions` rows as fallback).
- `POST /admin/users/:id/set-plan` `{plan, expires_in_days}` — `expires_in_days` must be an
  integer **1–365**; every grant writes an `admin_audit_log` row (`set_plan:{plan}:{days}d`,
  `details{plan,days,via}`). Only for admin roles / `ADMIN_SECRET`.
- Webhook `charge.success` grants only when the Paystack `/verify` response agrees with the signed
  event: status `success`, non-free plan, metadata match, currency match, and the paid amount equals
  the plan price in minor units (±1 unit rounding). Every verified charge appends to
  `transactions` (UNIQUE `paystack_reference`, append-only trigger); mismatches are logged at
  `level:"error"` and grant nothing.

## Social OAuth connect (Phase 7.1 — S-07)

| Endpoint | Auth | Behaviour |
|----------|------|-----------|
| `POST /social/connect/:platform` | Bearer | `platform` ∈ instagram, facebook, tiktok, youtube. Requires the provider's client id/secret on the server (else `400`), stores a **single-use state handle** (sha256 only) bound to the user + platform + redirect URI with a **10-minute expiry**, and returns `{ auth_url, platform, expires_in, pkce:'S256' }`. `503` when the state store (migration `20261007`) is missing. |
| `GET /social/callback/:platform` | none | Redeems the state: unknown/replayed/expired/platform-mismatched states are rejected before any token exchange (`?error=state_unknown\|state_used\|state_expired\|state_platform_mismatch`). Identity comes from the stored row — never from the URL. The PKCE verifier is sent on every provider token exchange. Provider errors are sanitised (`?error=provider_<reason>`). |

Notes: the old base64 `{ user_id, platform, ts }` state is gone; a callback URL from another user's browser cannot attach accounts to that user. States are single-use (`used_at` set conditionally), so a replayed callback fails. Apply migration `20261007_phase7_01_oauth_state.sql`; `prune_oauth_states(1)` removes stale rows.


## Pagination

List endpoints accept `?page=1&limit=20` (max 100). Response includes `meta: { total, page, limit }` or `pagination`.

## Errors

All errors: `{ success:false, error:"message", requestId:"..." }`. 401 for auth, 403 for limits, 429 for rate, 500 with `requestId`.

## Webhooks

- `POST /webhook/paystack` — raw body, `x-paystack-signature` timingSafeEqual, idempotent on `reference`,
  amount/currency/metadata verified via the `/verify` response before any plan is granted (6.4)
- `GET /webhook/whatsapp` — Meta handshake, `hub.verify_token` compared in constant time (403 otherwise)
- `POST /webhook/whatsapp` — raw body, `X-Hub-Signature-256` HMAC-SHA256 verified (401 invalid; 503 in
  production when `WA_APP_SECRET`/`META_APP_SECRET` is missing), replay-protected per `wamid`

## Shared number & tenant routing (S-06)

The Free plan uses ZAPIT's shared WhatsApp number. Delivery is deterministic — a message is only
ever handled for the business it belongs to:

1. **Dedicated number** → the single business owning that `wa_phone_number_id`
   (`connection_method='individual'`; duplicates are refused, never guessed).
2. **Sticky mapping** → a customer who already messaged a business keeps reaching it
   (`wa_customer_tenant`).
3. **Discriminator** → a new customer prefixes their first message with the business's code,
   e.g. `#K7F9QA hello` (code from `GET /whatsapp/qr-code`).
4. **Anything else** → no tenant: the message is never processed for anyone, and the customer gets
   a throttled guidance reply (at most one per 24 h) explaining how to include a code.
