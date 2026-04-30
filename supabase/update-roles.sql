-- ============================================================
-- Dafra — Role system migration
-- Renames 'manager' → 'branch', removes 'cashier' (merged into 'branch')
--
-- Run AFTER fix-all-rls.sql. Fully idempotent — safe to run multiple times.
-- ============================================================

-- ── Step 1: Add 'branch' to the enum (no-op if already present) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.user_role'::regtype
      AND enumlabel  = 'branch'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'branch';
  END IF;
END
$$;

-- ── Step 2: Migrate existing rows ────────────────────────────────────────────
UPDATE public.user_profiles
  SET role = 'branch'
  WHERE role IN ('manager', 'cashier');

-- ── Step 3: Drop deprecated enum values by recreating the type ───────────────
-- PostgreSQL has no DROP VALUE; we create a replacement type and swap it in.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.user_role'::regtype
      AND enumlabel  IN ('manager', 'cashier')
  ) THEN
    CREATE TYPE public.user_role_v2 AS ENUM ('super_admin', 'owner', 'branch', 'accountant');

    -- Remove any column DEFAULT referencing the old type before altering
    ALTER TABLE public.user_profiles
      ALTER COLUMN role DROP DEFAULT;

    -- Swap the column to the new type
    ALTER TABLE public.user_profiles
      ALTER COLUMN role TYPE public.user_role_v2
      USING role::text::public.user_role_v2;

    DROP TYPE public.user_role;
    ALTER TYPE public.user_role_v2 RENAME TO user_role;
  END IF;
END
$$;

-- ── Step 4: Update RLS policies that referenced 'manager' or 'cashier' ───────
-- Drop old policies (from fix-all-rls.sql) and recreate with 'branch'.

-- ── branches: add read policy for branch users (their own branch) ─────────────
DROP POLICY IF EXISTS "branches_branch_self_select" ON branches;
CREATE POLICY "branches_branch_self_select" ON branches
    FOR SELECT USING (
        id = get_my_branch_id() AND get_my_role() = 'branch'
    );

-- ── categories ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "categories_owner_mgr_insert"    ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_update"    ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_delete"    ON categories;

CREATE POLICY "categories_owner_mgr_insert" ON categories
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "categories_owner_mgr_update" ON categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "categories_owner_mgr_delete" ON categories
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── products ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "products_owner_mgr_insert"      ON products;
DROP POLICY IF EXISTS "products_owner_mgr_update"      ON products;
DROP POLICY IF EXISTS "products_owner_mgr_delete"      ON products;

CREATE POLICY "products_owner_mgr_insert" ON products
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "products_owner_mgr_update" ON products
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "products_owner_mgr_delete" ON products
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── customers ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_insert"               ON customers;
DROP POLICY IF EXISTS "customers_update"               ON customers;
DROP POLICY IF EXISTS "customers_delete"               ON customers;

CREATE POLICY "customers_insert" ON customers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "customers_update" ON customers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "customers_delete" ON customers
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── employees: 'manager' → 'branch' ──────────────────────────────────────────
DROP POLICY IF EXISTS "employees_manager_insert"       ON employees;
DROP POLICY IF EXISTS "employees_manager_update"       ON employees;
DROP POLICY IF EXISTS "employees_manager_delete"       ON employees;

CREATE POLICY "employees_manager_insert" ON employees FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));
CREATE POLICY "employees_manager_update" ON employees FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));
CREATE POLICY "employees_manager_delete" ON employees FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));

-- ── invoices: merge manager + cashier → branch ────────────────────────────────
DROP POLICY IF EXISTS "invoices_manager_select"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_insert"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_update"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_delete"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_select"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_insert"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_update"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_delete"        ON invoices;
DROP POLICY IF EXISTS "invoices_branch_select"         ON invoices;
DROP POLICY IF EXISTS "invoices_branch_insert"         ON invoices;
DROP POLICY IF EXISTS "invoices_branch_update"         ON invoices;
DROP POLICY IF EXISTS "invoices_branch_delete"         ON invoices;

