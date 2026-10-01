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
| `HF_API_KEY` | No | — | Hugging Face; fallback to template |
| `REPLICATE_API_KEY` | No | — | Replicate; fallback to stock image |
| `PAYSTACK_SECRET_KEY` | No | — | Required for payments |
| `BREVO_API_KEY` | No | — | Email; console mock if missing |
| `ADMIN_SECRET` | No | — | `x-admin-secret` header (timingSafeEqual, required if used) |
| `ADMIN_USERNAMES` | No | `admin` | comma list — **all are RESERVED** (registration blocked, Phase 6.1 S-01) |
| `ADMIN_SEED_EMAIL` | No | — | email to promote to `role='admin'` after migration `20261002_phase6_01_admin_hardening.sql` |

Generate secrets: `openssl rand -hex 32` for each `*_SECRET`.

See `SECURITY.md` for rotation.
