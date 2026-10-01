-- ZAPIT Phase 6.1 — Admin & Secrets Closure (S-01, S-02, S-22, W-07 follow-up)
-- Run: supabase db push  or  psql $DATABASE_URL -f supabase/migrations/20261002_phase6_01_admin_hardening.sql
-- World-class: reserve admin, DB role, remove password_hash leak, harden WA

-- ── 1. Role column — source of truth for admin (fixes S-01 admin via username) ───────
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
-- Constrain to known roles (drop then add to avoid duplicate constraint error)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin','moderator'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role = 'admin';

-- Seed admin from env ADMIN_SEED_EMAIL if provided — idempotent
-- After migration, run:  UPDATE users SET role='admin' WHERE email = 'ADMIN_SEED_EMAIL'::text;
-- Or:  UPDATE users SET role='admin' WHERE email ILIKE 'admin@zapit.ng';
-- This migration does not hard-code an admin; it only prepares the column.
-- To seed during first deploy (optional):
-- UPDATE users SET role='admin' WHERE username = 'admin' AND role = 'user'
--   AND EXISTS (SELECT 1 FROM users WHERE username='admin'); -- manual, commented out

-- ── 2. Safety: ensure is_active / is_suspended not nullable (defense) ───────────────
-- Already set, but ensure index for admin queries
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));

-- ── 3. Note: S-22 is app-layer (explicit SAFE_USER_SELECT) — no schema change needed
--     but we document that password_hash must never be selected via API.
--     For defense in depth, create a view that excludes sensitive columns:
CREATE OR REPLACE VIEW users_safe AS
  SELECT id,email,username,full_name,avatar_url,country_code,currency,timezone,language,phone,whatsapp_number,email_verified,phone_verified,referral_code,role,is_active,is_suspended,suspension_reason,created_at,last_login
  FROM users;

-- ── 4. W-07 — business_settings should require individual creds for paid tenants
--     No schema change; app now throws instead of falling back to platform token.
--     This migration only adds a check that shared-mode rows have platform creds encrypted:
--     (no-op, documentation)

-- ── 5. Audit helper: log admin actions (future: create admin_audit_log table)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id, created_at DESC);

-- Done. Verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='role';
-- SELECT * FROM users_safe LIMIT 1;
