-- Harden owner self-onboarding without changing its frontend RPC contract.

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_company_name      TEXT,
  p_company_name_ar   TEXT    DEFAULT '',
  p_vat_number        TEXT    DEFAULT '',
  p_cr_number         TEXT    DEFAULT '',
  p_city              TEXT    DEFAULT '',
  p_country           TEXT    DEFAULT 'SA',
  p_phone             TEXT    DEFAULT '',
  p_website           TEXT    DEFAULT '',
  p_plan_id           UUID    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id          UUID;
  v_profile          public.user_profiles%ROWTYPE;
  v_tenant_id        UUID;
  v_plan_id          UUID;
  v_updated_profiles INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  BEGIN
    SELECT *
    INTO STRICT v_profile
    FROM public.user_profiles
    WHERE id = v_user_id
    FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Onboarding is not permitted';
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Onboarding is not permitted';
  END;

  IF v_profile.tenant_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'ALREADY_ONBOARDED: onboarding has already been completed';
  END IF;

  IF v_profile.is_active IS DISTINCT FROM TRUE
     OR v_profile.role = 'branch'::public.user_role
     OR v_profile.role = 'super_admin'::public.user_role
     OR v_profile.role <> 'owner'::public.user_role
     OR v_profile.branch_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Onboarding is not permitted';
  END IF;

  IF p_plan_id IS NULL THEN
    SELECT id
    INTO v_plan_id
    FROM public.subscription_plans
    WHERE is_active = TRUE
    ORDER BY price_monthly ASC
    LIMIT 1;
  ELSE
    SELECT id
    INTO v_plan_id
    FROM public.subscription_plans
    WHERE id = p_plan_id
      AND is_active = TRUE;
  END IF;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A valid subscription plan is required';
  END IF;

  INSERT INTO public.tenants (
    name, name_ar, vat_number, cr_number,
    city, country, phone, email
  ) VALUES (
    p_company_name,
    NULLIF(TRIM(p_company_name_ar), ''),
    NULLIF(TRIM(p_vat_number), ''),
    NULLIF(TRIM(p_cr_number), ''),
    NULLIF(TRIM(p_city), ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'SA'),
    NULLIF(TRIM(p_phone), ''),
    NULL
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, trial_ends_at
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days'
  );

  UPDATE public.user_profiles
  SET
    tenant_id = v_tenant_id,
    branch_id = NULL,
    role = 'owner',
    updated_at = NOW()
  WHERE id = v_user_id
    AND is_active = TRUE
    AND role = 'owner'::public.user_role
    AND tenant_id IS NULL
    AND branch_id IS NULL;

  GET DIAGNOSTICS v_updated_profiles = ROW_COUNT;

  IF v_updated_profiles <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Onboarding could not be completed';
  END IF;

  RETURN jsonb_build_object('tenant_id', v_tenant_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_onboarding(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.complete_onboarding(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM anon;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;

COMMENT ON FUNCTION public.complete_onboarding(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) IS 'Atomically onboards one authenticated, active, unassigned owner profile.';
