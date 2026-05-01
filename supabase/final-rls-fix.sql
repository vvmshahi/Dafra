-- ==============================================================
-- Dafra — FINAL RLS fix (v3)
-- Roles: super_admin, owner, branch  (manager/cashier/accountant removed)
-- Fully idempotent — safe to run multiple times.
-- ==============================================================

-- RLS must be enabled on every table
ALTER TABLE IF EXISTS subscription_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zatca_certificates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_queue            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expense_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fixed_expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS day_closings          ENABLE ROW LEVEL SECURITY;

-- Base grants (RLS further restricts row visibility)
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ==============================================================
-- subscription_plans
-- ==============================================================
DROP POLICY IF EXISTS "plans_read_active"              ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin"               ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_select"        ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_insert"        ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_update"        ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_delete"        ON subscription_plans;

-- All authenticated users can read active plans (subscription tab, upgrade display)
CREATE POLICY "plans_read_active" ON subscription_plans
    FOR SELECT USING (is_active = TRUE OR is_super_admin());

CREATE POLICY "plans_super_admin_insert" ON subscription_plans
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "plans_super_admin_update" ON subscription_plans
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "plans_super_admin_delete" ON subscription_plans
    FOR DELETE USING (is_super_admin());

-- ==============================================================
-- tenants
-- ==============================================================
DROP POLICY IF EXISTS "tenants_super_admin"             ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_select"      ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_insert"      ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_update"      ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_delete"      ON tenants;
DROP POLICY IF EXISTS "tenants_own_read"                ON tenants;
DROP POLICY IF EXISTS "tenants_owner_update"            ON tenants;

-- All in tenant can read (needed for receipt headers, branch login display)
CREATE POLICY "tenants_own_read" ON tenants
    FOR SELECT USING (id = get_my_tenant_id());

-- Super admin can also read all tenants
CREATE POLICY "tenants_super_admin_select" ON tenants
    FOR SELECT USING (is_super_admin());

-- Owner can update their own tenant
CREATE POLICY "tenants_owner_update" ON tenants
    FOR UPDATE
    USING      (id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "tenants_super_admin_insert" ON tenants
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "tenants_super_admin_update" ON tenants
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenants_super_admin_delete" ON tenants
    FOR DELETE USING (is_super_admin());

-- ==============================================================
-- tenant_subscriptions
-- ==============================================================
DROP POLICY IF EXISTS "tenant_subs_super_admin"         ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_select"  ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_insert"  ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_update"  ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_delete"  ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_read"                ON tenant_subscriptions;

-- Owner + branch can read their tenant's subscription
CREATE POLICY "tenant_subs_read" ON tenant_subscriptions
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );

CREATE POLICY "tenant_subs_super_admin_select" ON tenant_subscriptions
    FOR SELECT USING (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_insert" ON tenant_subscriptions
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_update" ON tenant_subscriptions
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_delete" ON tenant_subscriptions
    FOR DELETE USING (is_super_admin());

-- ==============================================================
-- branches
-- ==============================================================
DROP POLICY IF EXISTS "branches_super_admin"            ON branches;
DROP POLICY IF EXISTS "branches_super_admin_select"     ON branches;
DROP POLICY IF EXISTS "branches_super_admin_insert"     ON branches;
DROP POLICY IF EXISTS "branches_super_admin_update"     ON branches;
DROP POLICY IF EXISTS "branches_super_admin_delete"     ON branches;
DROP POLICY IF EXISTS "branches_owner_all"              ON branches;
DROP POLICY IF EXISTS "branches_owner_select"           ON branches;
DROP POLICY IF EXISTS "branches_owner_insert"           ON branches;
DROP POLICY IF EXISTS "branches_owner_update"           ON branches;
DROP POLICY IF EXISTS "branches_owner_delete"           ON branches;
DROP POLICY IF EXISTS "branches_staff_read"             ON branches;
DROP POLICY IF EXISTS "branches_branch_select"          ON branches;

CREATE POLICY "branches_super_admin_select" ON branches
    FOR SELECT USING (is_super_admin());
CREATE POLICY "branches_super_admin_insert" ON branches
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "branches_super_admin_update" ON branches
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "branches_super_admin_delete" ON branches
    FOR DELETE USING (is_super_admin());

CREATE POLICY "branches_owner_select" ON branches
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "branches_owner_insert" ON branches
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "branches_owner_update" ON branches
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "branches_owner_delete" ON branches
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch user can read only their own branch
CREATE POLICY "branches_branch_select" ON branches
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND id = get_my_branch_id()
    );

