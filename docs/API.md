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

- `POST /subscription/upgrade` `{plan, billing_cycle?}` → Paystack `payment_url`. Amount and currency come
  from `resolveCharge()` (see below); the signed metadata carries `user_id`, `plan`, `billing_cycle`,
  `currency`, `requested_currency` **and `amount_minor`**, so the webhook can re-derive the exact charge.
  Free plan is not purchasable.
- `POST /subscription/cancel` → `200 {data:{plan, status:"active", access_until, cancel_at}}`.
  **Access continues until the paid period ends** (`cancel_at = expires_at`, `auto_renew=false`);
  if no paid time remains the subscription is cancelled immediately.
- `POST /subscription/reactivate` → one of:
  - `200 {message:"Subscription is already active"}` — nothing to do;
  - `200 {data:{status:"active", access_until}}` — **resume with the same expiry** (never extends it);
  - **`402 {success:false, payment_required:true, payment_url, reference, amount, currency, plan, billing_cycle}`**
    when the paid period has ended — a *new* Paystack payment is required before access returns;
  - `404` — no subscription on record.
### Currency & checkout amounts (Phase 7.4 — B-05)

Paystack can only settle **NGN, GHS, ZAR, KES, USD**. One resolver decides every charge
(`resolvePlanPrice()` in `src/config/plans.js`, `resolveCharge()` in `src/utils/billing.js`):

| Requested currency | Charged / charged as | Display fields |
|--------------------|----------------------|----------------|
| NGN / GHS / ZAR / KES / USD | same currency at that currency's list price | `currency_converted:false`, `billing_note:null` |
| GBP, EUR, anything else | **USD list price, charged in USD** | `currency:"USD"`, `requested_currency:"GBP"`, `currency_converted:true`, `billing_note:"Billed in USD — GBP is not supported by our payment provider."` |

- `POST /subscription/upgrade` and `POST /subscription/reactivate` initialize Paystack with the resolved
  `{amount, currency, amount_minor}` and mirror all three in the signed metadata (`currency`,
  `requested_currency`), so the charge can be re-derived exactly.
- The webhook grants only when Paystack's verified `currency` **equals the resolved charge currency** and the
  verified minor amount matches the resolved amount (1 minor-unit tolerance). A charge in a currency we never
  initialize (GBP/EUR) is refused as `currency_mismatch` and left for operator reconciliation — a `€12`
  payment can never buy a `$12` plan.
- `GET /pricing/location` (and `GET /subscription/plans`) expose `price_raw`, `price_formatted`,
  `price_annual`, `currency`, `currency_symbol`, `requested_currency`, `currency_converted` and
  `billing_note`, so the UI can never render a USD amount with a `£`/`€` symbol.
- Annual = `monthly × 9.6` (12 × 0.80) in minor units, computed once — checkout and webhook always agree.

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


## Plan quotas (Phase 7.3 — B-06)

Metered per **UTC calendar month**, one counter row per `(user, metric, period)`, consumed atomically so concurrent requests cannot exceed a plan cap:

| Metric | Endpoints | Plan key |
|--------|-----------|----------|
| `text_posts` | `POST /content/generate/text`, caption/text regeneration | `text_posts` |
| `image_generations` | `POST /content/generate/image`, `POST /content/generate/carousel` (per slide), image regeneration | `image_generations` |
| `video_generations` | `POST /content/generate/video`, video regeneration | `video_generations` |
| `whatsapp_broadcasts` | `POST /whatsapp/broadcasts` | `whatsapp_broadcasts` |
| `whatsapp_replies` | inbound WhatsApp messages that receive an auto-reply | `whatsapp_replies` |

Exceeding a quota returns `403` with `{ success:false, code:'quota_exceeded', error, data:{ metric, used, limit } }`. `GET /subscription/current` returns `usage.monthly` with the live counters. A new month starts a **new period row**, so nothing is reset (this replaces the old, broken monthly-reset cron).


## Analytics aggregates (Phase 7.5 — D-05)

