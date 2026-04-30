-- ============================================================
-- Dafra — Trigger Fix v2
-- Supabase does not honour the WHEN condition on auth.users triggers.
-- Fix is entirely inside the function: early-return if the profile
-- already exists, so the function is a no-op on every login upsert.
-- ============================================================

-- ── 1. Drop the trigger ──────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ── 2. Drop and recreate the function ───────────────────────────────────

DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Early-return if the profile already exists.
    -- GoTrue upserts auth.users on every login (to update last_sign_in_at),
    -- which re-fires this AFTER INSERT trigger. The check below makes the
    -- function a silent no-op on those calls without touching user_profiles.
    IF EXISTS (
        SELECT 1 FROM public.user_profiles WHERE id = NEW.id
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::public.user_role,
            'cashier'
        )
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. Recreate the trigger (no WHEN condition) ──────────────────────────

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ── Verify ───────────────────────────────────────────────────────────────

SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table  = 'users'
ORDER BY trigger_name;