-- ==============================================================
-- user_profiles
-- IMPORTANT: No INSERT policy — inserts are done by service-role trigger only.
-- IMPORTANT: No FOR ALL policies — helpers in FOR ALL cause recursion on INSERT.
-- ==============================================================
DROP POLICY IF EXISTS "user_profiles_own_read"          ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_own_update"        ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_super_admin_read"  ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_owner_read"        ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_manager_read"      ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_branch_read"       ON user_profiles;

CREATE POLICY "user_profiles_own_read" ON user_profiles
    FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "user_profiles_own_update" ON user_profiles
    FOR UPDATE TO authenticated
    USING      (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY "user_profiles_super_admin_read" ON user_profiles
    FOR SELECT TO authenticated USING (is_super_admin());

CREATE POLICY "user_profiles_owner_read" ON user_profiles
    FOR SELECT TO authenticated
    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "user_profiles_branch_read" ON user_profiles
    FOR SELECT TO authenticated
    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ==============================================================
-- zatca_certificates
-- ==============================================================
DROP POLICY IF EXISTS "zatca_certs_super_admin"         ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_select"  ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_insert"  ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_update"  ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_delete"  ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_all"           ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_select"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_insert"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_update"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_delete"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_manager_read"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_branch_select"       ON zatca_certificates;

CREATE POLICY "zatca_certs_super_admin_select" ON zatca_certificates
    FOR SELECT USING (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_insert" ON zatca_certificates
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_update" ON zatca_certificates
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_delete" ON zatca_certificates
    FOR DELETE USING (is_super_admin());

CREATE POLICY "zatca_certs_owner_select" ON zatca_certificates
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "zatca_certs_owner_insert" ON zatca_certificates
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "zatca_certs_owner_update" ON zatca_certificates
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "zatca_certs_owner_delete" ON zatca_certificates
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch can read their branch cert (for future Phase 2 ZATCA signing)
CREATE POLICY "zatca_certs_branch_select" ON zatca_certificates
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ==============================================================
-- categories
-- ==============================================================
DROP POLICY IF EXISTS "categories_super_admin"          ON categories;
DROP POLICY IF EXISTS "categories_super_admin_select"   ON categories;
DROP POLICY IF EXISTS "categories_super_admin_insert"   ON categories;
DROP POLICY IF EXISTS "categories_super_admin_update"   ON categories;
DROP POLICY IF EXISTS "categories_super_admin_delete"   ON categories;
DROP POLICY IF EXISTS "categories_tenant_read"          ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_write"      ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_insert"     ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_update"     ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_delete"     ON categories;
DROP POLICY IF EXISTS "categories_owner_insert"         ON categories;
DROP POLICY IF EXISTS "categories_owner_update"         ON categories;
DROP POLICY IF EXISTS "categories_owner_delete"         ON categories;

-- All in tenant read (branch POS loads categories)
CREATE POLICY "categories_tenant_read" ON categories
    FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "categories_super_admin_select" ON categories
    FOR SELECT USING (is_super_admin());
CREATE POLICY "categories_super_admin_insert" ON categories
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "categories_super_admin_update" ON categories
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "categories_super_admin_delete" ON categories
    FOR DELETE USING (is_super_admin());

CREATE POLICY "categories_owner_insert" ON categories
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "categories_owner_update" ON categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "categories_owner_delete" ON categories
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ==============================================================
-- products
-- ==============================================================
DROP POLICY IF EXISTS "products_super_admin"            ON products;
DROP POLICY IF EXISTS "products_super_admin_select"     ON products;
DROP POLICY IF EXISTS "products_super_admin_insert"     ON products;
DROP POLICY IF EXISTS "products_super_admin_update"     ON products;
DROP POLICY IF EXISTS "products_super_admin_delete"     ON products;
DROP POLICY IF EXISTS "products_tenant_read"            ON products;
DROP POLICY IF EXISTS "products_owner_mgr_write"        ON products;
DROP POLICY IF EXISTS "products_owner_mgr_insert"       ON products;
DROP POLICY IF EXISTS "products_owner_mgr_update"       ON products;
DROP POLICY IF EXISTS "products_owner_mgr_delete"       ON products;
DROP POLICY IF EXISTS "products_owner_insert"           ON products;
DROP POLICY IF EXISTS "products_owner_update"           ON products;
DROP POLICY IF EXISTS "products_owner_delete"           ON products;
DROP POLICY IF EXISTS "products_branch_update"          ON products;

-- All in tenant read (branch POS loads product catalog)
CREATE POLICY "products_tenant_read" ON products
    FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Branch can update products (stock quantity after sale)
CREATE POLICY "products_branch_update" ON products
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch');

CREATE POLICY "products_super_admin_select" ON products
    FOR SELECT USING (is_super_admin());
CREATE POLICY "products_super_admin_insert" ON products
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "products_super_admin_update" ON products
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "products_super_admin_delete" ON products
    FOR DELETE USING (is_super_admin());

CREATE POLICY "products_owner_insert" ON products
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "products_owner_update" ON products
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "products_owner_delete" ON products
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ==============================================================
-- customers
-- ==============================================================
DROP POLICY IF EXISTS "customers_super_admin"           ON customers;
DROP POLICY IF EXISTS "customers_super_admin_select"    ON customers;
DROP POLICY IF EXISTS "customers_super_admin_insert"    ON customers;
DROP POLICY IF EXISTS "customers_super_admin_update"    ON customers;
DROP POLICY IF EXISTS "customers_super_admin_delete"    ON customers;
DROP POLICY IF EXISTS "customers_tenant_read"           ON customers;
DROP POLICY IF EXISTS "customers_write"                 ON customers;
DROP POLICY IF EXISTS "customers_insert"                ON customers;
DROP POLICY IF EXISTS "customers_update"                ON customers;
DROP POLICY IF EXISTS "customers_delete"                ON customers;

-- All in tenant read (POS and reports)
CREATE POLICY "customers_tenant_read" ON customers
    FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Owner + branch can create/update customers (POS walk-in registration)
CREATE POLICY "customers_insert" ON customers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'branch')
    );
