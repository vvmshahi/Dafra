-- ============================================================
-- Phase 5C-6: POS Touch Navigation Buttons
-- Apply manually after Phase 5C-2B split payment settings patch.
-- ============================================================
--
-- Goals:
--   - Add a branch-level opt-in setting for POS arrow navigation buttons.
--   - Keep branch POS settings updates behind a narrow SECURITY DEFINER RPC.
--   - Preserve existing RLS/security posture and avoid arbitrary branch updates.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not change POS checkout math.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS show_pos_scroll_buttons BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.branches.show_pos_scroll_buttons IS
  'Shows large optional POS category/product arrow buttons for touch-screen navigation.';

-- ============================================================
-- Narrow POS settings RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_branch_pos_settings(
  p_branch_id UUID,
  p_payload JSONB
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
  v_allow_split_payments BOOLEAN;
  v_show_pos_scroll_buttons BOOLEAN;
  v_updated_at TIMESTAMPTZ := NOW();
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
    WHERE key_name NOT IN ('allow_split_payments', 'show_pos_scroll_buttons')
  ) THEN
    RAISE EXCEPTION 'Unsupported POS setting' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'allow_split_payments')
     AND jsonb_typeof(p_payload -> 'allow_split_payments') <> 'boolean'
  THEN
    RAISE EXCEPTION 'allow_split_payments must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'show_pos_scroll_buttons')
     AND jsonb_typeof(p_payload -> 'show_pos_scroll_buttons') <> 'boolean'
  THEN
    RAISE EXCEPTION 'show_pos_scroll_buttons must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'allow_split_payments')
     AND NOT (p_payload ? 'show_pos_scroll_buttons')
  THEN
    RAISE EXCEPTION 'At least one POS setting is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, allow_split_payments, show_pos_scroll_buttons, is_active
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

  v_allow_split_payments := COALESCE(
    (p_payload ->> 'allow_split_payments')::boolean,
    COALESCE(v_branch.allow_split_payments, FALSE)
  );
  v_show_pos_scroll_buttons := COALESCE(
    (p_payload ->> 'show_pos_scroll_buttons')::boolean,
    COALESCE(v_branch.show_pos_scroll_buttons, FALSE)
  );

  UPDATE public.branches
  SET allow_split_payments = v_allow_split_payments,
      show_pos_scroll_buttons = v_show_pos_scroll_buttons,
      updated_at = v_updated_at
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
        'allow_split_payments_after', v_allow_split_payments,
        'show_pos_scroll_buttons_before', COALESCE(v_branch.show_pos_scroll_buttons, FALSE),
        'show_pos_scroll_buttons_after', v_show_pos_scroll_buttons
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'allow_split_payments', v_allow_split_payments,
    'show_pos_scroll_buttons', v_show_pos_scroll_buttons,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) IS
  'Safely updates narrow branch POS checkout settings without broad browser UPDATE access to branches.';

NOTIFY pgrst, 'reload schema';

COMMIT;
