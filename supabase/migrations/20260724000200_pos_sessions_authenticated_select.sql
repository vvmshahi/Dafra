BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pos_sessions') IS NULL THEN
    RAISE EXCEPTION 'public.pos_sessions is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'pos_sessions'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'public.pos_sessions must retain row level security';
  END IF;
END
$$;

-- Authenticated users need table-level SELECT before PostgreSQL can evaluate
-- the existing branch_pos_sessions_select and owner_pos_sessions_select RLS
-- policies. No write privilege or new visibility policy is introduced here.
REVOKE SELECT ON TABLE public.pos_sessions FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pos_sessions TO authenticated;

COMMIT;