PostgREST returns at most **1,000 rows per request**, so any figure computed from a single read could
be a silent undercount. Every analytics number is now computed by Postgres (migration
`20261010_phase7_05_analytics_aggregates.sql`) and, until that migration is applied, by reading **every**
matching row with `range()` paging (`src/utils/analytics.js`):

| Endpoint | Aggregate | Response extras |
|----------|-----------|-----------------|
| `GET /analytics/overview` | orders + paid revenue per currency, exact contact/content/published counts | `paid_orders`, `currency`, `by_currency`, `mixed_currency`, `revenue_source`; 60 s in-process cache (`X-Cache: HIT\|MISS`) |
| `GET /analytics/whatsapp` | period orders/paid/revenue per currency | `currency`, `by_currency`, `source` |
| `GET /analytics/content` | content-type histogram | `by_type` (all types), `source` |
| `GET /analytics/revenue` | period revenue per currency + paid-per-day series | `by_currency`, `mixed_currency`, `source`, `truncated` |
| `GET /analytics/growth` | contacts per segment + exact total | `source` |
| `GET /analytics/export` | full CSV (paged, cap 50,000 rows/section) | a `# NOTE:` line is appended when capped |
| `GET /admin/revenue` | ledger totals by plan **and** currency | `by_currency`, `mixed_currency`, `ledger_rows`, `source`, `truncated` |

