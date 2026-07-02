-- ============================================================
-- Phase 5C-5B hotfix: Register Session RPC availability
-- Apply manually after phase5c5a-register-session-reporting-foundation.sql.
-- ============================================================
--
-- Goals:
--   - Keep Phase 5C-5A RPC signatures stable.
--   - Re-assert EXECUTE grants for authenticated callers.
--   - Force PostgREST schema reload for newly-added register RPCs.
--   - Do not modify register/session data.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable or weaken RLS/security.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_register_session_summary(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC public.get_register_session_summary(uuid, uuid). Apply Phase 5C-5A first.'
      USING ERRCODE = '42883';
  END IF;

  IF to_regprocedure('public.get_register_sessions(uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC public.get_register_sessions(uuid, integer). Apply Phase 5C-5A first.'
      USING ERRCODE = '42883';
  END IF;

  IF to_regprocedure('public.open_register_session(uuid, numeric)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC public.open_register_session(uuid, numeric). Apply Phase 5C-5A first.'
      USING ERRCODE = '42883';
  END IF;

  IF to_regprocedure('public.close_register_session(uuid, numeric, jsonb, text)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC public.close_register_session(uuid, numeric, jsonb, text). Apply Phase 5C-5A first.'
      USING ERRCODE = '42883';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_register_session_summary(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_session_summary(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_register_sessions(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_sessions(UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.open_register_session(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_register_session(UUID, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_register_session_summary(UUID, UUID) IS
  'Phase 5C-5B verified Register Session summary RPC. Frontend parameter names: p_branch_id, p_session_id.';
COMMENT ON FUNCTION public.get_register_sessions(UUID, INTEGER) IS
  'Phase 5C-5B verified Register Sessions list RPC. Frontend parameter names: p_branch_id, p_limit.';
COMMENT ON FUNCTION public.open_register_session(UUID, NUMERIC) IS
  'Phase 5C-5B verified Open Register RPC. Frontend parameter names: p_branch_id, p_opening_cash.';
COMMENT ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) IS
  'Phase 5C-5B verified Close Register RPC. Frontend parameter names: p_session_id, p_actual_cash, p_closing_checks, p_notes.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm argument names, not only argument types:
--
-- SELECT
--   proname,
--   proargnames,
--   oidvectortypes(proargtypes) AS arg_types
-- FROM pg_proc
-- WHERE proname IN (
--   'get_register_session_summary',
--   'get_register_sessions',
--   'open_register_session',
--   'close_register_session'
-- )
-- ORDER BY proname;
--
-- Expected:
--   close_register_session       {p_session_id,p_actual_cash,p_closing_checks,p_notes}
--   get_register_session_summary {p_branch_id,p_session_id}
--   get_register_sessions        {p_branch_id,p_limit}
--   open_register_session        {p_branch_id,p_opening_cash}
--
-- 2) Confirm EXECUTE grants:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.get_register_session_summary(uuid, uuid)', 'EXECUTE') AS can_summary,
--   has_function_privilege('authenticated', 'public.get_register_sessions(uuid, integer)', 'EXECUTE') AS can_list,
--   has_function_privilege('authenticated', 'public.open_register_session(uuid, numeric)', 'EXECUTE') AS can_open,
--   has_function_privilege('authenticated', 'public.close_register_session(uuid, numeric, jsonb, text)', 'EXECUTE') AS can_close;
--
-- Expected: all true.
--
-- 3) Branch no-session smoke in authenticated branch context:
--
-- SELECT public.get_register_session_summary('<branch-id>'::uuid, NULL);
--
-- Expected: ok=true with a session object whose session_id may be null when
-- no open or closed register session exists. This should not throw.