CREATE POLICY "customers_update" ON customers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'branch'));
-- Only owner can delete customers
CREATE POLICY "customers_delete" ON customers
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "customers_super_admin_select" ON customers
    FOR SELECT USING (is_super_admin());
CREATE POLICY "customers_super_admin_insert" ON customers
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "customers_super_admin_update" ON customers
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "customers_super_admin_delete" ON customers
    FOR DELETE USING (is_super_admin());

-- ==============================================================
-- employees  (managed by owner only; branch gets read for display)
-- Uses subqueries instead of helper functions to avoid potential
-- recursion on the user_profiles table.
-- ==============================================================
DROP POLICY IF EXISTS "employees_super_admin"           ON employees;
DROP POLICY IF EXISTS "employees_super_admin_select"    ON employees;
DROP POLICY IF EXISTS "employees_super_admin_insert"    ON employees;
DROP POLICY IF EXISTS "employees_super_admin_update"    ON employees;
DROP POLICY IF EXISTS "employees_super_admin_delete"    ON employees;
DROP POLICY IF EXISTS "employees_owner_all"             ON employees;
DROP POLICY IF EXISTS "employees_owner_select"          ON employees;
DROP POLICY IF EXISTS "employees_owner_insert"          ON employees;
DROP POLICY IF EXISTS "employees_owner_update"          ON employees;
DROP POLICY IF EXISTS "employees_owner_delete"          ON employees;
DROP POLICY IF EXISTS "employees_manager_branch"        ON employees;
DROP POLICY IF EXISTS "employees_manager_insert"        ON employees;
DROP POLICY IF EXISTS "employees_manager_update"        ON employees;
DROP POLICY IF EXISTS "employees_manager_delete"        ON employees;
DROP POLICY IF EXISTS "employees_staff_read"            ON employees;
DROP POLICY IF EXISTS "employees_branch_select"         ON employees;

CREATE POLICY "employees_super_admin_select" ON employees FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_insert" ON employees FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_update" ON employees FOR UPDATE
    USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_delete" ON employees FOR DELETE
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "employees_owner_select" ON employees FOR SELECT
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_insert" ON employees FOR INSERT
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_update" ON employees FOR UPDATE
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_delete" ON employees FOR DELETE
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Branch: read employees in their own branch
CREATE POLICY "employees_branch_select" ON employees FOR SELECT
    USING (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    );

