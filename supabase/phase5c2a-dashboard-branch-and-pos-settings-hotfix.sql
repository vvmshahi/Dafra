-- ============================================================
-- Phase 5C-2A hotfix: dashboard branch loading + POS settings RPC
-- Apply manually after phase5c2-split-payment.sql.
-- ============================================================
--
-- Goals:
--   - Keep branches RLS/security intact.
--   - Let owner/admin update only the branch-level Split Payment setting via
--     a narrow SECURITY DEFINER RPC.
--   - Do not grant broad browser UPDATE privileges on public.branches.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS allow_split_payments BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.update_branch_pos_settings(
  p_branch_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_allow_split_payments BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid POS settings payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name <> 'allow_split_payments'
  ) THEN
    RAISE EXCEPTION 'Unsupported POS setting' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'allow_split_payments')
     OR jsonb_typeof(p_payload -> 'allow_split_payments') <> 'boolean'
  THEN
    RAISE EXCEPTION 'allow_split_payments must be a boolean' USING ERRCODE = '22023';
  END IF;

  v_allow_split_payments := (p_payload ->> 'allow_split_payments')::boolean;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, allow_split_payments, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    -- Super admin may update any tenant branch for support operations.
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET allow_split_payments = v_allow_split_payments,
      updated_at = NOW()
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_pos_settings_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'allow_split_payments_before', COALESCE(v_branch.allow_split_payments, FALSE),
        'allow_split_payments_after', v_allow_split_payments
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'allow_split_payments', v_allow_split_payments,
    'updated_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) IS
  'Safely updates narrow branch POS checkout settings without broad browser UPDATE access to branches.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm callable RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.update_branch_pos_settings(uuid, jsonb)',
--   'EXECUTE'
-- ) AS can_update_branch_pos_settings;
--
-- Expected: true.
--
-- 2) Confirm unsupported keys are rejected:
--
-- SELECT public.update_branch_pos_settings(
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid,
--   jsonb_build_object(
--     'allow_split_payments', true,
--     'vat_number', 'SHOULD_NOT_UPDATE'
--   )
-- );
--
-- Expected: Unsupported POS setting.
--
-- 3) Authenticated owner/admin app smoke:
--
-- SELECT public.update_branch_pos_settings(
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid,
--   jsonb_build_object('allow_split_payments', true)
-- );
--
-- Expected in an authenticated owner/admin request context:
--   ok = true and branches.allow_split_payments updates.
--
-- 4) Branch/cashier negative test:
--   A branch/cashier authenticated request should raise Forbidden.