CREATE POLICY "invoices_branch_select" ON invoices
    FOR SELECT USING (
        tenant_id  = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_branch_insert" ON invoices
    FOR INSERT WITH CHECK (
        tenant_id  = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_branch_update" ON invoices
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());
CREATE POLICY "invoices_branch_delete" ON invoices
    FOR DELETE USING (
        tenant_id  = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ── invoice_items ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "invoice_items_tenant_insert"    ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_update"    ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_delete"    ON invoice_items;

CREATE POLICY "invoice_items_tenant_insert" ON invoice_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "invoice_items_tenant_update" ON invoice_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "invoice_items_tenant_delete" ON invoice_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── payments: manager + cashier → branch ──────────────────────────────────────
DROP POLICY IF EXISTS "payments_manager_cashier_select" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_insert" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_update" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_delete" ON payments;
DROP POLICY IF EXISTS "payments_branch_select"          ON payments;
DROP POLICY IF EXISTS "payments_branch_insert"          ON payments;
DROP POLICY IF EXISTS "payments_branch_update"          ON payments;
DROP POLICY IF EXISTS "payments_branch_delete"          ON payments;

CREATE POLICY "payments_branch_select" ON payments
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_branch_insert" ON payments
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_branch_update" ON payments
    FOR UPDATE
    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    )
    WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_branch_delete" ON payments
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );

-- ── sync_queue ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sync_queue_tenant_select"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_insert"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_update"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_delete"       ON sync_queue;

CREATE POLICY "sync_queue_tenant_select" ON sync_queue
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "sync_queue_tenant_insert" ON sync_queue
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "sync_queue_tenant_update" ON sync_queue
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "sync_queue_tenant_delete" ON sync_queue
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── expense_categories ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "expense_categories_update"      ON public.expense_categories;

CREATE POLICY "expense_categories_update" ON public.expense_categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch') AND is_system = FALSE)
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch') AND is_system = FALSE);

-- ── expenses: staff (manager+cashier) → branch ────────────────────────────────
DROP POLICY IF EXISTS "expenses_staff_insert"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_update"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_delete"          ON public.expenses;

CREATE POLICY "expenses_staff_insert" ON public.expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() = 'branch'
    );
CREATE POLICY "expenses_staff_update" ON public.expenses
    FOR UPDATE
    USING (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() = 'branch'
    )
    WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() = 'branch'
    );
CREATE POLICY "expenses_staff_delete" ON public.expenses
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() = 'branch'
    );

-- ── fixed_expenses ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "fixed_expenses_insert"          ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_update"          ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_delete"          ON public.fixed_expenses;

CREATE POLICY "fixed_expenses_insert" ON public.fixed_expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "fixed_expenses_update" ON public.fixed_expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "fixed_expenses_delete" ON public.fixed_expenses
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── suppliers ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "suppliers_insert"               ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_update"               ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_delete"               ON public.suppliers;

CREATE POLICY "suppliers_insert" ON public.suppliers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "suppliers_update" ON public.suppliers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "suppliers_delete" ON public.suppliers
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── inventory_items ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_insert"         ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_update"         ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_delete"         ON public.inventory_items;

CREATE POLICY "inventory_items_insert" ON public.inventory_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "inventory_items_update" ON public.inventory_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "inventory_items_delete" ON public.inventory_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── purchases ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "purchases_insert"               ON public.purchases;
DROP POLICY IF EXISTS "purchases_update"               ON public.purchases;
DROP POLICY IF EXISTS "purchases_delete"               ON public.purchases;

CREATE POLICY "purchases_insert" ON public.purchases
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "purchases_update" ON public.purchases
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
CREATE POLICY "purchases_delete" ON public.purchases
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

-- ── purchase_items ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "purchase_items_insert"          ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_update"          ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_delete"          ON public.purchase_items;

CREATE POLICY "purchase_items_insert" ON public.purchase_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'branch')
        )
    );
CREATE POLICY "purchase_items_update" ON public.purchase_items
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'branch')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'branch')
        )
    );
CREATE POLICY "purchase_items_delete" ON public.purchase_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'branch')
        )
    );

-- ── day_closings: 'manager' → 'branch' ───────────────────────────────────────
DROP POLICY IF EXISTS "day_closings_manager_insert"    ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_update"    ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_delete"    ON day_closings;

CREATE POLICY "day_closings_manager_insert" ON day_closings FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));
CREATE POLICY "day_closings_manager_update" ON day_closings FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));
CREATE POLICY "day_closings_manager_delete" ON day_closings FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch'));
