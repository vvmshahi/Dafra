-- ============================================================
-- Phase 5F: Branch Stock Module Toggle
-- Apply manually after Stock/Purchases route split is deployed.
-- ============================================================
--
-- Goals:
--   - Add a nullable branch-level Stock module visibility override.
--   - Keep Stock visibility updates behind a narrow SECURITY DEFINER RPC.
--   - Preserve Purchases visibility and all stock/purchase/POS calculation logic.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data directly.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS stock_enabled BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN public.branches.stock_enabled IS
  'Nullable Stock module override. NULL follows tenant business_type default; TRUE enables Stock; FALSE disables Stock.';

CREATE OR REPLACE FUNCTION public.update_branch_module_settings(
  p_branch_id UUID,
  p_stock_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, stock_enabled, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET stock_enabled = p_stock_enabled,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_module_settings_updated',
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
        'stock_enabled_before', v_branch.stock_enabled,
        'stock_enabled_after', p_stock_enabled
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'stock_enabled', p_stock_enabled,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_module_settings(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_module_settings(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.update_branch_module_settings(UUID, BOOLEAN) IS
  'Safely updates narrow branch module visibility settings without broad browser UPDATE access to branches.';

NOTIFY pgrst, 'reload schema';

COMMIT;
