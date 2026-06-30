-- ============================================================
-- Phase 3C follow-up: safe invoice/receipt settings save RPC
-- Apply manually after Phase 3A and Phase 3C.
-- ============================================================
--
-- Fixes:
--   Browser invoice settings save must not directly UPDATE public.branches
--   after Phase 3A column/grant lockdown.
--
-- Security model:
--   - Keep canonical branches RLS and grants unchanged.
--   - Allow only safe invoice/print display fields through this RPC.
--   - Do not allow legal, counter, ZATCA phase, credential, or tenant changes.
--   - Record a safe audit event when settings are updated.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_branch_id UUID;
  v_display_name TEXT;
  v_phone TEXT;
  v_logo_url TEXT;
  v_website TEXT;
  v_email TEXT;
  v_receipt_footer TEXT;
  v_print_mode TEXT;
  v_show_logo BOOLEAN;
  v_show_website BOOLEAN;
  v_show_email BOOLEAN;
  v_show_footer BOOLEAN;
  v_show_cash_change BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid invoice settings payload' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_display_name := NULLIF(TRIM(COALESCE(p_payload ->> 'display_name', '')), '');
  v_phone := NULLIF(TRIM(COALESCE(p_payload ->> 'phone', '')), '');
  v_logo_url := NULLIF(TRIM(COALESCE(p_payload ->> 'logo_url', '')), '');
  v_website := NULLIF(TRIM(COALESCE(p_payload ->> 'website', '')), '');
  v_email := NULLIF(TRIM(COALESCE(p_payload ->> 'email', '')), '');
  v_receipt_footer := NULLIF(TRIM(COALESCE(p_payload ->> 'receipt_footer', '')), '');
  v_print_mode := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'print_mode', '')), ''), 'thermal');
  v_show_logo := COALESCE((p_payload ->> 'show_logo')::boolean, TRUE);
  v_show_website := COALESCE((p_payload ->> 'show_website')::boolean, FALSE);
  v_show_email := COALESCE((p_payload ->> 'show_email')::boolean, FALSE);
  v_show_footer := COALESCE((p_payload ->> 'show_footer')::boolean, TRUE);
  v_show_cash_change := COALESCE((p_payload ->> 'show_cash_change')::boolean, TRUE);

  IF v_print_mode NOT IN ('thermal', 'pdf', 'both') THEN
    RAISE EXCEPTION 'Invalid print_mode' USING ERRCODE = '22023';
  END IF;

  IF v_display_name IS NOT NULL AND length(v_display_name) > 160 THEN
    RAISE EXCEPTION 'Display name is too long' USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL AND length(v_phone) > 50 THEN
    RAISE EXCEPTION 'Phone is too long' USING ERRCODE = '22023';
  END IF;

  IF v_logo_url IS NOT NULL AND length(v_logo_url) > 1000 THEN
    RAISE EXCEPTION 'Logo URL is too long' USING ERRCODE = '22023';
  END IF;

  IF v_website IS NOT NULL AND length(v_website) > 255 THEN
    RAISE EXCEPTION 'Website is too long' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL AND length(v_email) > 255 THEN
    RAISE EXCEPTION 'Email is too long' USING ERRCODE = '22023';
  END IF;

  IF v_receipt_footer IS NOT NULL AND length(v_receipt_footer) > 500 THEN
    RAISE EXCEPTION 'Receipt footer is too long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.branches
  SET
    display_name = v_display_name,
    phone = v_phone,
    show_logo = v_show_logo,
    logo_url = v_logo_url,
    website = v_website,
    email = v_email,
    show_website = v_show_website,
    show_email = v_show_email,
    receipt_footer = v_receipt_footer,
    show_footer = v_show_footer,
    show_cash_change = v_show_cash_change,
    print_mode = v_print_mode,
    updated_at = NOW()
  WHERE id = v_branch.id;

  PERFORM public.record_audit_event(
    'branch_invoice_settings_updated',
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
      'print_mode', v_print_mode,
      'show_logo', v_show_logo,
      'show_website', v_show_website,
      'show_email', v_show_email,
      'show_footer', v_show_footer,
      'show_cash_change', v_show_cash_change,
      'has_logo_url', v_logo_url IS NOT NULL,
      'has_receipt_footer', v_receipt_footer IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'updated_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_branch_invoice_settings(jsonb) IS
  'Safely updates invoice/receipt display settings for an authorized branch without granting direct browser UPDATE on branches.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm authenticated can execute the RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.update_branch_invoice_settings(jsonb)',
--   'EXECUTE'
-- ) AS authenticated_can_update_invoice_settings;
--
-- 2) Confirm direct branch UPDATE grants were not broadened by this patch:
--
-- SELECT table_name, column_name, grantee, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'branches'
--   AND grantee = 'authenticated'
--   AND privilege_type = 'UPDATE'
-- ORDER BY column_name;
--
-- 3) Negative payload probe should not affect forbidden fields:
--
-- SELECT public.update_branch_invoice_settings(jsonb_build_object(
--   'branch_id', '00000000-0000-0000-0000-000000000000',
--   'display_name', 'Receipt Display Name',
--   'vat_number', 'SHOULD_NOT_UPDATE',
--   'invoice_counter', 999999,
--   'zatca_phase', 1
-- ));
