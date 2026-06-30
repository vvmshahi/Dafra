-- ============================================================
-- Phase 3A canonical RLS + sensitive-column lockdown
-- Apply manually in Supabase SQL editor after Phase 2C.
-- ============================================================
--
-- Goals:
--   - Replace drifted permissive policies with one canonical role model.
--   - Keep working POS/reporting/list/detail flows readable.
--   - Move financial writes to RPC/Edge Function paths:
--       public.pos_checkout(p_payload jsonb)
--       public.create_full_credit_note(p_payload jsonb)
--       zatca-submit Edge Function
--   - Lock browser access away from ZATCA private keys, secrets, CSIDs,
--     raw signed XML, raw ZATCA responses, sync queue rows, and debug XML.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.
--   - This patch does not change production credential values.
--
-- Role model used by policies:
--   super_admin        platform-wide access, if intentionally provisioned
--   owner/admin        own tenant only
--   branch/manager/
--   cashier/accountant assigned branch only where branch-owned data applies
--
-- Notes:
--   - The repo has historical role labels. Policies compare role::text so the
--     patch is tolerant of both the newer 'branch' role and older labels.
--   - Service-role Edge Functions continue to bypass RLS in Supabase.
--   - Browser access to public.zatca_certificates is reduced to safe metadata
--     columns only. Legacy sandbox certificate management that does SELECT *
--     or browser INSERT/UPDATE on that table needs a frontend/RPC follow-up.

BEGIN;

-- ============================================================
-- RLS helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.rls_current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.tenant_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_current_branch_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.branch_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_current_role_text()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.role::text
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rls_current_role_text() = 'super_admin', FALSE)
$$;

