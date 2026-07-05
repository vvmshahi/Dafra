-- ============================================================
-- Phase 3B: Branch Username Login Foundation
-- Apply manually after reviewing Phase 3A login/RLS findings.
-- ============================================================
--
-- Goals:
--   - Reconcile user_profiles.email schema drift used by account Edge Functions.
--   - Add a safe branch username to internal-auth-email mapping table.
--   - Keep current owner/admin/super-admin email login unchanged.
--   - Keep existing branches.branch_email behavior unchanged during transition.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not change POS checkout math, invoice numbering, VAT, payments, reports,
--     printer, or Electron behavior.

BEGIN;

-- ============================================================
-- Align schema with existing Edge Function usage
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.user_profiles.email IS
  'Mirror of the Supabase Auth email used by service-role account management flows; nullable for legacy rows.';

-- ============================================================
-- Username normalization and validation helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_branch_login_username(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(COALESCE(p_username, '')))
$$;

CREATE OR REPLACE FUNCTION public.is_reserved_branch_login_username(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.normalize_branch_login_username(p_username) = ANY (ARRAY[
    'admin',
    'support',
    'kubri',
    'superadmin',
    'root',
    'api',
    'www',
    'login',
    'billing',
    'zatca',
    'owner',
    'branch',
    'system',
    'test'
  ])
$$;

CREATE OR REPLACE FUNCTION public.is_valid_branch_login_username(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    length(v_normalized) BETWEEN 3 AND 32
    AND position('@' IN v_normalized) = 0
    AND v_normalized ~ '^[a-z0-9][a-z0-9_-]*[a-z0-9]$'
    AND v_normalized !~ '[_-]{2,}'
    AND public.is_reserved_branch_login_username(v_normalized) IS FALSE
  FROM (
    SELECT public.normalize_branch_login_username(p_username) AS v_normalized
  ) normalized
$$;

COMMENT ON FUNCTION public.normalize_branch_login_username(TEXT) IS
  'Trims and lowercases branch login usernames before validation or lookup.';

COMMENT ON FUNCTION public.is_reserved_branch_login_username(TEXT) IS
  'Blocks reserved branch login usernames such as admin, support, kubri, and zatca.';

COMMENT ON FUNCTION public.is_valid_branch_login_username(TEXT) IS
  'Validates branch login usernames: 3-32 chars, lowercase a-z/0-9/_/-, no @, no spaces, no edge/repeated separators, no reserved names.';

REVOKE ALL ON FUNCTION public.normalize_branch_login_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_reserved_branch_login_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_branch_login_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_branch_login_username(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_reserved_branch_login_username(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_branch_login_username(TEXT) TO authenticated, service_role;

-- ============================================================
-- Branch username mapping table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.branch_login_usernames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  internal_auth_email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT branch_login_usernames_username_matches_normalized
    CHECK (public.normalize_branch_login_username(username) = normalized_username),
  CONSTRAINT branch_login_usernames_normalized_is_normalized
    CHECK (public.normalize_branch_login_username(normalized_username) = normalized_username),
  CONSTRAINT branch_login_usernames_username_valid
    CHECK (public.is_valid_branch_login_username(normalized_username)),
  CONSTRAINT branch_login_usernames_internal_email_no_empty
    CHECK (length(btrim(internal_auth_email)) > 0),
  CONSTRAINT branch_login_usernames_internal_email_format
    CHECK (internal_auth_email ~ '^[a-z0-9][a-z0-9._%+-]*@branch-login\.kubri\.internal$')
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_login_usernames_normalized_username_uidx
  ON public.branch_login_usernames (normalized_username);

CREATE UNIQUE INDEX IF NOT EXISTS branch_login_usernames_user_id_uidx
  ON public.branch_login_usernames (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS branch_login_usernames_internal_auth_email_uidx
  ON public.branch_login_usernames (lower(internal_auth_email));

CREATE INDEX IF NOT EXISTS branch_login_usernames_tenant_branch_idx
  ON public.branch_login_usernames (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS branch_login_usernames_active_lookup_idx
  ON public.branch_login_usernames (normalized_username)
  WHERE is_active IS TRUE;

COMMENT ON TABLE public.branch_login_usernames IS
  'Maps globally unique branch login usernames to generated internal Supabase Auth emails.';

COMMENT ON COLUMN public.branch_login_usernames.username IS
  'Canonical branch login username stored lowercase during Phase 3B.';

COMMENT ON COLUMN public.branch_login_usernames.normalized_username IS
  'Trimmed lowercase username used for unique lookup and resolver matching.';

COMMENT ON COLUMN public.branch_login_usernames.internal_auth_email IS
  'Generated internal Supabase Auth email for username/password branch login; do not show to branch users.';

CREATE OR REPLACE FUNCTION public.validate_branch_login_username_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.username := public.normalize_branch_login_username(NEW.username);
  NEW.normalized_username := public.normalize_branch_login_username(NEW.normalized_username);
  NEW.internal_auth_email := lower(btrim(NEW.internal_auth_email));

  IF NEW.username <> NEW.normalized_username THEN
    RAISE EXCEPTION 'Branch username must match normalized username' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = NEW.branch_id
      AND b.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch username branch/tenant mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = NEW.user_id
      AND up.tenant_id = NEW.tenant_id
      AND up.branch_id = NEW.branch_id
      AND up.role::text IN ('branch', 'manager', 'cashier')
  ) THEN
    RAISE EXCEPTION 'Branch username user/branch mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = NEW.user_id
      AND lower(COALESCE(au.email, '')) = NEW.internal_auth_email
  ) THEN
    RAISE EXCEPTION 'Branch username auth email/user mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_branch_login_username_scope() IS
  'Normalizes branch login username rows and validates tenant/branch/user profile consistency before writes.';

REVOKE ALL ON FUNCTION public.validate_branch_login_username_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_branch_login_usernames_validate_scope ON public.branch_login_usernames;
DROP TRIGGER IF EXISTS trg_branch_login_usernames_updated_at ON public.branch_login_usernames;

CREATE TRIGGER trg_branch_login_usernames_validate_scope
  BEFORE INSERT OR UPDATE ON public.branch_login_usernames
  FOR EACH ROW EXECUTE FUNCTION public.validate_branch_login_username_scope();

CREATE TRIGGER trg_branch_login_usernames_updated_at
  BEFORE UPDATE ON public.branch_login_usernames
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- RLS management helper and policies
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_branch_login_username(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.is_active IS TRUE
      AND (
        up.role::text = 'super_admin'
        OR (
          up.role::text IN ('owner', 'admin')
          AND up.tenant_id = p_tenant_id
        )
      )
  ), FALSE)
$$;

COMMENT ON FUNCTION public.can_manage_branch_login_username(UUID) IS
  'Returns true when the current authenticated user may manage branch username rows for the tenant.';

REVOKE ALL ON FUNCTION public.can_manage_branch_login_username(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_branch_login_username(UUID) TO authenticated, service_role;

ALTER TABLE public.branch_login_usernames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_login_usernames_service_role_all ON public.branch_login_usernames;
DROP POLICY IF EXISTS branch_login_usernames_tenant_admin_manage ON public.branch_login_usernames;
DROP POLICY IF EXISTS branch_login_usernames_self_read ON public.branch_login_usernames;

CREATE POLICY branch_login_usernames_service_role_all
  ON public.branch_login_usernames
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY branch_login_usernames_tenant_admin_manage
  ON public.branch_login_usernames
  FOR ALL
  TO authenticated
  USING (public.can_manage_branch_login_username(tenant_id))
  WITH CHECK (public.can_manage_branch_login_username(tenant_id));

CREATE POLICY branch_login_usernames_self_read
  ON public.branch_login_usernames
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.branch_login_usernames FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_login_usernames TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_login_usernames TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
