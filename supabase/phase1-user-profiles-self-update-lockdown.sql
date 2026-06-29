-- ============================================================
-- Phase 1 Security Hardening: user_profiles self-update lockdown
-- Apply manually in Supabase SQL editor or via your migration flow.
-- ============================================================
--
-- Goal:
--   Authenticated users may edit only their own personal profile fields.
--   They may not self-modify role, tenant_id, branch_id, auth identity,
--   account status, or audit columns.
--
-- Safe personal fields in the current schema:
--   full_name, full_name_ar, phone, avatar_url

BEGIN;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_own_update" ON public.user_profiles;

CREATE POLICY "user_profiles_own_update"
  ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- RLS controls which rows are writable. Column privileges control which fields
-- are writable. Revoke broad table UPDATE from browser roles, then grant only
-- the personal fields a user is allowed to edit directly.
REVOKE UPDATE ON TABLE public.user_profiles FROM anon;
REVOKE UPDATE ON TABLE public.user_profiles FROM authenticated;

GRANT UPDATE (
  full_name,
  full_name_ar,
  phone,
  avatar_url
) ON TABLE public.user_profiles TO authenticated;

-- Defense in depth: even if a future migration accidentally restores broad
-- UPDATE privileges, direct authenticated self-updates still cannot alter
-- protected profile fields.
CREATE OR REPLACE FUNCTION public.prevent_user_profile_self_privilege_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = OLD.id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_001_self_update_lockdown
  ON public.user_profiles;

CREATE TRIGGER trg_user_profiles_001_self_update_lockdown
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_profile_self_privilege_changes();

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
-- 1) Confirm authenticated can update only personal columns:
--
-- SELECT
--   column_name,
--   has_column_privilege('authenticated', 'public.user_profiles', column_name, 'UPDATE') AS authenticated_can_update
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'user_profiles'
--   AND column_name IN (
--     'id', 'tenant_id', 'branch_id', 'role', 'is_active', 'created_at',
--     'updated_at', 'full_name', 'full_name_ar', 'phone', 'avatar_url'
--   )
-- ORDER BY column_name;
--
-- Expected:
--   true  only for full_name, full_name_ar, phone, avatar_url
--   false for id, tenant_id, branch_id, role, is_active, created_at, updated_at
--
-- 2) Confirm the RLS self-update policy is present:
--
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'user_profiles'
--   AND policyname = 'user_profiles_own_update';
--
-- 3) Optional live test in SQL editor. Replace the UUID with a real user id.
--    The first UPDATE should succeed; the second should fail with permission
--    denied for column role, or with SQLSTATE 42501 from the trigger.
--
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
--
-- UPDATE public.user_profiles
-- SET full_name = full_name
-- WHERE id = auth.uid();
--
-- UPDATE public.user_profiles
-- SET role = 'owner'::public.user_role
-- WHERE id = auth.uid();
--
-- ROLLBACK;