CREATE OR REPLACE FUNCTION public.rls_is_tenant_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rls_current_role_text() IN ('owner', 'admin'), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.rls_is_branch_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rls_current_role_text() IN ('branch', 'manager', 'cashier', 'accountant'), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.rls_can_access_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR (
      p_tenant_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND public.rls_current_role_text() IN ('owner', 'admin', 'branch', 'manager', 'cashier', 'accountant')
    ),
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.rls_can_manage_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR (
      p_tenant_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND public.rls_is_tenant_admin()
    ),
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.rls_can_access_branch(p_tenant_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR public.rls_can_manage_tenant(p_tenant_id)
    OR (
      p_tenant_id IS NOT NULL
      AND p_branch_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND p_branch_id = public.rls_current_branch_id()
      AND public.rls_is_branch_staff()
    ),
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.rls_can_write_branch(p_tenant_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.rls_can_access_branch(p_tenant_id, p_branch_id)
$$;

REVOKE ALL ON FUNCTION public.rls_current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_current_branch_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_current_role_text() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_is_tenant_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_is_branch_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_can_access_tenant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_can_manage_tenant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_can_access_branch(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_can_write_branch(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rls_current_tenant_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_current_branch_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_current_role_text() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_tenant_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_branch_staff() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_can_access_tenant(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_can_manage_tenant(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_can_access_branch(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_can_write_branch(UUID, UUID) TO anon, authenticated, service_role;

-- ============================================================
-- Temporary migration helpers
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.phase3a_column_exists(p_table TEXT, p_column TEXT)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  )
$$;

CREATE OR REPLACE FUNCTION pg_temp.phase3a_exec_if_table(p_table TEXT, p_sql TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NOT NULL THEN
    EXECUTE p_sql;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.phase3a_grant_columns(
  p_table TEXT,
  p_privilege TEXT,
  p_role TEXT,
  p_columns TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_cols TEXT;
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(format('%I', c), ', ')
    INTO v_cols
  FROM unnest(p_columns) AS c
  WHERE pg_temp.phase3a_column_exists(p_table, c);

  IF v_cols IS NOT NULL THEN
    EXECUTE format(
      'GRANT %s (%s) ON TABLE public.%I TO %I',
      upper(p_privilege),
      v_cols,
      p_table,
      p_role
    );
  END IF;
END;
$$;

-- ============================================================
-- Enable RLS, remove broad browser grants, and drop drifted policies
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'subscription_plans',
    'tenants',
    'tenant_subscriptions',
    'branches',
    'user_profiles',
    'zatca_certificates',
    'categories',
    'products',
    'customers',
    'employees',
    'invoices',
    'invoice_items',
    'payments',
    'payment_refunds',
    'pos_stock_movements',
    'sync_queue',
    'expense_categories',
    'expenses',
    'fixed_expenses',
    'suppliers',
    'inventory_items',
    'purchases',
    'purchase_items',
    'day_closings',
    'zatca_production_credentials',
    'zatca_production_debug_samples'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', v_table);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'subscription_plans',
        'tenants',
        'tenant_subscriptions',
        'branches',
        'user_profiles',
        'zatca_certificates',
        'categories',
        'products',
        'customers',
        'employees',
        'invoices',
        'invoice_items',
        'payments',
        'payment_refunds',
        'pos_stock_movements',
        'sync_queue',
        'expense_categories',
        'expenses',
        'fixed_expenses',
        'suppliers',
        'inventory_items',
        'purchases',
        'purchase_items',
        'day_closings',
        'zatca_production_credentials',
        'zatca_production_debug_samples'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- Canonical policies
-- ============================================================

-- subscription_plans
SELECT pg_temp.phase3a_exec_if_table('subscription_plans', $sql$
  CREATE POLICY phase3a_subscription_plans_read
    ON public.subscription_plans
    FOR SELECT TO anon, authenticated
    USING (is_active IS TRUE OR public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('subscription_plans', $sql$
  CREATE POLICY phase3a_subscription_plans_super_insert
    ON public.subscription_plans
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('subscription_plans', $sql$
  CREATE POLICY phase3a_subscription_plans_super_update
    ON public.subscription_plans
    FOR UPDATE TO authenticated
    USING (public.rls_is_super_admin())
    WITH CHECK (public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('subscription_plans', $sql$
  CREATE POLICY phase3a_subscription_plans_super_delete
    ON public.subscription_plans
    FOR DELETE TO authenticated
    USING (public.rls_is_super_admin())
$sql$);

-- tenants
SELECT pg_temp.phase3a_exec_if_table('tenants', $sql$
  CREATE POLICY phase3a_tenants_select
    ON public.tenants
    FOR SELECT TO authenticated
    USING (public.rls_can_access_tenant(id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenants', $sql$
  CREATE POLICY phase3a_tenants_update
    ON public.tenants
    FOR UPDATE TO authenticated
    USING (public.rls_can_manage_tenant(id))
    WITH CHECK (public.rls_can_manage_tenant(id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenants', $sql$
  CREATE POLICY phase3a_tenants_super_insert
    ON public.tenants
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenants', $sql$
  CREATE POLICY phase3a_tenants_super_delete
    ON public.tenants
    FOR DELETE TO authenticated
    USING (public.rls_is_super_admin())
$sql$);

-- tenant_subscriptions
SELECT pg_temp.phase3a_exec_if_table('tenant_subscriptions', $sql$
  CREATE POLICY phase3a_tenant_subscriptions_select
    ON public.tenant_subscriptions
    FOR SELECT TO authenticated
    USING (public.rls_can_access_tenant(tenant_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenant_subscriptions', $sql$
  CREATE POLICY phase3a_tenant_subscriptions_super_insert
    ON public.tenant_subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenant_subscriptions', $sql$
  CREATE POLICY phase3a_tenant_subscriptions_super_update
    ON public.tenant_subscriptions
    FOR UPDATE TO authenticated
    USING (public.rls_is_super_admin())
    WITH CHECK (public.rls_is_super_admin())
$sql$);

SELECT pg_temp.phase3a_exec_if_table('tenant_subscriptions', $sql$
  CREATE POLICY phase3a_tenant_subscriptions_super_delete
    ON public.tenant_subscriptions
    FOR DELETE TO authenticated
    USING (public.rls_is_super_admin())
$sql$);

-- branches
SELECT pg_temp.phase3a_exec_if_table('branches', $sql$
  CREATE POLICY phase3a_branches_select
    ON public.branches
    FOR SELECT TO authenticated
    USING (public.rls_can_access_branch(tenant_id, id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('branches', $sql$
  CREATE POLICY phase3a_branches_insert
    ON public.branches
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_can_manage_tenant(tenant_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('branches', $sql$
  CREATE POLICY phase3a_branches_update
    ON public.branches
    FOR UPDATE TO authenticated
    USING (
      public.rls_can_manage_tenant(tenant_id)
      OR (
        public.rls_is_branch_staff()
        AND tenant_id = public.rls_current_tenant_id()
        AND id = public.rls_current_branch_id()
      )
    )
    WITH CHECK (
      public.rls_can_manage_tenant(tenant_id)
      OR (
        public.rls_is_branch_staff()
        AND tenant_id = public.rls_current_tenant_id()
        AND id = public.rls_current_branch_id()
      )
    )
$sql$);

-- user_profiles
SELECT pg_temp.phase3a_exec_if_table('user_profiles', $sql$
  CREATE POLICY phase3a_user_profiles_select
    ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
      id = auth.uid()
      OR public.rls_is_super_admin()
      OR (
        tenant_id = public.rls_current_tenant_id()
        AND public.rls_is_tenant_admin()
      )
      OR (
        tenant_id = public.rls_current_tenant_id()
        AND branch_id = public.rls_current_branch_id()
        AND public.rls_is_branch_staff()
      )
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('user_profiles', $sql$
  CREATE POLICY phase3a_user_profiles_own_update
    ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid())
$sql$);

-- zatca_certificates: browser gets safe metadata columns only.
SELECT pg_temp.phase3a_exec_if_table('zatca_certificates', $sql$
  CREATE POLICY phase3a_zatca_certificates_safe_select
    ON public.zatca_certificates
    FOR SELECT TO authenticated
    USING (public.rls_can_access_branch(tenant_id, branch_id))
$sql$);

-- categories/products/customers/suppliers: branch-owned if branch_id exists.
DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL THEN
    IF pg_temp.phase3a_column_exists('categories', 'branch_id') THEN
      EXECUTE 'CREATE POLICY phase3a_categories_select ON public.categories FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_insert ON public.categories FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_update ON public.categories FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_delete ON public.categories FOR DELETE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id))';
    ELSE
      EXECUTE 'CREATE POLICY phase3a_categories_select ON public.categories FOR SELECT TO authenticated USING (public.rls_can_access_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_insert ON public.categories FOR INSERT TO authenticated WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_update ON public.categories FOR UPDATE TO authenticated USING (public.rls_can_manage_tenant(tenant_id)) WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_categories_delete ON public.categories FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    END IF;
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    IF pg_temp.phase3a_column_exists('products', 'branch_id') THEN
      EXECUTE 'CREATE POLICY phase3a_products_select ON public.products FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_products_insert ON public.products FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_products_update ON public.products FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_products_delete ON public.products FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    ELSE
      EXECUTE 'CREATE POLICY phase3a_products_select ON public.products FOR SELECT TO authenticated USING (public.rls_can_access_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_products_insert ON public.products FOR INSERT TO authenticated WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_products_update ON public.products FOR UPDATE TO authenticated USING (public.rls_can_manage_tenant(tenant_id)) WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_products_delete ON public.products FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    END IF;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL THEN
    IF pg_temp.phase3a_column_exists('customers', 'branch_id') THEN
      EXECUTE 'CREATE POLICY phase3a_customers_select ON public.customers FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_update ON public.customers FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_delete ON public.customers FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    ELSE
      EXECUTE 'CREATE POLICY phase3a_customers_select ON public.customers FOR SELECT TO authenticated USING (public.rls_can_access_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_update ON public.customers FOR UPDATE TO authenticated USING (public.rls_can_manage_tenant(tenant_id)) WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_customers_delete ON public.customers FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    END IF;
  END IF;

  IF to_regclass('public.suppliers') IS NOT NULL THEN
    IF pg_temp.phase3a_column_exists('suppliers', 'branch_id') THEN
      EXECUTE 'CREATE POLICY phase3a_suppliers_select ON public.suppliers FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_update ON public.suppliers FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_delete ON public.suppliers FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    ELSE
      EXECUTE 'CREATE POLICY phase3a_suppliers_select ON public.suppliers FOR SELECT TO authenticated USING (public.rls_can_access_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_update ON public.suppliers FOR UPDATE TO authenticated USING (public.rls_can_manage_tenant(tenant_id)) WITH CHECK (public.rls_can_manage_tenant(tenant_id))';
      EXECUTE 'CREATE POLICY phase3a_suppliers_delete ON public.suppliers FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
    END IF;
  END IF;
END $$;

-- employees
SELECT pg_temp.phase3a_exec_if_table('employees', $sql$
  CREATE POLICY phase3a_employees_select
    ON public.employees
    FOR SELECT TO authenticated
    USING (
      public.rls_can_manage_tenant(tenant_id)
      OR (
        tenant_id = public.rls_current_tenant_id()
        AND branch_id = public.rls_current_branch_id()
        AND public.rls_is_branch_staff()
      )
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('employees', $sql$
  CREATE POLICY phase3a_employees_insert
    ON public.employees
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_can_manage_tenant(tenant_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('employees', $sql$
  CREATE POLICY phase3a_employees_update
    ON public.employees
    FOR UPDATE TO authenticated
    USING (public.rls_can_manage_tenant(tenant_id))
    WITH CHECK (public.rls_can_manage_tenant(tenant_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('employees', $sql$
  CREATE POLICY phase3a_employees_delete
    ON public.employees
    FOR DELETE TO authenticated
    USING (public.rls_can_manage_tenant(tenant_id))
$sql$);

-- invoices: SELECT only plus QR backfill column update.
SELECT pg_temp.phase3a_exec_if_table('invoices', $sql$
  CREATE POLICY phase3a_invoices_select
    ON public.invoices
    FOR SELECT TO authenticated
    USING (public.rls_can_access_branch(tenant_id, branch_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('invoices', $sql$
  CREATE POLICY phase3a_invoices_qr_backfill_update
    ON public.invoices
    FOR UPDATE TO authenticated
    USING (
      public.rls_can_access_branch(tenant_id, branch_id)
      AND zatca_qr_code IS NULL
      AND status <> 'cancelled'
    )
    WITH CHECK (
      public.rls_can_access_branch(tenant_id, branch_id)
      AND status <> 'cancelled'
    )
$sql$);

-- invoice_items: read through parent invoice branch; writes are RPC-owned.
SELECT pg_temp.phase3a_exec_if_table('invoice_items', $sql$
  CREATE POLICY phase3a_invoice_items_select
    ON public.invoice_items
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND public.rls_can_access_branch(i.tenant_id, i.branch_id)
      )
    )
$sql$);

-- payments: read through parent invoice branch; writes are RPC-owned.
SELECT pg_temp.phase3a_exec_if_table('payments', $sql$
  CREATE POLICY phase3a_payments_select
    ON public.payments
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = payments.invoice_id
          AND public.rls_can_access_branch(i.tenant_id, i.branch_id)
      )
    )
$sql$);

-- payment_refunds: read only; create_full_credit_note owns writes.
SELECT pg_temp.phase3a_exec_if_table('payment_refunds', $sql$
  CREATE POLICY phase3a_payment_refunds_select
    ON public.payment_refunds
    FOR SELECT TO authenticated
    USING (public.rls_can_access_branch(tenant_id, branch_id))
$sql$);

-- sync_queue / pos_stock_movements: service-role only.
SELECT pg_temp.phase3a_exec_if_table('sync_queue', $sql$
  CREATE POLICY phase3a_sync_queue_service_all
    ON public.sync_queue
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true)
$sql$);

SELECT pg_temp.phase3a_exec_if_table('pos_stock_movements', $sql$
  CREATE POLICY phase3a_pos_stock_movements_service_all
    ON public.pos_stock_movements
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true)
$sql$);

-- expense_categories
SELECT pg_temp.phase3a_exec_if_table('expense_categories', $sql$
  CREATE POLICY phase3a_expense_categories_select
    ON public.expense_categories
    FOR SELECT TO authenticated
    USING (is_system IS TRUE OR tenant_id IS NULL OR public.rls_can_access_tenant(tenant_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('expense_categories', $sql$
  CREATE POLICY phase3a_expense_categories_insert
    ON public.expense_categories
    FOR INSERT TO authenticated
    WITH CHECK (
      public.rls_can_manage_tenant(tenant_id)
      AND is_system IS FALSE
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('expense_categories', $sql$
  CREATE POLICY phase3a_expense_categories_update
    ON public.expense_categories
    FOR UPDATE TO authenticated
    USING (
      public.rls_can_manage_tenant(tenant_id)
      AND is_system IS FALSE
    )
    WITH CHECK (
      public.rls_can_manage_tenant(tenant_id)
      AND is_system IS FALSE
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('expense_categories', $sql$
  CREATE POLICY phase3a_expense_categories_delete
    ON public.expense_categories
    FOR DELETE TO authenticated
    USING (
      public.rls_can_manage_tenant(tenant_id)
      AND is_system IS FALSE
    )
$sql$);

-- expenses / fixed_expenses / inventory_items / purchases
DO $$
BEGIN
  IF to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY phase3a_expenses_select ON public.expenses FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_expenses_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_expenses_update ON public.expenses FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_expenses_delete ON public.expenses FOR DELETE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id))';
  END IF;

  IF to_regclass('public.fixed_expenses') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY phase3a_fixed_expenses_select ON public.fixed_expenses FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_fixed_expenses_insert ON public.fixed_expenses FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_fixed_expenses_update ON public.fixed_expenses FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_fixed_expenses_delete ON public.fixed_expenses FOR DELETE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id))';
  END IF;

  IF to_regclass('public.inventory_items') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY phase3a_inventory_items_select ON public.inventory_items FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_inventory_items_insert ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_inventory_items_update ON public.inventory_items FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_inventory_items_delete ON public.inventory_items FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
  END IF;

  IF to_regclass('public.purchases') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY phase3a_purchases_select ON public.purchases FOR SELECT TO authenticated USING (public.rls_can_access_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_purchases_insert ON public.purchases FOR INSERT TO authenticated WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_purchases_update ON public.purchases FOR UPDATE TO authenticated USING (public.rls_can_write_branch(tenant_id, branch_id)) WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))';
    EXECUTE 'CREATE POLICY phase3a_purchases_delete ON public.purchases FOR DELETE TO authenticated USING (public.rls_can_manage_tenant(tenant_id))';
  END IF;
END $$;

-- purchase_items: scoped through parent purchase.
SELECT pg_temp.phase3a_exec_if_table('purchase_items', $sql$
  CREATE POLICY phase3a_purchase_items_select
    ON public.purchase_items
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.purchases p
        WHERE p.id = purchase_items.purchase_id
          AND public.rls_can_access_branch(p.tenant_id, p.branch_id)
      )
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('purchase_items', $sql$
  CREATE POLICY phase3a_purchase_items_insert
    ON public.purchase_items
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.purchases p
        WHERE p.id = purchase_items.purchase_id
          AND public.rls_can_write_branch(p.tenant_id, p.branch_id)
      )
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('purchase_items', $sql$
  CREATE POLICY phase3a_purchase_items_update
    ON public.purchase_items
    FOR UPDATE TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.purchases p
        WHERE p.id = purchase_items.purchase_id
          AND public.rls_can_write_branch(p.tenant_id, p.branch_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.purchases p
        WHERE p.id = purchase_items.purchase_id
          AND public.rls_can_write_branch(p.tenant_id, p.branch_id)
      )
    )
$sql$);

SELECT pg_temp.phase3a_exec_if_table('purchase_items', $sql$
  CREATE POLICY phase3a_purchase_items_delete
    ON public.purchase_items
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.purchases p
        WHERE p.id = purchase_items.purchase_id
          AND public.rls_can_write_branch(p.tenant_id, p.branch_id)
      )
    )
$sql$);

-- day_closings
SELECT pg_temp.phase3a_exec_if_table('day_closings', $sql$
  CREATE POLICY phase3a_day_closings_select
    ON public.day_closings
    FOR SELECT TO authenticated
    USING (public.rls_can_access_branch(tenant_id, branch_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('day_closings', $sql$
  CREATE POLICY phase3a_day_closings_insert
    ON public.day_closings
    FOR INSERT TO authenticated
    WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('day_closings', $sql$
  CREATE POLICY phase3a_day_closings_update
    ON public.day_closings
    FOR UPDATE TO authenticated
    USING (public.rls_can_write_branch(tenant_id, branch_id))
    WITH CHECK (public.rls_can_write_branch(tenant_id, branch_id))
$sql$);

SELECT pg_temp.phase3a_exec_if_table('day_closings', $sql$
  CREATE POLICY phase3a_day_closings_delete
    ON public.day_closings
    FOR DELETE TO authenticated
    USING (public.rls_can_manage_tenant(tenant_id))
$sql$);

-- Production credential/debug tables: service-role only.
SELECT pg_temp.phase3a_exec_if_table('zatca_production_credentials', $sql$
  CREATE POLICY phase3a_zatca_production_credentials_service_all
    ON public.zatca_production_credentials
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true)
$sql$);

SELECT pg_temp.phase3a_exec_if_table('zatca_production_debug_samples', $sql$
  CREATE POLICY phase3a_zatca_production_debug_samples_service_all
    ON public.zatca_production_debug_samples
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true)
$sql$);

-- ============================================================
-- Minimum table/column grants
-- ============================================================

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

SELECT pg_temp.phase3a_exec_if_table('subscription_plans', 'GRANT SELECT ON TABLE public.subscription_plans TO anon, authenticated');
SELECT pg_temp.phase3a_exec_if_table('subscription_plans', 'GRANT INSERT, UPDATE, DELETE ON TABLE public.subscription_plans TO authenticated');

SELECT pg_temp.phase3a_exec_if_table('tenants', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenants TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('tenant_subscriptions', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_subscriptions TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('branches', 'GRANT SELECT ON TABLE public.branches TO authenticated');
SELECT pg_temp.phase3a_grant_columns(
  'branches',
  'INSERT',
  'authenticated',
  ARRAY[
    'tenant_id',
    'name',
    'name_ar',
    'branch_code',
    'phone',
    'email',
    'address',
    'address_ar',
    'building_number',
    'additional_number',
    'street',
    'street_ar',
    'district',
    'district_ar',
    'city',
    'city_ar',
    'country',
    'postal_code',
    'is_main_branch',
    'is_active',
    'business_name',
    'business_name_ar',
    'vat_number',
    'cr_number',
    'logo_url',
    'website',
    'vat_mode',
    'invoice_prefix',
    'receipt_footer',
    'show_logo',
    'invoice_language',
    'zatca_phase',
    'branch_email'
  ]
);
SELECT pg_temp.phase3a_grant_columns(
  'branches',
  'UPDATE',
  'authenticated',
  ARRAY[
    'name',
    'name_ar',
    'branch_code',
    'phone',
    'email',
    'address',
    'address_ar',
    'building_number',
    'additional_number',
    'street',
    'street_ar',
    'district',
    'district_ar',
    'city',
    'city_ar',
    'country',
    'postal_code',
    'is_main_branch',
    'is_active',
    'business_name',
    'business_name_ar',
    'vat_number',
    'cr_number',
    'logo_url',
    'website',
    'vat_mode',
    'invoice_prefix',
    'receipt_footer',
    'show_logo',
    'invoice_language',
    'zatca_phase',
    'branch_email'
  ]
);

SELECT pg_temp.phase3a_exec_if_table('categories', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('products', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('customers', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('suppliers', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('employees', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employees TO authenticated');

SELECT pg_temp.phase3a_exec_if_table('invoice_items', 'GRANT SELECT ON TABLE public.invoice_items TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('payments', 'GRANT SELECT ON TABLE public.payments TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('payment_refunds', 'GRANT SELECT ON TABLE public.payment_refunds TO authenticated');

SELECT pg_temp.phase3a_exec_if_table('expense_categories', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_categories TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('expenses', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expenses TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('fixed_expenses', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fixed_expenses TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('inventory_items', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_items TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('purchases', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchases TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('purchase_items', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_items TO authenticated');
SELECT pg_temp.phase3a_exec_if_table('day_closings', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.day_closings TO authenticated');

-- user_profiles self-update is column-limited; tenant_id/branch_id/role/is_active
-- remain service-role/admin-function controlled.
SELECT pg_temp.phase3a_exec_if_table('user_profiles', 'GRANT SELECT ON TABLE public.user_profiles TO authenticated');
SELECT pg_temp.phase3a_grant_columns(
  'user_profiles',
  'UPDATE',
  'authenticated',
  ARRAY['full_name', 'full_name_ar', 'phone', 'avatar_url']
);

-- invoices: direct browser SELECT is column-limited. Raw signed XML, raw API
-- responses, and signatures are intentionally not granted.
SELECT pg_temp.phase3a_grant_columns(
  'invoices',
  'SELECT',
  'authenticated',
  ARRAY[
    'id',
    'tenant_id',
    'branch_id',
    'customer_id',
    'created_by',
    'invoice_number',
    'invoice_reference',
    'original_invoice_id',
    'credit_reason',
    'credit_note_idempotency_key',
    'checkout_idempotency_key',
    'zatca_uuid',
    'zatca_invoice_type',
    'zatca_type_code',
    'zatca_counter_number',
    'zatca_prev_invoice_hash',
    'zatca_xml_hash',
    'zatca_qr_code',
    'zatca_status',
    'zatca_submission_id',
    'zatca_submitted_at',
    'zatca_clearance_status',
    'zatca_warnings',
    'subtotal',
    'discount_amount',
    'taxable_amount',
    'tax_amount',
    'total_amount',
    'currency_code',
    'invoice_date',
    'supply_date',
    'due_date',
    'status',
    'payment_status',
    'payment_method',
    'session_id',
    'notes',
    'notes_ar',
    'cancelled_at',
    'cancellation_reason',
    'created_at',
    'updated_at'
  ]
);

-- The only direct browser invoice write left is legacy QR payload backfill.
SELECT pg_temp.phase3a_grant_columns(
  'invoices',
  'UPDATE',
  'authenticated',
  ARRAY['zatca_qr_code']
);

-- zatca_certificates: grant only non-secret metadata columns. Do not grant
-- csr, certificate, private_key_encrypted, otp, CSIDs, or secrets.
SELECT pg_temp.phase3a_grant_columns(
  'zatca_certificates',
  'SELECT',
  'authenticated',
  ARRAY[
    'id',
    'tenant_id',
    'branch_id',
    'status',
    'environment',
    'serial_number',
    'valid_from',
    'valid_to',
    'invoice_counter',
    'created_at',
    'updated_at',
    'activated_at'
  ]
);

-- ============================================================
-- Safe metadata replacement for legacy certificate reads
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_zatca_certificate_status()
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  branch_id UUID,
  status TEXT,
  environment TEXT,
  serial_number TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  invoice_counter BIGINT,
  certificate_exists BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.tenant_id,
    c.branch_id,
    c.status::text,
    c.environment::text,
    c.serial_number,
    c.valid_from,
    c.valid_to,
    NULLIF(to_jsonb(c) ->> 'activated_at', '')::timestamptz,
    c.invoice_counter,
    (
      NULLIF(to_jsonb(c) ->> 'certificate', '') IS NOT NULL
      OR NULLIF(to_jsonb(c) ->> 'compliance_csid', '') IS NOT NULL
      OR NULLIF(to_jsonb(c) ->> 'production_csid', '') IS NOT NULL
      OR c.status::text IN ('compliance', 'active')
    ),
    c.created_at,
    c.updated_at
  FROM public.zatca_certificates c
  WHERE public.rls_can_access_branch(c.tenant_id, c.branch_id)
  ORDER BY c.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_zatca_certificate_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_zatca_certificate_status() TO authenticated;

COMMENT ON FUNCTION public.list_zatca_certificate_status() IS
  'Safe browser-readable ZATCA certificate metadata. Does not expose CSR, certificates, private keys, OTPs, CSIDs, or secrets.';

-- ============================================================
-- Preserve RPC execution paths
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.pos_checkout(jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;
  END IF;

  IF to_regprocedure('public.create_full_credit_note(jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_full_credit_note(jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.create_full_credit_note(jsonb) TO authenticated;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm RLS is enabled on important public tables:
--
-- SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relkind = 'r'
--   AND c.relname IN (
--     'tenants',
--     'branches',
--     'user_profiles',
--     'products',
--     'categories',
--     'customers',
--     'suppliers',
--     'inventory_items',
--     'purchases',
--     'purchase_items',
--     'invoices',
--     'invoice_items',
--     'payments',
--     'payment_refunds',
--     'pos_stock_movements',
--     'sync_queue',
--     'zatca_certificates',
--     'zatca_production_credentials',
--     'zatca_production_debug_samples'
--   )
-- ORDER BY c.relname;
--
-- 2) Confirm browser roles have no table-level access to sensitive service-only tables:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'zatca_production_credentials',
--     'zatca_production_debug_samples',
--     'sync_queue',
--     'pos_stock_movements'
--   )
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: zero rows.
--
-- 3) Confirm sensitive invoice columns are not browser-granted:
--
-- SELECT table_name, column_name, grantee, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'invoices'
--   AND column_name IN (
--     'zatca_xml',
--     'zatca_signature',
--     'zatca_clearance_response',
--     'zatca_reporting_response'
--   )
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY column_name, grantee;
--
-- Expected: zero rows.
--
-- 4) Confirm sensitive ZATCA certificate columns are not browser-granted:
--
-- SELECT table_name, column_name, grantee, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'zatca_certificates'
--   AND column_name IN (
--     'csr',
--     'certificate',
--     'private_key_encrypted',
--     'otp',
--     'compliance_csid',
--     'compliance_secret',
--     'production_csid',
--     'production_secret',
--     'public_key_pem'
--   )
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY column_name, grantee;
--
-- Expected: zero rows.
--
-- 5) Confirm direct financial browser writes are blocked by grants:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('invoice_items', 'payments', 'payment_refunds')
--   AND grantee = 'authenticated'
--   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
-- ORDER BY table_name, privilege_type;
--
-- Expected: zero rows.
--
-- 6) Confirm invoices only expose QR backfill as a direct browser UPDATE:
--
-- SELECT table_name, column_name, grantee, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'invoices'
--   AND grantee = 'authenticated'
--   AND privilege_type = 'UPDATE'
-- ORDER BY column_name;
--
-- Expected: one row for zatca_qr_code.
--
-- 7) Confirm canonical Phase 3A policies exist:
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname LIKE 'phase3a_%'
-- ORDER BY tablename, policyname;
--
-- 8) Confirm no browser-readable policies exist on service-only ZATCA tables:
--
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('zatca_production_credentials', 'zatca_production_debug_samples')
--   AND roles && ARRAY['anon', 'authenticated']::name[];
--
-- Expected: zero rows.
--
-- 9) Confirm RPCs still exist and authenticated can execute:
--
-- SELECT
--   to_regprocedure('public.pos_checkout(jsonb)') IS NOT NULL AS pos_checkout_exists,
--   has_function_privilege('authenticated', 'public.pos_checkout(jsonb)', 'EXECUTE') AS authenticated_can_pos_checkout,
--   to_regprocedure('public.create_full_credit_note(jsonb)') IS NOT NULL AS create_full_credit_note_exists,
--   has_function_privilege('authenticated', 'public.create_full_credit_note(jsonb)', 'EXECUTE') AS authenticated_can_create_credit_note;
--
-- 10) Branch user cross-branch probe template.
--     Run while authenticated as a branch user. Replace UUIDs with a branch in
--     the same tenant that is NOT the caller's branch.
--
-- SELECT COUNT(*) AS other_branch_invoices_visible
-- FROM public.invoices
-- WHERE branch_id = '00000000-0000-0000-0000-000000000000'::uuid;
--
-- Expected for branch user: 0.
--
-- 11) Owner/admin cross-tenant probe template.
--     Run while authenticated as owner/admin. Replace UUID with another tenant.
--
-- SELECT COUNT(*) AS other_tenant_invoices_visible
-- FROM public.invoices
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;
--
-- Expected for owner/admin: 0.
--
-- 12) Safe replacement for legacy certificate status:
--
-- SELECT *
-- FROM public.list_zatca_certificate_status()
-- LIMIT 20;

-- ============================================================
-- Manual test checklist after applying SQL
-- ============================================================
--
-- Owner/admin:
--   - Login and profile loading.
--   - Admin dashboard metrics.
--   - Branch list/detail and branch settings save.
--   - Product/category/customer/supplier pages.
--   - Inventory and purchase create/list flows.
--   - Invoice list/detail/reprint.
--   - POS checkout via public.pos_checkout.
--   - Normal invoice submit via zatca-submit.
--   - Credit note create via public.create_full_credit_note.
--   - Credit note submit via zatca-submit.
--
-- Branch user:
--   - Login and branch dashboard.
--   - POS product/customer load.
--   - POS checkout cash/card, tender/change display.
--   - Invoice list/detail/reprint for own branch.
--   - Cannot read another branch's invoices/products/customers.
--
-- Super admin, if used:
--   - Dashboard/client/subscription views.
--   - Cannot accidentally expose ZATCA credential tables in browser.
--
-- Frontend compatibility note:
--   - src/pages/settings/ZatcaTab.tsx must use
--     public.list_zatca_certificate_status() for legacy certificate status and
--     must not perform browser INSERT/UPDATE on public.zatca_certificates.
--
-- Recommended next phase:
--   - Phase 3B storage policy lockdown for product-images, branch-assets,
--     expense-receipts, purchases-bills, and future invoice PDFs.
