-- ============================================================
-- fix-complete-onboarding.sql
--
-- Replaces the old complete_onboarding() function (which had
-- branch-creation params from the 3-step onboarding flow) with
-- the current 2-step version that creates tenant + subscription
-- only. Branches are created later via Settings → Branches.
--
-- OnboardingPage.tsx calls this function with:
--   p_company_name, p_company_name_ar, p_vat_number,
--   p_cr_number, p_city, p_phone, p_website, p_plan_id
--
-- The old onboarding-function.sql also accepted:
--   p_branch_name, p_branch_name_ar, p_vat_mode,
--   p_invoice_prefix, p_building_number, p_street,
--   p_district, p_postal_code
-- Those are removed here.
--
-- Safe to run multiple times (CREATE OR REPLACE).
-- ============================================================

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
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_plan_id   UUID;
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND tenant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED: user % already has a tenant', v_user_id;
  END IF;

  -- Resolve plan (fall back to cheapest active plan if none selected)
  IF p_plan_id IS NULL THEN
    SELECT id INTO v_plan_id
    FROM   public.subscription_plans
    WHERE  is_active = TRUE
    ORDER  BY price_monthly ASC
    LIMIT  1;
  ELSE
    v_plan_id := p_plan_id;
  END IF;

  -- 1. Create tenant
  INSERT INTO public.tenants (
    name, name_ar, vat_number, cr_number,
    city, country, phone, email
  ) VALUES (
    p_company_name,
    NULLIF(TRIM(p_company_name_ar), ''),
    NULLIF(TRIM(p_vat_number),      ''),
    NULLIF(TRIM(p_cr_number),       ''),
    NULLIF(TRIM(p_city),            ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'SA'),
    NULLIF(TRIM(p_phone),           ''),
    NULL
  )
  RETURNING id INTO v_tenant_id;

  -- 2. Create 14-day trial subscription
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, trial_ends_at
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days'
  );

  -- 3. Promote user to owner — branch_id stays NULL.
  --    Branches are created manually via Settings → Branches.
  UPDATE public.user_profiles
  SET
    tenant_id  = v_tenant_id,
    branch_id  = NULL,
    role       = 'owner',
    updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('tenant_id', v_tenant_id);

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding TO authenticated;