-- ==============================================================
-- invoices
-- ==============================================================
DROP POLICY IF EXISTS "invoices_super_admin"            ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_select"     ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_insert"     ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_update"     ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_delete"     ON invoices;
DROP POLICY IF EXISTS "invoices_owner_all"              ON invoices;
DROP POLICY IF EXISTS "invoices_owner_select"           ON invoices;
DROP POLICY IF EXISTS "invoices_owner_insert"           ON invoices;
DROP POLICY IF EXISTS "invoices_owner_update"           ON invoices;
DROP POLICY IF EXISTS "invoices_owner_delete"           ON invoices;
DROP POLICY IF EXISTS "invoices_manager_branch"         ON invoices;
DROP POLICY IF EXISTS "invoices_manager_select"         ON invoices;
DROP POLICY IF EXISTS "invoices_manager_insert"         ON invoices;
DROP POLICY IF EXISTS "invoices_manager_update"         ON invoices;
DROP POLICY IF EXISTS "invoices_manager_delete"         ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_branch"         ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_select"         ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_insert"         ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_update"         ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_delete"         ON invoices;
DROP POLICY IF EXISTS "invoices_accountant_read"        ON invoices;
DROP POLICY IF EXISTS "invoices_branch_select"          ON invoices;
DROP POLICY IF EXISTS "invoices_branch_insert"          ON invoices;
DROP POLICY IF EXISTS "invoices_branch_update"          ON invoices;

CREATE POLICY "invoices_super_admin_select" ON invoices
    FOR SELECT USING (is_super_admin());
CREATE POLICY "invoices_super_admin_insert" ON invoices
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "invoices_super_admin_update" ON invoices
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "invoices_super_admin_delete" ON invoices
    FOR DELETE USING (is_super_admin());

-- Owner: all invoices in tenant
CREATE POLICY "invoices_owner_select" ON invoices
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoices_owner_insert" ON invoices
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoices_owner_update" ON invoices
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoices_owner_delete" ON invoices
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: their branch only (POS creates invoices)
CREATE POLICY "invoices_branch_select" ON invoices
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_branch_insert" ON invoices
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_branch_update" ON invoices
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());

-- ==============================================================
-- invoice_items
-- ==============================================================
DROP POLICY IF EXISTS "invoice_items_super_admin"         ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_select"  ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_insert"  ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_update"  ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_delete"  ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant"              ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_select"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_insert"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_update"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_delete"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_select"        ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_insert"        ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_update"        ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_delete"        ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_select"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_insert"       ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_update"       ON invoice_items;

CREATE POLICY "invoice_items_super_admin_select" ON invoice_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "invoice_items_super_admin_insert" ON invoice_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "invoice_items_super_admin_update" ON invoice_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "invoice_items_super_admin_delete" ON invoice_items
    FOR DELETE USING (is_super_admin());

-- Owner: all items in tenant
CREATE POLICY "invoice_items_owner_select" ON invoice_items
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoice_items_owner_insert" ON invoice_items
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoice_items_owner_update" ON invoice_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "invoice_items_owner_delete" ON invoice_items
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: items belonging to their branch's invoices
CREATE POLICY "invoice_items_branch_select" ON invoice_items
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = invoice_items.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "invoice_items_branch_insert" ON invoice_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = invoice_items.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "invoice_items_branch_update" ON invoice_items
    FOR UPDATE
    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = invoice_items.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    )
    WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = invoice_items.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );

-- ==============================================================
-- payments
-- ==============================================================
DROP POLICY IF EXISTS "payments_super_admin"             ON payments;
DROP POLICY IF EXISTS "payments_super_admin_select"      ON payments;
DROP POLICY IF EXISTS "payments_super_admin_insert"      ON payments;
DROP POLICY IF EXISTS "payments_super_admin_update"      ON payments;
DROP POLICY IF EXISTS "payments_super_admin_delete"      ON payments;
DROP POLICY IF EXISTS "payments_owner_all"               ON payments;
DROP POLICY IF EXISTS "payments_owner_select"            ON payments;
DROP POLICY IF EXISTS "payments_owner_insert"            ON payments;
DROP POLICY IF EXISTS "payments_owner_update"            ON payments;
DROP POLICY IF EXISTS "payments_owner_delete"            ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier"         ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_select"  ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_insert"  ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_update"  ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_delete"  ON payments;
DROP POLICY IF EXISTS "payments_accountant_read"         ON payments;
DROP POLICY IF EXISTS "payments_branch_select"           ON payments;
DROP POLICY IF EXISTS "payments_branch_insert"           ON payments;

