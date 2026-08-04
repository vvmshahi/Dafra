-- Branch Settings authority and effective customer-credit diagnostics.
--
-- This migration only widens the existing narrow POS-settings RPC to the
-- authenticated user who owns the Branch and adds diagnostic fields to the
-- existing read-only credit preflight. It does not write business, customer,
-- invoice, payment, ledger, stock, ZATCA, or historical rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_branch_settings_contracts$
BEGIN
  IF to_regclass('public.branches') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_credit_policies') IS NULL
     OR to_regprocedure('public.update_branch_pos_settings(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.get_customer_credit_checkout_eligibility_v1(jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'BRANCH_SETTINGS_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_branch_settings_contracts$;

-- Keep the established storage and payload contract, but allow a Branch user
-- to update only its own Branch. Owner/admin access remains tenant-scoped.
CREATE OR REPLACE FUNCTION public.update_branch_pos_settings(
  p_branch_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_allow_split_payments boolean;
  v_show_pos_scroll_buttons boolean;
  v_pos_mode text;
  v_updated_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_BRANCH_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN ('allow_split_payments', 'show_pos_scroll_buttons', 'pos_mode')
  ) THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_KEY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'allow_split_payments')
     AND jsonb_typeof(p_payload -> 'allow_split_payments') <> 'boolean' THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_SPLIT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'show_pos_scroll_buttons')
     AND jsonb_typeof(p_payload -> 'show_pos_scroll_buttons') <> 'boolean' THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_NAVIGATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'pos_mode') AND (
    jsonb_typeof(p_payload -> 'pos_mode') <> 'string'
    OR p_payload ->> 'pos_mode' NOT IN ('touch', 'quick')
  ) THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_MODE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_payload ? 'allow_split_payments')
     AND NOT (p_payload ? 'show_pos_scroll_buttons')
     AND NOT (p_payload ? 'pos_mode') THEN
    RAISE EXCEPTION 'AR_BRANCH_POS_SETTINGS_EMPTY' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, allow_split_payments,
         show_pos_scroll_buttons, pos_mode, is_active
  INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_allow_split_payments := coalesce(
    (p_payload ->> 'allow_split_payments')::boolean,
    coalesce(v_branch.allow_split_payments, false));
  v_show_pos_scroll_buttons := coalesce(
    (p_payload ->> 'show_pos_scroll_buttons')::boolean,
    coalesce(v_branch.show_pos_scroll_buttons, false));
  v_pos_mode := coalesce(p_payload ->> 'pos_mode', coalesce(v_branch.pos_mode, 'touch'));

  UPDATE public.branches
  SET allow_split_payments = v_allow_split_payments,
      show_pos_scroll_buttons = v_show_pos_scroll_buttons,
      pos_mode = v_pos_mode,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_pos_settings_updated', v_branch.tenant_id, v_branch.id,
      v_user_id, v_profile.role, 'branch', v_branch.id, 'info', 'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'allow_split_payments_before', coalesce(v_branch.allow_split_payments, false),
        'allow_split_payments_after', v_allow_split_payments,
        'show_pos_scroll_buttons_before', coalesce(v_branch.show_pos_scroll_buttons, false),
        'show_pos_scroll_buttons_after', v_show_pos_scroll_buttons,
        'pos_mode_before', coalesce(v_branch.pos_mode, 'touch'),
        'pos_mode_after', v_pos_mode),
      NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'allow_split_payments', v_allow_split_payments,
    'show_pos_scroll_buttons', v_show_pos_scroll_buttons,
    'pos_mode', v_pos_mode,
    'updated_at', v_updated_at);
END
$function$;

