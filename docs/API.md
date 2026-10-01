# ZAPIT API — Overview

Base: `https://zapit-n2yf.onrender.com` or `http://localhost:3000`

All authenticated routes require `Authorization: Bearer <accessToken>`.

## Auth (12)

- `POST /auth/register` — `{email, username, password, full_name, referral_code}`
- `POST /auth/login` — `{email, password}`
- `POST /auth/logout` / `/auth/logout-all`
- `POST /auth/verify-email` / `/auth/resend-otp` / `/auth/forgot-password` / `/auth/reset-password`
- `GET /auth/me` / `PATCH /auth/update-profile` / `PATCH /auth/change-password` / `POST /auth/refresh-token`

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

## Pagination

List endpoints accept `?page=1&limit=20` (max 100). Response includes `meta: { total, page, limit }` or `pagination`.

## Errors

All errors: `{ success:false, error:"message", requestId:"..." }`. 401 for auth, 403 for limits, 429 for rate, 500 with `requestId`.

## Webhooks

- `POST /webhook/paystack` — raw body, `x-paystack-signature` timingSafeEqual, idempotent on `reference`
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