CREATE POLICY "payments_super_admin_select" ON payments
    FOR SELECT USING (is_super_admin());
CREATE POLICY "payments_super_admin_insert" ON payments
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "payments_super_admin_update" ON payments
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "payments_super_admin_delete" ON payments
    FOR DELETE USING (is_super_admin());

CREATE POLICY "payments_owner_select" ON payments
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "payments_owner_insert" ON payments
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "payments_owner_update" ON payments
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "payments_owner_delete" ON payments
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: payments for their branch's invoices (POS checkout)
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

-- ==============================================================
-- sync_queue  (ZATCA queue — owner managed only)
-- ==============================================================
DROP POLICY IF EXISTS "sync_queue_super_admin"          ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_select"   ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_insert"   ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_update"   ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_delete"   ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant"               ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_select"        ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_insert"        ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_update"        ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_delete"        ON sync_queue;

CREATE POLICY "sync_queue_super_admin_select" ON sync_queue
    FOR SELECT USING (is_super_admin());
CREATE POLICY "sync_queue_super_admin_insert" ON sync_queue
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "sync_queue_super_admin_update" ON sync_queue
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "sync_queue_super_admin_delete" ON sync_queue
    FOR DELETE USING (is_super_admin());

CREATE POLICY "sync_queue_tenant_select" ON sync_queue
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "sync_queue_tenant_insert" ON sync_queue
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "sync_queue_tenant_update" ON sync_queue
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "sync_queue_tenant_delete" ON sync_queue
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ==============================================================
-- expense_categories
-- ==============================================================
DROP POLICY IF EXISTS "expense_categories_super_admin"         ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_select"  ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_insert"  ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_update"  ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_delete"  ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_read"                ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_tenant_read"         ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_insert"              ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_update"              ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_delete"              ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_owner_insert"        ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_owner_update"        ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_owner_delete"        ON expense_categories;

CREATE POLICY "expense_categories_super_admin_select" ON expense_categories
    FOR SELECT USING (is_super_admin());
CREATE POLICY "expense_categories_super_admin_insert" ON expense_categories
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "expense_categories_super_admin_update" ON expense_categories
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "expense_categories_super_admin_delete" ON expense_categories
    FOR DELETE USING (is_super_admin());

-- All in tenant read (branch picks categories when logging expenses)
CREATE POLICY "expense_categories_tenant_read" ON expense_categories
    FOR SELECT USING (
        is_system = TRUE
        OR tenant_id = get_my_tenant_id()
    );

-- Owner full write (non-system categories only)
CREATE POLICY "expense_categories_owner_insert" ON expense_categories
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'owner'
        AND is_system = FALSE
    );
CREATE POLICY "expense_categories_owner_update" ON expense_categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner' AND is_system = FALSE)
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner' AND is_system = FALSE);
CREATE POLICY "expense_categories_owner_delete" ON expense_categories
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'owner'
        AND is_system = FALSE
    );

-- ==============================================================
-- expenses
-- ==============================================================
DROP POLICY IF EXISTS "expenses_super_admin"            ON expenses;
DROP POLICY IF EXISTS "expenses_super_admin_select"     ON expenses;
DROP POLICY IF EXISTS "expenses_super_admin_insert"     ON expenses;
DROP POLICY IF EXISTS "expenses_super_admin_update"     ON expenses;
DROP POLICY IF EXISTS "expenses_super_admin_delete"     ON expenses;
DROP POLICY IF EXISTS "expenses_tenant_read"            ON expenses;
DROP POLICY IF EXISTS "expenses_owner_select"           ON expenses;
DROP POLICY IF EXISTS "expenses_owner_write"            ON expenses;
DROP POLICY IF EXISTS "expenses_owner_insert"           ON expenses;
DROP POLICY IF EXISTS "expenses_owner_update"           ON expenses;
DROP POLICY IF EXISTS "expenses_owner_delete"           ON expenses;
DROP POLICY IF EXISTS "expenses_staff_write"            ON expenses;
DROP POLICY IF EXISTS "expenses_staff_insert"           ON expenses;
DROP POLICY IF EXISTS "expenses_staff_update"           ON expenses;
DROP POLICY IF EXISTS "expenses_staff_delete"           ON expenses;
DROP POLICY IF EXISTS "expenses_branch_select"          ON expenses;
DROP POLICY IF EXISTS "expenses_branch_insert"          ON expenses;
DROP POLICY IF EXISTS "expenses_branch_update"          ON expenses;
DROP POLICY IF EXISTS "expenses_branch_delete"          ON expenses;

