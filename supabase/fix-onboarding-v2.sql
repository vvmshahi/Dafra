-- ============================================================
-- Dafra — Onboarding Fix v2
--
-- Two fixes:
-- 1. handle_new_user trigger: default role changed from
--    'cashier' → 'owner' so public signups get the right role
--    even before complete_onboarding() is called.
--
-- 2. complete_onboarding(): owners get branch_id = NULL.
--    Owners are tenant-level users; they are not tied to any
--    specific branch. (Branch users have branch_id set via
--    their own signUp metadata when created in Settings.)
-- ============================================================

-- ── 1. Update the handle_new_user trigger ────────────────────

DROP TRIGGER   IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION  IF EXISTS public.handle_new_user();

CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Silent no-op on login upserts (GoTrue re-fires INSERT trigger).
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.user_profiles (id, full_name, role, tenant_id, branch_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::public.user_role,
            'owner'   -- public signup default; branch invites pass role='branch' explicitly
        ),
        NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'tenant_id', '')), '')::uuid,
        NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'branch_id', '')), '')::uuid
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ── 2. Update complete_onboarding() — branch_id = NULL for owners ────────────

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_company_name      TEXT,
  p_company_name_ar   TEXT    DEFAULT '',
  p_vat_number        TEXT    DEFAULT '',
  p_cr_number         TEXT    DEFAULT '',
  p_city              TEXT    DEFAULT '',
  p_country           TEXT    DEFAULT 'SA',
  p_phone             TEXT    DEFAULT '',
  p_website           TEXT    DEFAULT '',
  p_branch_name       TEXT    DEFAULT '',
  p_branch_name_ar    TEXT    DEFAULT '',
  p_vat_mode          TEXT    DEFAULT 'exclusive',
  p_invoice_prefix    TEXT    DEFAULT 'INV',
  p_building_number   TEXT    DEFAULT '',
  p_street            TEXT    DEFAULT '',
  p_district          TEXT    DEFAULT '',
  p_postal_code       TEXT    DEFAULT '',
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
  v_branch_id UUID;
  v_plan_id   UUID;
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND tenant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED: user % already has a tenant', v_user_id;
  END IF;

  -- Resolve plan
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

  -- 2. Create main branch
  INSERT INTO public.branches (
    tenant_id,
    name,            name_ar,
    vat_mode,        invoice_prefix,
    building_number, street, district,
    city,            country,        postal_code,
    is_main_branch,  is_active
  ) VALUES (
    v_tenant_id,
    COALESCE(NULLIF(TRIM(p_branch_name), ''), p_company_name),
    NULLIF(TRIM(p_branch_name_ar),  ''),
    COALESCE(NULLIF(p_vat_mode, ''), 'exclusive'),
    COALESCE(NULLIF(TRIM(p_invoice_prefix), ''), 'INV'),
    NULLIF(TRIM(p_building_number), ''),
    NULLIF(TRIM(p_street),          ''),
    NULLIF(TRIM(p_district),        ''),
    NULLIF(TRIM(p_city),            ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'SA'),
    NULLIF(TRIM(p_postal_code),     ''),
    TRUE, TRUE
  )
  RETURNING id INTO v_branch_id;

  -- 3. Create 14-day trial subscription
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, trial_ends_at
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days'
  );

  -- 4. Set user as owner — branch_id stays NULL for owners.
  --    They see all branches; they are not scoped to any one branch.
  UPDATE public.user_profiles
  SET
    tenant_id  = v_tenant_id,
    branch_id  = NULL,
    role       = 'owner',
    updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'branch_id', v_branch_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding TO authenticated;
