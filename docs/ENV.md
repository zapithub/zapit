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
| `HF_API_KEY` | No | — | Hugging Face; fallback to template |
| `REPLICATE_API_KEY` | No | — | Replicate; fallback to stock image |
| `PAYSTACK_SECRET_KEY` | No | — | Required for payments |
| `BREVO_API_KEY` | No | — | Email; console mock if missing |
| `ADMIN_SECRET` | No | — | `x-admin-secret` header |
| `ADMIN_USERNAMES` | No | `admin` | comma list |

Generate secrets: `openssl rand -hex 32` for each `*_SECRET`.

See `SECURITY.md` for rotation.