CREATE POLICY "expenses_super_admin_select" ON expenses
    FOR SELECT USING (is_super_admin());
CREATE POLICY "expenses_super_admin_insert" ON expenses
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "expenses_super_admin_update" ON expenses
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "expenses_super_admin_delete" ON expenses
    FOR DELETE USING (is_super_admin());

-- Owner: all expenses in tenant
CREATE POLICY "expenses_owner_select" ON expenses
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "expenses_owner_insert" ON expenses
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "expenses_owner_update" ON expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "expenses_owner_delete" ON expenses
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: their branch expenses
CREATE POLICY "expenses_branch_select" ON expenses
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "expenses_branch_insert" ON expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "expenses_branch_update" ON expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());
CREATE POLICY "expenses_branch_delete" ON expenses
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ==============================================================
-- fixed_expenses  (owner managed; branch read-only)
-- ==============================================================
DROP POLICY IF EXISTS "fixed_expenses_super_admin"         ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_select"  ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_insert"  ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_update"  ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_delete"  ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_read"                ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_tenant_read"         ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_write"               ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_insert"              ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_update"              ON fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_delete"              ON fixed_expenses;

CREATE POLICY "fixed_expenses_super_admin_select" ON fixed_expenses
    FOR SELECT USING (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_insert" ON fixed_expenses
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_update" ON fixed_expenses
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_delete" ON fixed_expenses
    FOR DELETE USING (is_super_admin());

-- All in tenant read
CREATE POLICY "fixed_expenses_tenant_read" ON fixed_expenses
    FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Owner full write
CREATE POLICY "fixed_expenses_insert" ON fixed_expenses
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "fixed_expenses_update" ON fixed_expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "fixed_expenses_delete" ON fixed_expenses
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ==============================================================
-- suppliers  (owner managed; all in tenant read)
-- ==============================================================
DROP POLICY IF EXISTS "suppliers_super_admin"           ON suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_select"    ON suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_insert"    ON suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_update"    ON suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_delete"    ON suppliers;
DROP POLICY IF EXISTS "suppliers_tenant_read"           ON suppliers;
DROP POLICY IF EXISTS "suppliers_write"                 ON suppliers;
DROP POLICY IF EXISTS "suppliers_insert"                ON suppliers;
DROP POLICY IF EXISTS "suppliers_update"                ON suppliers;
DROP POLICY IF EXISTS "suppliers_delete"                ON suppliers;

CREATE POLICY "suppliers_super_admin_select" ON suppliers
    FOR SELECT USING (is_super_admin());
CREATE POLICY "suppliers_super_admin_insert" ON suppliers
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "suppliers_super_admin_update" ON suppliers
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "suppliers_super_admin_delete" ON suppliers
    FOR DELETE USING (is_super_admin());

-- All in tenant read (branch selects supplier when creating a purchase)
CREATE POLICY "suppliers_tenant_read" ON suppliers
    FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Owner full write
CREATE POLICY "suppliers_insert" ON suppliers
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "suppliers_update" ON suppliers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "suppliers_delete" ON suppliers
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ==============================================================
-- inventory_items
-- ==============================================================
DROP POLICY IF EXISTS "inventory_items_super_admin"         ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_select"  ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_insert"  ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_update"  ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_delete"  ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_tenant_read"         ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_write"               ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_insert"              ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_update"              ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_delete"              ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_branch_insert"       ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_branch_update"       ON inventory_items;

CREATE POLICY "inventory_items_super_admin_select" ON inventory_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "inventory_items_super_admin_insert" ON inventory_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "inventory_items_super_admin_update" ON inventory_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "inventory_items_super_admin_delete" ON inventory_items
    FOR DELETE USING (is_super_admin());

-- All in tenant read
CREATE POLICY "inventory_items_tenant_read" ON inventory_items
    FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Owner full write
CREATE POLICY "inventory_items_insert" ON inventory_items
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "inventory_items_update" ON inventory_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "inventory_items_delete" ON inventory_items
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: INSERT+UPDATE their branch inventory (receive stock)
CREATE POLICY "inventory_items_branch_insert" ON inventory_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "inventory_items_branch_update" ON inventory_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());

