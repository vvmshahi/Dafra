-- ============================================================
-- Dafra — Trigger Fix for GoTrue Login 500
--
-- Root cause:
--   GoTrue upserts auth.users during login to update last_sign_in_at
--   using INSERT ... ON CONFLICT DO UPDATE. PostgreSQL fires AFTER INSERT
--   triggers on the INSERT attempt before conflict detection in some
--   GoTrue versions, re-running handle_new_user on every sign-in.
--   The duplicate key on user_profiles.id bubbles up as a 500 on
--   POST /auth/v1/token.
--
-- Fix:
--   1. Add a WHEN condition to the trigger so it only fires for rows
--      that carry signup metadata (login upserts have raw_user_meta_data
--      set to NULL or '{}' by GoTrue, not a full metadata object).
--   2. Add a WHERE NOT EXISTS guard inside the function as a second
--      safety net — makes the function a true no-op if the profile
--      already exists, regardless of how the trigger was invoked.
--
-- Safe to run more than once.
-- ============================================================

-- ── Step 1: Drop the existing trigger ───────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ── Step 2: Replace the function with a guarded version ─────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- WHERE NOT EXISTS makes this a no-op if the profile row already exists.
    -- This is the hard guard; the WHEN condition on the trigger is the soft guard.
    INSERT INTO public.user_profiles (id, full_name, role)
    SELECT
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::public.user_role,
            'cashier'
        )
    WHERE NOT EXISTS (
        SELECT 1 FROM public.user_profiles WHERE id = NEW.id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Step 3: Recreate the trigger with a WHEN condition ──────────────────
--
-- WHEN (NEW.raw_user_meta_data IS NOT NULL AND NEW.raw_user_meta_data != '{}')
-- filters GoTrue's login upserts, which set raw_user_meta_data to NULL or '{}'
-- rather than the full signup metadata object.
-- Real signups always carry at least {"provider":"email","providers":["email"]}.

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    WHEN (
        NEW.raw_user_meta_data IS NOT NULL
        AND NEW.raw_user_meta_data != '{}'::jsonb
    )
    EXECUTE FUNCTION public.handle_new_user();

-- ── Verify ───────────────────────────────────────────────────────────────

SELECT
    trigger_name,
    event_manipulation,
    action_timing,
    action_condition   AS when_condition,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table  = 'users'
ORDER BY trigger_name;