ALTER FUNCTION public.update_branch_pos_settings(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_branch_pos_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_pos_settings(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.update_branch_pos_settings(uuid, jsonb) IS
  'Server-authoritative Branch POS settings. Owner/admin are tenant-scoped; Branch users are restricted to their own Branch.';

-- Preserve the 009 implementation as an internal compatibility function and
-- expose a stable effective summary to the frontend. The underlying preflight
-- remains the authority for allowed/denied and financial limits.
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  RENAME TO get_customer_credit_checkout_eligibility_v1_raw_20260803;

CREATE OR REPLACE FUNCTION public.get_customer_credit_checkout_eligibility_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_raw jsonb;
  v_branch_id uuid;
  v_customer_id uuid;
  v_branch_active boolean := false;
  v_customer_active boolean := false;
  v_account_ready boolean := false;
  v_receivable_account_id uuid;
  v_customer_enabled boolean := false;
  v_business_enabled boolean := false;
  v_branch_enabled boolean := false;
  v_reason_code text;
BEGIN
  v_raw := public.get_customer_credit_checkout_eligibility_v1_raw_20260803(p_payload);
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload ->> 'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;

  SELECT b.is_active INTO v_branch_active
  FROM public.branches b WHERE b.id = v_branch_id;
  SELECT c.is_active, c.receivable_account_id
  INTO v_customer_active, v_receivable_account_id
  FROM public.customers c WHERE c.id = v_customer_id;
  v_account_ready := v_receivable_account_id IS NOT NULL;
  IF v_account_ready THEN
    SELECT p.credit_enabled INTO v_customer_enabled
    FROM public.customer_credit_policies p
    WHERE p.receivable_account_id = v_receivable_account_id
      AND p.tenant_id = (SELECT b.tenant_id FROM public.branches b WHERE b.id = v_branch_id);
    v_customer_enabled := coalesce(v_customer_enabled, false);
  END IF;

  v_business_enabled := coalesce((v_raw ->> 'tenantCreditEnabled')::boolean, false);
  v_branch_enabled := coalesce((v_raw ->> 'branchCreditEnabled')::boolean, false);
  v_reason_code := CASE v_raw ->> 'reasonCode'
    WHEN 'AR_CREDIT_TENANT_POLICY_DISABLED' THEN 'BUSINESS_CREDIT_DISABLED'
    WHEN 'AR_CREDIT_BRANCH_DISABLED' THEN 'BRANCH_CREDIT_DISABLED'
    WHEN 'AR_CREDIT_ACCOUNT_NOT_READY' THEN 'CREDIT_ACCOUNT_NOT_READY'
    WHEN 'AR_CREDIT_DISABLED' THEN 'CUSTOMER_CREDIT_DISABLED'
    ELSE coalesce(v_raw ->> 'reasonCode', 'CREDIT_UNAVAILABLE')
  END;

  RETURN v_raw || jsonb_build_object(
    'business_enabled', v_business_enabled,
    'branch_enabled', v_branch_enabled,
    'customer_enabled', v_customer_enabled,
    'account_ready', v_account_ready,
    'customer_active', coalesce(v_customer_active, false),
    'branch_active', coalesce(v_branch_active, false),
    'eligible', coalesce((v_raw ->> 'allowed')::boolean, false),
    'reason_code', v_reason_code,
    'effectiveReasonCode', v_reason_code,
    'businessEnabled', v_business_enabled,
    'branchEnabled', v_branch_enabled,
    'customerEnabled', v_customer_enabled,
    'accountReady', v_account_ready,
    'customerActive', coalesce(v_customer_active, false),
    'branchActive', coalesce(v_branch_active, false),
    -- Keep the legacy camelCase code for existing checkout/audit consumers;
    -- the normalized snake_case field is the frontend-facing diagnostic.
    'reasonCode', v_raw ->> 'reasonCode');
END
$function$;

ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1_raw_20260803(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1_raw_20260803(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) TO authenticated;
COMMENT ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) IS
  'Read-only effective customer-credit summary. It reports business, Branch, customer, account and active-state diagnostics without creating rows.';

NOTIFY pgrst, 'reload schema';

COMMIT;
