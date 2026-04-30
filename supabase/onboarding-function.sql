-- ============================================================
-- onboarding-function.sql
-- Creates the complete_onboarding() RPC function.
-- Run in Supabase SQL Editor AFTER schema.sql and
-- update-branches.sql have been applied.
-- ============================================================

-- ── Function ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  -- Step 1 — Company
  p_company_name      TEXT,
  p_company_name_ar   TEXT    DEFAULT '',
  p_vat_number        TEXT    DEFAULT '',
  p_cr_number         TEXT    DEFAULT '',
  p_city              TEXT    DEFAULT '',
  p_country           TEXT    DEFAULT 'SA',
  p_phone             TEXT    DEFAULT '',
  p_website           TEXT    DEFAULT '',
  -- Step 2 — Branch
  p_branch_name       TEXT    DEFAULT '',
  p_branch_name_ar    TEXT    DEFAULT '',
  p_vat_mode          TEXT    DEFAULT 'exclusive',
  p_invoice_prefix    TEXT    DEFAULT 'INV',
  p_building_number   TEXT    DEFAULT '',
  p_street            TEXT    DEFAULT '',
  p_district          TEXT    DEFAULT '',
  p_postal_code       TEXT    DEFAULT '',
  -- Step 3 — Plan
  p_plan_id           UUID    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER          -- bypasses RLS so new users can create their tenant
SET search_path = public  -- prevent search_path injection
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_branch_id UUID;
  v_plan_id   UUID;
BEGIN
  -- ── Guard: idempotency ────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND tenant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED: user % already has a tenant', v_user_id;
  END IF;

  -- ── Resolve plan ─────────────────────────────────────────
  -- If no plan passed, fall back to the cheapest active plan.
  IF p_plan_id IS NULL THEN
    SELECT id INTO v_plan_id
    FROM   public.subscription_plans
    WHERE  is_active = TRUE
    ORDER  BY price_monthly ASC
    LIMIT  1;
  ELSE
    v_plan_id := p_plan_id;
  END IF;

  -- ── 1. Create tenant ──────────────────────────────────────
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
    NULL  -- email can be added later in Settings
  )
  RETURNING id INTO v_tenant_id;

  -- ── 2. Create main branch ─────────────────────────────────
  INSERT INTO public.branches (
    tenant_id,
    name,           name_ar,
    vat_mode,       invoice_prefix,
    building_number, street, district,
    city,           country,        postal_code,
    is_main_branch, is_active
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

  -- ── 3. Create 14-day trial subscription ───────────────────
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, trial_ends_at
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days'
  );

  -- ── 4. Upgrade user to owner of this tenant ───────────────
  UPDATE public.user_profiles
  SET
    tenant_id  = v_tenant_id,
    branch_id  = v_branch_id,
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

-- Allow any authenticated user to call this function.
-- The SECURITY DEFINER + guard ensures it can't be abused.
GRANT EXECUTE ON FUNCTION public.complete_onboarding TO authenticated;

-- ── Verification ──────────────────────────────────────────────
-- After running, test with:
--
-- SELECT public.complete_onboarding(
--   'Test Company', 'شركة اختبار',
--   '301234567890123', '1234567890',
--   'Riyadh', 'SA', '+966500000000', '',
--   'Main Branch', 'الفرع الرئيسي',
--   'exclusive', 'INV',
--   '', '', '', ''
-- );