**Multi-currency rule (B-05):** amounts in different currencies are never summed together. Responses
carry `by_currency` and a headline `currency` (the user's own, else the largest bucket); `mixed_currency:true`
tells the UI more than one currency is involved. `source` is `"rpc"` (SQL aggregate) or `"paged"`
(pre-migration fallback).

`GET /subscription/invoices` and `GET /referrals/history` accept `?page=&limit=` (max 100) and return
`meta:{ total, page, limit, has_more }` — unbounded lists previously stopped at 1,000 rows silently.

## Pagination

List endpoints accept `?page=1&limit=20` (max 100). Response includes `meta: { total, page, limit }` or `pagination`.

## Errors

All errors: `{ success:false, error:"message", requestId:"..." }`. 401 for auth, 403 for limits, 429 for rate, 500 with `requestId`.

## Webhooks

- `POST /webhook/paystack` — raw body, `x-paystack-signature` timingSafeEqual, idempotent on `reference`,
  amount/currency/metadata verified via the `/verify` response before any plan is granted (6.4)
- `GET /webhook/whatsapp` — Meta handshake, `hub.verify_token` compared in constant time (403 otherwise)
- `POST /webhook/whatsapp` — raw body, `X-Hub-Signature-256` HMAC-SHA256 verified (401 invalid; 503 in
  production when `WA_APP_SECRET`/`META_APP_SECRET` is missing), replay-protected per `wamid`.

### Inbound conversation semantics (Phase 8.1 — W-02/W-04)

- **Every message is processed.** A single Meta delivery can carry many entries → changes → messages
  (Meta batches them under load); the webhook unpacks them all and handles them **sequentially**, capped at
  100 per delivery. The old handler read `entry[0].changes[0].value.messages[0]` and dropped the rest.
- **Each message is deduped by `wamid`** (`webhook_events`), and one failing message never aborts the rest.
- **Welcome exactly once** per contact (`contacts.welcomed_at`): the old code kept the contact row it read
  *before* incrementing `message_count`, so message #2 was welcomed again. A greeting-only first message gets
  only the welcome; any other first message is welcomed **and** answered.
- **STOP / UNSUBSCRIBE / "do not message"** opt the contact out (`opted_out`, `opted_out_at`,
  `opt_out_reason`), confirmed once, and are honoured even when auto-reply is off. **START / RESUME** opt
  back in. Only a bare keyword (≤ 40 chars) counts — "please stop by the shop tomorrow" is a sentence.
- **Human takeover:** when the business replies through `POST /whatsapp/conversations/:id/reply`, the
  conversation gets `human_takeover=true` and `bot_paused_until = now + 24h`; the bot then records inbound
  messages without answering. `POST /whatsapp/conversations/:id/resume` hands the chat back to the bot.
- Apply migration `20261011_phase8_01_inbound_state.sql`; without it these columns are absent and the
  features degrade safely (welcome falls back to `message_count`, takeover is inert, the reply still sends).

### In-chat orders & payments (Phase 8.2 — W-01)

A customer can now order and pay **in the chat** (before this, `generateOrderNumber()` had zero call sites
and a tenant's `paystack_secret_key` was never read):

1. **Capture** — an order/price message (or a bare `order`) opens a draft (`order_drafts`, one per
   business+contact, 6 h TTL). The bot fills **product → quantity → delivery address** across turns
   ("2 bags of rice" → "12 Adeola Street, Lekki"), asking only for what is missing. `cancel` clears it.
2. **Order row** — on completion an `orders` row is created with `generateOrderNumber()`, `items`,
   `delivery_address`, `subtotal/delivery_fee/total`, `source:'whatsapp'`, and a unique
   `payment_reference` (`zapord_…`).
3. **Payment request** — with a Paystack key configured the order is initialised **on the tenant's own
   account** (`payment_link`, minor units, metadata `order_id`/`order_number`); otherwise the customer gets
   the merchant's bank details (reference = the order number) or a manual-confirmation reply.
4. **Settlement** — `POST /webhook/paystack` (or `POST /whatsapp/orders/:id/verify-payment`) verifies the
   charge with the tenant key and only then marks the order `paid` (`paid_at`, `payment_verified_at`,
   `gateway_response`) and confirms to the customer. The order row's own amount/currency is the reference:
   a different reference, currency, or amount is refused (`reference_mismatch`/`currency_mismatch`/
   `amount_mismatch`) and left for reconciliation.
5. **Recovery** — `POST /whatsapp/orders/:id/payment-link` re-sends the request; the existing
   `POST /whatsapp/orders/:id/confirm-payment` records a manual/bank confirmation.

Apply migration `20261012_phase8_02_order_loop.sql`; without it the loop falls back to the legacy order
shape (no multi-turn drafts) and never blocks the AI reply. Orders are metered like any reply.

### Broadcasts & templates (Phase 8.3 — W-03)

WhatsApp only accepts **free-form** messages inside the **24 hours** that follow a customer's last inbound
message. Outside that window a business must send an **approved template**. Broadcasts used to free-text
everyone (the gateway rejected the cold half, and the rejections were counted as failures) and a broadcast
with `scheduled_for` was stored and **never executed**.

- `POST /whatsapp/broadcasts` plans the audience against the window:
  - **in-window** contacts → the free-text message (`{name}` is personalised);
  - **out-of-window** contacts → the template passed as `template_id`, or **skipped** and reported
    (`counts.skipped_window`, `data.results.skipped_reasons: ['outside_24h_window']`).
  - If nobody is reachable the request fails with a 400 that says so — instead of silently sending nothing.
  - The response carries `counts` (`text`, `template`, `skipped_window`) and the run stores `sent_count`,
    `failed_count`, `skipped_count` and `results`.
- **Templates** — `GET /whatsapp/templates`, `POST /whatsapp/templates`
  (`{ name, language, body, category }`, `{{1}}`… placeholders are filled with the recipient's name on
  send), `DELETE /whatsapp/templates/:id`. Invalid names/languages/bodies are refused with reasons.
- **Scheduled runs execute** — a `BROADCAST_CRON` scheduler (default every 5 minutes) claims due rows with a
  lease (`.eq('status','scheduled')` inside an advisory lock) and plans them **at send time**, because the
  window is relative to *now*. Opted-out and blocked contacts are never targeted.
- Apply migration `20261013_phase8_03_templates_and_broadcast_runs.sql`. Verify locally with
  `npm run smoke:broadcast` (logs in, runs both broadcast shapes, and asserts the scheduler picks up a
  scheduled run).

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
