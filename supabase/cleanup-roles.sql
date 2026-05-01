-- ============================================================
-- Dafra — Role Cleanup & Onboarding Simplification
--
-- Changes:
-- 1. complete_onboarding() — tenant + subscription only.
--    Branch creation removed; owners add branches manually
--    via Settings → Branches after onboarding.
--
-- 2. RLS policy cleanup — remove 'accountant' role from all
--    policies. Only 3 roles remain: super_admin, owner, branch.
--    (PostgreSQL cannot remove enum values, so we leave the
--    'accountant' value in the enum but stop granting it access
--    anywhere in the application layer.)
-- ============================================================

-- ── 1. Simplified complete_onboarding() ─────────────────────

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

-- ── 2. Remove 'accountant' from RLS policies ────────────────
--
-- Drop and recreate any policy that references 'accountant'.
-- Safe to run multiple times (DROP IF EXISTS + CREATE OR REPLACE).

-- user_profiles
DROP POLICY IF EXISTS "Owners and accountants can view tenant profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Owners can view tenant profiles" ON public.user_profiles;
CREATE POLICY "Owners can view tenant profiles"
  ON public.user_profiles FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('owner', 'branch')
  );

-- tenants
DROP POLICY IF EXISTS "Owners and accountants can view their tenant" ON public.tenants;
DROP POLICY IF EXISTS "Owners can view their tenant" ON public.tenants;
CREATE POLICY "Owners can view their tenant"
  ON public.tenants FOR SELECT
  USING (id = public.get_my_tenant_id() AND public.get_my_role() IN ('owner', 'branch'));

DROP POLICY IF EXISTS "Only owners and accountants can update tenant" ON public.tenants;
DROP POLICY IF EXISTS "Only owners can update tenant" ON public.tenants;
CREATE POLICY "Only owners can update tenant"
  ON public.tenants FOR UPDATE
  USING (id = public.get_my_tenant_id() AND public.get_my_role() = 'owner');

-- branches
DROP POLICY IF EXISTS "Owners and accountants can view branches" ON public.branches;
DROP POLICY IF EXISTS "Owners and branch users can view branches" ON public.branches;
CREATE POLICY "Owners and branch users can view branches"
  ON public.branches FOR SELECT
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() IN ('owner', 'branch'));

DROP POLICY IF EXISTS "Only owners and accountants can manage branches" ON public.branches;
DROP POLICY IF EXISTS "Only owners can manage branches" ON public.branches;
CREATE POLICY "Only owners can manage branches"
  ON public.branches FOR ALL
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'owner');

-- products
DROP POLICY IF EXISTS "Owners and accountants can manage products" ON public.products;
DROP POLICY IF EXISTS "Owners can manage products" ON public.products;
CREATE POLICY "Owners can manage products"
  ON public.products FOR ALL
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() IN ('owner', 'branch'));

-- customers
DROP POLICY IF EXISTS "Owners and accountants can manage customers" ON public.customers;
DROP POLICY IF EXISTS "Owners and branch can manage customers" ON public.customers;
CREATE POLICY "Owners and branch can manage customers"
  ON public.customers FOR ALL
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() IN ('owner', 'branch'));

-- invoices
DROP POLICY IF EXISTS "Owners and accountants can view all invoices" ON public.invoices;
DROP POLICY IF EXISTS "Owners can view all invoices" ON public.invoices;
CREATE POLICY "Owners can view all invoices"
  ON public.invoices FOR SELECT
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'owner');

DROP POLICY IF EXISTS "Owners and accountants can manage invoices" ON public.invoices;

-- expenses
DROP POLICY IF EXISTS "Owners and accountants can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Owners and branch can view expenses" ON public.expenses;
CREATE POLICY "Owners and branch can view expenses"
  ON public.expenses FOR SELECT
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() IN ('owner', 'branch'));

-- employees
DROP POLICY IF EXISTS "Owners and accountants can manage employees" ON public.employees;
DROP POLICY IF EXISTS "Owners can manage employees" ON public.employees;
CREATE POLICY "Owners can manage employees"
  ON public.employees FOR ALL
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'owner');

-- reports / subscription_plans
DROP POLICY IF EXISTS "Owners and accountants can view plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Owners can view plans" ON public.subscription_plans;
CREATE POLICY "Owners can view plans"
  ON public.subscription_plans FOR SELECT
  USING (is_active = TRUE);