-- ==============================================================
-- purchases
-- ==============================================================
DROP POLICY IF EXISTS "purchases_super_admin"           ON purchases;
DROP POLICY IF EXISTS "purchases_super_admin_select"    ON purchases;
DROP POLICY IF EXISTS "purchases_super_admin_insert"    ON purchases;
DROP POLICY IF EXISTS "purchases_super_admin_update"    ON purchases;
DROP POLICY IF EXISTS "purchases_super_admin_delete"    ON purchases;
DROP POLICY IF EXISTS "purchases_owner_select"          ON purchases;
DROP POLICY IF EXISTS "purchases_write"                 ON purchases;
DROP POLICY IF EXISTS "purchases_insert"                ON purchases;
DROP POLICY IF EXISTS "purchases_update"                ON purchases;
DROP POLICY IF EXISTS "purchases_delete"                ON purchases;
DROP POLICY IF EXISTS "purchases_branch_select"         ON purchases;
DROP POLICY IF EXISTS "purchases_branch_insert"         ON purchases;
DROP POLICY IF EXISTS "purchases_branch_update"         ON purchases;

CREATE POLICY "purchases_super_admin_select" ON purchases
    FOR SELECT USING (is_super_admin());
CREATE POLICY "purchases_super_admin_insert" ON purchases
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "purchases_super_admin_update" ON purchases
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "purchases_super_admin_delete" ON purchases
    FOR DELETE USING (is_super_admin());

-- Owner: all purchases in tenant
CREATE POLICY "purchases_owner_select" ON purchases
    FOR SELECT USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "purchases_insert" ON purchases
    FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "purchases_update" ON purchases
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "purchases_delete" ON purchases
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Branch: their branch purchases (receiving inventory)
CREATE POLICY "purchases_branch_select" ON purchases
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "purchases_branch_insert" ON purchases
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "purchases_branch_update" ON purchases
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());

-- ==============================================================
-- purchase_items
-- ==============================================================
DROP POLICY IF EXISTS "purchase_items_super_admin"         ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_select"  ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_insert"  ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_update"  ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_delete"  ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_select"              ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_write"               ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_insert"              ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_update"              ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_delete"              ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_branch_insert"       ON purchase_items;

CREATE POLICY "purchase_items_super_admin_select" ON purchase_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "purchase_items_super_admin_insert" ON purchase_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "purchase_items_super_admin_update" ON purchase_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "purchase_items_super_admin_delete" ON purchase_items
    FOR DELETE USING (is_super_admin());

-- All in tenant read (via parent purchase)
CREATE POLICY "purchase_items_select" ON purchase_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
        )
    );

-- Owner write
CREATE POLICY "purchase_items_insert" ON purchase_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() = 'owner'
        )
    );
CREATE POLICY "purchase_items_update" ON purchase_items
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() = 'owner'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() = 'owner'
        )
    );
CREATE POLICY "purchase_items_delete" ON purchase_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() = 'owner'
        )
    );

-- Branch: write items for their branch's purchases
CREATE POLICY "purchase_items_branch_insert" ON purchase_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND p.branch_id = get_my_branch_id()
              AND get_my_role() = 'branch'
        )
    );

-- ==============================================================
-- day_closings
-- Uses subqueries to avoid helper function recursion.
-- ==============================================================
DROP POLICY IF EXISTS "day_closings_super_admin"         ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_select"  ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_insert"  ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_update"  ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_delete"  ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_all"           ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_select"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_insert"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_update"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_delete"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_all"         ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_insert"      ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_update"      ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_delete"      ON day_closings;
DROP POLICY IF EXISTS "day_closings_staff_read"          ON day_closings;
DROP POLICY IF EXISTS "day_closings_branch_select"       ON day_closings;
DROP POLICY IF EXISTS "day_closings_branch_insert"       ON day_closings;

CREATE POLICY "day_closings_super_admin_select" ON day_closings FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_insert" ON day_closings FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_update" ON day_closings FOR UPDATE
    USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_delete" ON day_closings FOR DELETE
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "day_closings_owner_select" ON day_closings FOR SELECT
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_insert" ON day_closings FOR INSERT
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_update" ON day_closings FOR UPDATE
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_delete" ON day_closings FOR DELETE
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Branch: their branch's day closings (submit end-of-day)
CREATE POLICY "day_closings_branch_select" ON day_closings FOR SELECT
    USING (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    );
CREATE POLICY "day_closings_branch_insert" ON day_closings FOR INSERT
    WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    );
