-- ============================================================
-- Dafra — Login Diagnostic
-- Run each block separately in the SQL Editor so you can read
-- each result clearly. Blocks are separated by a blank line
-- and a comment header.
-- ============================================================


-- ── Block 1: Verify trigger has the ON CONFLICT fix ─────────────────────
-- Expected: the body column should contain "ON CONFLICT"

SELECT
    routine_name,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'handle_new_user';


-- ── Block 2: Check the super admin row in auth.users ────────────────────
-- Expected: email_confirmed_at NOT NULL, encrypted_password NOT NULL

SELECT
    id,
    email,
    role,
    aud,
    email_confirmed_at,
    (encrypted_password IS NOT NULL)  AS has_password,
    (raw_app_meta_data  IS NOT NULL)  AS has_app_meta,
    (raw_user_meta_data IS NOT NULL)  AS has_user_meta,
    raw_user_meta_data ->> 'role'     AS meta_role,
    created_at,
    last_sign_in_at
FROM auth.users
WHERE email = 'vvmshahi@gmail.com';


-- ── Block 3: Check the identities row ───────────────────────────────────
-- Expected: exactly one row with provider = 'email'

SELECT
    id,
    user_id,
    provider,
    provider_id,
    identity_data ->> 'email' AS identity_email,
    created_at
FROM auth.identities
WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'vvmshahi@gmail.com'
);


-- ── Block 4: Check the user_profiles row ────────────────────────────────
-- Expected: role = 'super_admin', is_active = true

SELECT
    id,
    role,
    full_name,
    tenant_id,
    branch_id,
    is_active,
    created_at
FROM public.user_profiles
WHERE id = (
    SELECT id FROM auth.users WHERE email = 'vvmshahi@gmail.com'
);


-- ── Block 5: List current RLS policies on user_profiles ─────────────────
-- Expected: no FOR ALL policy that calls is_super_admin()

SELECT
    policyname,
    cmd       AS "for",
    roles,
    qual      AS "using",
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'user_profiles'
ORDER BY policyname;


-- ── Block 6: Simulate the exact query the app runs during login ──────────
-- This impersonates the super admin and runs SELECT under their RLS context.
-- Expected: returns the super admin row.
-- If it returns 0 rows → an RLS policy is blocking the read.
-- If it throws an error → copy the exact error text for diagnosis.

DO $$
DECLARE
    v_user_id  UUID;
    v_row      public.user_profiles;
BEGIN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = 'vvmshahi@gmail.com';

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'DIAGNOSTIC: auth.users row not found for vvmshahi@gmail.com';
    END IF;

    RAISE NOTICE 'User ID: %', v_user_id;

    -- Simulate set_config that Supabase/PostgREST injects per-request
    PERFORM set_config('request.jwt.claims',
        json_build_object(
            'sub',  v_user_id::text,
            'role', 'authenticated',
            'aud',  'authenticated'
        )::text,
        true   -- local to this transaction
    );

    -- Switch to the authenticated role exactly as PostgREST does
    SET LOCAL role TO authenticated;

    -- Run the query the app sends
    SELECT * INTO v_row
    FROM public.user_profiles
    WHERE id = v_user_id;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION
            'DIAGNOSTIC: RLS blocked the read — 0 rows returned for user %', v_user_id;
    ELSE
        RAISE NOTICE 'SUCCESS: profile readable. role=%, is_active=%',
            v_row.role, v_row.is_active;
    END IF;

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DIAGNOSTIC ERROR (SQLSTATE %): %', SQLSTATE, SQLERRM;
END $$;


-- ── Block 7: Check for any OTHER triggers on auth.users ─────────────────
-- Unexpected triggers here could interfere with GoTrue

SELECT
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table  = 'users'
ORDER BY trigger_name;
