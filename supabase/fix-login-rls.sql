-- ============================================================
-- Dafra — Login RLS Fix
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to run more than once.
--
-- Fixes two bugs that cause "Database error querying schema" on login:
--
--   Bug 1 — handle_new_user trigger has no ON CONFLICT clause.
--            Some GoTrue versions UPSERT auth.users during sign-in,
--            re-firing the AFTER INSERT trigger. The duplicate key
--            error on user_profiles propagates as a GoTrue DB error.
--
--   Bug 2 — user_profiles_super_admin was FOR ALL with only USING.
--            PostgreSQL reuses the USING expression as WITH CHECK on
--            INSERT/UPDATE. is_super_admin() queries user_profiles
--            from inside a user_profiles policy → indirect recursion.
-- ============================================================

-- ── Fix 1: make trigger idempotent ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::public.user_role,
            'cashier'
        )
    )
    ON CONFLICT (id) DO NOTHING;   -- ← idempotent: skip if profile exists
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Fix 2: replace user_profiles RLS policies ───────────────────────────
--
-- Rule: never use a FOR ALL policy with is_super_admin() / get_my_role()
-- on user_profiles — those helpers query user_profiles, which creates
-- an indirect recursion through the FOR ALL WITH CHECK path.
-- Use FOR SELECT policies only for cross-row lookups.

DROP POLICY IF EXISTS "user_profiles_super_admin"        ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_own_read"           ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_own_update"         ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_owner_manage"       ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_manager_read"       ON public.user_profiles;
-- also drop new names in case this is run twice
DROP POLICY IF EXISTS "user_profiles_super_admin_read"   ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_owner_read"         ON public.user_profiles;

-- Every authenticated user can read their own profile (critical for login).
CREATE POLICY "user_profiles_own_read"
    ON public.user_profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

-- Every authenticated user can update their own profile.
CREATE POLICY "user_profiles_own_update"
    ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid());

-- Super admin can read any profile.
-- FOR SELECT only — no WITH CHECK propagation, no recursion risk.
CREATE POLICY "user_profiles_super_admin_read"
    ON public.user_profiles
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

-- Owner can read all profiles within their tenant.
CREATE POLICY "user_profiles_owner_read"
    ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id()
        AND public.get_my_role() = 'owner'
    );

-- Manager can read profiles scoped to their branch.
CREATE POLICY "user_profiles_manager_read"
    ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id()
        AND public.get_my_role() = 'manager'
        AND branch_id = public.get_my_branch_id()
    );

-- ── Verify ───────────────────────────────────────────────────────────────

SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'user_profiles'
ORDER BY policyname;
