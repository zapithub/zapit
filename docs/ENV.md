# ENV Reference — ZAPIT

Copy `.env.example` to `.env`. Never commit `.env`.

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `PORT` | No | `3000` | |
| `NODE_ENV` | No | `development` | `production` enforces strong secrets + CORS allowlist |
| `SUPABASE_URL` | **Yes** | — | `https://xxx.supabase.co` — fail-closed in prod |
| `SUPABASE_SERVICE_KEY` | **Yes** | — | service_role, not anon |
| `JWT_SECRET` | **Yes (prod)** | — | min 32 chars, `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | **Yes (prod)** | — | min 32 chars |
| `ENCRYPTION_KEY` | **Yes (prod)** | — | 32 chars for AES-256-CBC |
| `FRONTEND_URL` | No | `http://localhost:5500` | CORS allowlist |
| `WA_*` | No | — | WhatsApp Cloud API; mock if missing |
| `WA_APP_SECRET` | **Yes (prod)** | falls back to `META_APP_SECRET` | Meta app secret — verifies `X-Hub-Signature-256` on `POST /webhook/whatsapp` (S-05). Missing in production → webhook rejects 503 |
| `WA_VERIFY_TOKEN` | **Yes (prod)** | weak default | Meta GET handshake token; must be a strong unique value in production (constant-time compare) |
| `SHARED_WA_NUMBER` | No | — | Display value for the Free-plan shared number (routing uses `WA_PHONE_NUMBER_ID` + per-tenant route codes, S-06) |
| `HF_API_KEY` | No | — | Hugging Face; fallback to template |
| `REPLICATE_API_KEY` | No | — | Replicate; fallback to stock image |
| `PAYSTACK_SECRET_KEY` | No | — | Required for payments |
| `BREVO_API_KEY` | No | — | Email; console mock if missing |
| `ADMIN_SECRET` | No | — | `x-admin-secret` header (timingSafeEqual, required if used) |
| `ADMIN_USERNAMES` | No | `admin` | comma list — **all are RESERVED** (registration blocked, Phase 6.1 S-01) |
| `ADMIN_SEED_EMAIL` | No | — | email to promote to `role='admin'` after migration `20261002_phase6_01_admin_hardening.sql` |

| `ACCESS_TOKEN_TTL` | No | `15m` | access-token lifetime; clamped to 60 s–1 h (Phase 7.2 S-08) |
| `AUTH_COOKIE_SECURE` | No | `NODE_ENV==='production'` | force the `Secure` flag on auth cookies (S-09) |
| `AUTH_COOKIE_SAMESITE` | No | `lax` | `lax` / `strict` / `none` — use `none` (+ Secure) only when the frontend is on a different site (S-09) |
| `AUTH_COOKIE_DOMAIN` | No | — | e.g. `.zapit.ng` to share the session between `app.` and `api.` hosts (S-09) |

Generate secrets: `openssl rand -hex 32` for each `*_SECRET`.

See `SECURITY.md` for rotation.
| `TRUST_PROXY` | no | `1` | Proxy hops Express should trust for `req.ip` (Render = 1). Set `false` if the app is exposed directly, or the exact hop count behind another proxy. |
