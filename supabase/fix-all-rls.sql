-- ============================================================
-- Dafra — Fix ALL RLS policies
-- Splits every "FOR ALL … USING (…)" policy (which silently
-- blocks INSERT because it has no WITH CHECK clause) into
-- separate SELECT / INSERT / UPDATE / DELETE policies that
-- each carry the correct clause.
--
-- Rules applied:
--   SELECT : USING only
--   INSERT : WITH CHECK only
--   UPDATE : USING + WITH CHECK (same expression for both)
--   DELETE : USING only
--
-- Fully idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- subscription_plans
-- ============================================================

DROP POLICY IF EXISTS "plans_super_admin"              ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_select"       ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_insert"       ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_update"       ON subscription_plans;
DROP POLICY IF EXISTS "plans_super_admin_delete"       ON subscription_plans;

CREATE POLICY "plans_super_admin_select" ON subscription_plans
    FOR SELECT USING (is_super_admin());
CREATE POLICY "plans_super_admin_insert" ON subscription_plans
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "plans_super_admin_update" ON subscription_plans
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "plans_super_admin_delete" ON subscription_plans
    FOR DELETE USING (is_super_admin());

-- ============================================================
-- tenants
-- ============================================================

DROP POLICY IF EXISTS "tenants_super_admin"            ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_select"     ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_insert"     ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_update"     ON tenants;
DROP POLICY IF EXISTS "tenants_super_admin_delete"     ON tenants;
DROP POLICY IF EXISTS "tenants_owner_update"           ON tenants;

CREATE POLICY "tenants_super_admin_select" ON tenants
    FOR SELECT USING (is_super_admin());
CREATE POLICY "tenants_super_admin_insert" ON tenants
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "tenants_super_admin_update" ON tenants
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenants_super_admin_delete" ON tenants
    FOR DELETE USING (is_super_admin());

-- Owner can update their own tenant record
CREATE POLICY "tenants_owner_update" ON tenants
    FOR UPDATE
    USING      (id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ============================================================
-- tenant_subscriptions
-- ============================================================

DROP POLICY IF EXISTS "tenant_subs_super_admin"        ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_select" ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_insert" ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_update" ON tenant_subscriptions;
DROP POLICY IF EXISTS "tenant_subs_super_admin_delete" ON tenant_subscriptions;

CREATE POLICY "tenant_subs_super_admin_select" ON tenant_subscriptions
    FOR SELECT USING (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_insert" ON tenant_subscriptions
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_update" ON tenant_subscriptions
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_subs_super_admin_delete" ON tenant_subscriptions
    FOR DELETE USING (is_super_admin());

-- ============================================================
-- branches
-- ============================================================

DROP POLICY IF EXISTS "branches_super_admin"           ON branches;
DROP POLICY IF EXISTS "branches_super_admin_select"    ON branches;
DROP POLICY IF EXISTS "branches_super_admin_insert"    ON branches;
DROP POLICY IF EXISTS "branches_super_admin_update"    ON branches;
DROP POLICY IF EXISTS "branches_super_admin_delete"    ON branches;
DROP POLICY IF EXISTS "branches_owner_all"             ON branches;
DROP POLICY IF EXISTS "branches_owner_select"          ON branches;
DROP POLICY IF EXISTS "branches_owner_insert"          ON branches;
DROP POLICY IF EXISTS "branches_owner_update"          ON branches;
DROP POLICY IF EXISTS "branches_owner_delete"          ON branches;

CREATE POLICY "branches_super_admin_select" ON branches
    FOR SELECT USING (is_super_admin());
CREATE POLICY "branches_super_admin_insert" ON branches
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "branches_super_admin_update" ON branches
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "branches_super_admin_delete" ON branches
    FOR DELETE USING (is_super_admin());

CREATE POLICY "branches_owner_select" ON branches
    FOR SELECT USING (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );
CREATE POLICY "branches_owner_insert" ON branches
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );
CREATE POLICY "branches_owner_update" ON branches
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "branches_owner_delete" ON branches
    FOR DELETE USING (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );

-- ============================================================
-- user_profiles  (add WITH CHECK to the own_update policy)
-- ============================================================

DROP POLICY IF EXISTS "user_profiles_own_update"       ON user_profiles;

CREATE POLICY "user_profiles_own_update" ON user_profiles
    FOR UPDATE TO authenticated
    USING      (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ============================================================
-- zatca_certificates
-- ============================================================

DROP POLICY IF EXISTS "zatca_certs_super_admin"        ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_select" ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_insert" ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_update" ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_super_admin_delete" ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_all"          ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_select"       ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_insert"       ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_update"       ON zatca_certificates;
DROP POLICY IF EXISTS "zatca_certs_owner_delete"       ON zatca_certificates;

CREATE POLICY "zatca_certs_super_admin_select" ON zatca_certificates
    FOR SELECT USING (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_insert" ON zatca_certificates
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_update" ON zatca_certificates
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "zatca_certs_super_admin_delete" ON zatca_certificates
    FOR DELETE USING (is_super_admin());

CREATE POLICY "zatca_certs_owner_select" ON zatca_certificates
    FOR SELECT USING (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );
CREATE POLICY "zatca_certs_owner_insert" ON zatca_certificates
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );
CREATE POLICY "zatca_certs_owner_update" ON zatca_certificates
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "zatca_certs_owner_delete" ON zatca_certificates
    FOR DELETE USING (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );

-- ============================================================
-- categories
-- ============================================================

DROP POLICY IF EXISTS "categories_super_admin"         ON categories;
DROP POLICY IF EXISTS "categories_super_admin_select"  ON categories;
DROP POLICY IF EXISTS "categories_super_admin_insert"  ON categories;
DROP POLICY IF EXISTS "categories_super_admin_update"  ON categories;
DROP POLICY IF EXISTS "categories_super_admin_delete"  ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_write"     ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_insert"    ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_update"    ON categories;
DROP POLICY IF EXISTS "categories_owner_mgr_delete"    ON categories;

CREATE POLICY "categories_super_admin_select" ON categories
    FOR SELECT USING (is_super_admin());
CREATE POLICY "categories_super_admin_insert" ON categories
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "categories_super_admin_update" ON categories
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "categories_super_admin_delete" ON categories
    FOR DELETE USING (is_super_admin());

-- Write: owner + manager (SELECT is covered by categories_tenant_read)
CREATE POLICY "categories_owner_mgr_insert" ON categories
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "categories_owner_mgr_update" ON categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "categories_owner_mgr_delete" ON categories
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- products
-- ============================================================

DROP POLICY IF EXISTS "products_super_admin"           ON products;
DROP POLICY IF EXISTS "products_super_admin_select"    ON products;
DROP POLICY IF EXISTS "products_super_admin_insert"    ON products;
DROP POLICY IF EXISTS "products_super_admin_update"    ON products;
DROP POLICY IF EXISTS "products_super_admin_delete"    ON products;
DROP POLICY IF EXISTS "products_owner_mgr_write"       ON products;
DROP POLICY IF EXISTS "products_owner_mgr_insert"      ON products;
DROP POLICY IF EXISTS "products_owner_mgr_update"      ON products;
DROP POLICY IF EXISTS "products_owner_mgr_delete"      ON products;

CREATE POLICY "products_super_admin_select" ON products
    FOR SELECT USING (is_super_admin());
CREATE POLICY "products_super_admin_insert" ON products
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "products_super_admin_update" ON products
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "products_super_admin_delete" ON products
    FOR DELETE USING (is_super_admin());

-- Write: owner + manager (SELECT covered by products_tenant_read)
CREATE POLICY "products_owner_mgr_insert" ON products
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "products_owner_mgr_update" ON products
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "products_owner_mgr_delete" ON products
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- customers
-- ============================================================

DROP POLICY IF EXISTS "customers_super_admin"          ON customers;
DROP POLICY IF EXISTS "customers_super_admin_select"   ON customers;
DROP POLICY IF EXISTS "customers_super_admin_insert"   ON customers;
DROP POLICY IF EXISTS "customers_super_admin_update"   ON customers;
DROP POLICY IF EXISTS "customers_super_admin_delete"   ON customers;
DROP POLICY IF EXISTS "customers_write"                ON customers;
DROP POLICY IF EXISTS "customers_insert"               ON customers;
DROP POLICY IF EXISTS "customers_update"               ON customers;
DROP POLICY IF EXISTS "customers_delete"               ON customers;

CREATE POLICY "customers_super_admin_select" ON customers
    FOR SELECT USING (is_super_admin());
CREATE POLICY "customers_super_admin_insert" ON customers
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "customers_super_admin_update" ON customers
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "customers_super_admin_delete" ON customers
    FOR DELETE USING (is_super_admin());

-- Write: owner + manager + cashier (SELECT covered by customers_tenant_read)
CREATE POLICY "customers_insert" ON customers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );
CREATE POLICY "customers_update" ON customers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'));
CREATE POLICY "customers_delete" ON customers
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );

-- ============================================================
-- employees
-- ============================================================

-- Drop all old employees policies (from schema.sql and add-employees.sql)
DROP POLICY IF EXISTS "employees_super_admin"          ON employees;
DROP POLICY IF EXISTS "employees_super_admin_select"   ON employees;
DROP POLICY IF EXISTS "employees_super_admin_insert"   ON employees;
DROP POLICY IF EXISTS "employees_super_admin_update"   ON employees;
DROP POLICY IF EXISTS "employees_super_admin_delete"   ON employees;
DROP POLICY IF EXISTS "employees_owner_all"            ON employees;
DROP POLICY IF EXISTS "employees_owner_select"         ON employees;
DROP POLICY IF EXISTS "employees_owner_insert"         ON employees;
DROP POLICY IF EXISTS "employees_owner_update"         ON employees;
DROP POLICY IF EXISTS "employees_owner_delete"         ON employees;
DROP POLICY IF EXISTS "employees_manager_all"          ON employees;
DROP POLICY IF EXISTS "employees_manager_branch"       ON employees;
DROP POLICY IF EXISTS "employees_manager_insert"       ON employees;
DROP POLICY IF EXISTS "employees_manager_update"       ON employees;
DROP POLICY IF EXISTS "employees_manager_delete"       ON employees;

-- Super admin: full access
CREATE POLICY "employees_super_admin_select" ON employees FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_insert" ON employees FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_update" ON employees FOR UPDATE TO authenticated
    USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "employees_super_admin_delete" ON employees FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Owner: full access within their tenant
CREATE POLICY "employees_owner_select" ON employees FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_insert" ON employees FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_update" ON employees FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "employees_owner_delete" ON employees FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

-- Manager: write within their tenant
CREATE POLICY "employees_manager_insert" ON employees FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY "employees_manager_update" ON employees FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY "employees_manager_delete" ON employees FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));

-- Staff read (cashier / accountant): SELECT only — kept from add-employees.sql
-- (employees_staff_read already correct; DROP+recreate for cleanliness)
DROP POLICY IF EXISTS "employees_staff_read"           ON employees;
CREATE POLICY "employees_staff_read" ON employees FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================================
-- invoices
-- ============================================================

DROP POLICY IF EXISTS "invoices_super_admin"           ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_select"    ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_insert"    ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_update"    ON invoices;
DROP POLICY IF EXISTS "invoices_super_admin_delete"    ON invoices;
DROP POLICY IF EXISTS "invoices_owner_all"             ON invoices;
DROP POLICY IF EXISTS "invoices_owner_select"          ON invoices;
DROP POLICY IF EXISTS "invoices_owner_insert"          ON invoices;
DROP POLICY IF EXISTS "invoices_owner_update"          ON invoices;
DROP POLICY IF EXISTS "invoices_owner_delete"          ON invoices;
DROP POLICY IF EXISTS "invoices_manager_branch"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_select"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_insert"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_update"        ON invoices;
DROP POLICY IF EXISTS "invoices_manager_delete"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_branch"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_select"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_insert"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_update"        ON invoices;
DROP POLICY IF EXISTS "invoices_cashier_delete"        ON invoices;

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

-- Manager: branch-scoped
CREATE POLICY "invoices_manager_select" ON invoices
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_manager_insert" ON invoices
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_manager_update" ON invoices
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'manager' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'manager' AND branch_id = get_my_branch_id());
CREATE POLICY "invoices_manager_delete" ON invoices
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );

-- Cashier: branch-scoped (POS only writes; no delete)
CREATE POLICY "invoices_cashier_select" ON invoices
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'cashier'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_cashier_insert" ON invoices
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'cashier'
        AND branch_id = get_my_branch_id()
    );
CREATE POLICY "invoices_cashier_update" ON invoices
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'cashier' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'cashier' AND branch_id = get_my_branch_id());

-- ============================================================
-- invoice_items
-- ============================================================

DROP POLICY IF EXISTS "invoice_items_super_admin"      ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_select" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_insert" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_update" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_delete" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant"           ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_select"    ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_insert"    ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_update"    ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_delete"    ON invoice_items;

CREATE POLICY "invoice_items_super_admin_select" ON invoice_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "invoice_items_super_admin_insert" ON invoice_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "invoice_items_super_admin_update" ON invoice_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "invoice_items_super_admin_delete" ON invoice_items
    FOR DELETE USING (is_super_admin());

-- Tenant-scoped (mirrors invoices RLS): all roles that can access invoices
CREATE POLICY "invoice_items_tenant_select" ON invoice_items
    FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "invoice_items_tenant_insert" ON invoice_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );
CREATE POLICY "invoice_items_tenant_update" ON invoice_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'));
CREATE POLICY "invoice_items_tenant_delete" ON invoice_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );

-- ============================================================
-- payments
-- ============================================================

DROP POLICY IF EXISTS "payments_super_admin"            ON payments;
DROP POLICY IF EXISTS "payments_super_admin_select"     ON payments;
DROP POLICY IF EXISTS "payments_super_admin_insert"     ON payments;
DROP POLICY IF EXISTS "payments_super_admin_update"     ON payments;
DROP POLICY IF EXISTS "payments_super_admin_delete"     ON payments;
DROP POLICY IF EXISTS "payments_owner_all"              ON payments;
DROP POLICY IF EXISTS "payments_owner_select"           ON payments;
DROP POLICY IF EXISTS "payments_owner_insert"           ON payments;
DROP POLICY IF EXISTS "payments_owner_update"           ON payments;
DROP POLICY IF EXISTS "payments_owner_delete"           ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier"        ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_select" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_insert" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_update" ON payments;
DROP POLICY IF EXISTS "payments_manager_cashier_delete" ON payments;

CREATE POLICY "payments_super_admin_select" ON payments
    FOR SELECT USING (is_super_admin());
CREATE POLICY "payments_super_admin_insert" ON payments
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "payments_super_admin_update" ON payments
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "payments_super_admin_delete" ON payments
    FOR DELETE USING (is_super_admin());

-- Owner: all payments in tenant
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

-- Manager + cashier: branch-scoped payments (invoice must be in their branch)
CREATE POLICY "payments_manager_cashier_select" ON payments
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_manager_cashier_insert" ON payments
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_manager_cashier_update" ON payments
    FOR UPDATE
    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    )
    WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );
CREATE POLICY "payments_manager_cashier_delete" ON payments
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );

-- ============================================================
-- sync_queue
-- ============================================================

DROP POLICY IF EXISTS "sync_queue_super_admin"         ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_select"  ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_insert"  ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_update"  ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_super_admin_delete"  ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant"              ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_select"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_insert"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_update"       ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_tenant_delete"       ON sync_queue;

CREATE POLICY "sync_queue_super_admin_select" ON sync_queue
    FOR SELECT USING (is_super_admin());
CREATE POLICY "sync_queue_super_admin_insert" ON sync_queue
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "sync_queue_super_admin_update" ON sync_queue
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "sync_queue_super_admin_delete" ON sync_queue
    FOR DELETE USING (is_super_admin());

CREATE POLICY "sync_queue_tenant_select" ON sync_queue
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "sync_queue_tenant_insert" ON sync_queue
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "sync_queue_tenant_update" ON sync_queue
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "sync_queue_tenant_delete" ON sync_queue
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- expense_categories  (was: FOR ALL USING; INSERT/UPDATE/DELETE
--                      already existed but super_admin was FOR ALL)
-- ============================================================

DROP POLICY IF EXISTS "expense_categories_super_admin"        ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_select" ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_insert" ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_update" ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories_super_admin_delete" ON public.expense_categories;
-- Also fix the existing UPDATE policy that was missing WITH CHECK:
DROP POLICY IF EXISTS "expense_categories_update"             ON public.expense_categories;

CREATE POLICY "expense_categories_super_admin_select" ON public.expense_categories
    FOR SELECT USING (is_super_admin());
CREATE POLICY "expense_categories_super_admin_insert" ON public.expense_categories
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "expense_categories_super_admin_update" ON public.expense_categories
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "expense_categories_super_admin_delete" ON public.expense_categories
    FOR DELETE USING (is_super_admin());

CREATE POLICY "expense_categories_update" ON public.expense_categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager') AND is_system = FALSE)
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager') AND is_system = FALSE);

-- ============================================================
-- expenses
-- ============================================================

DROP POLICY IF EXISTS "expenses_super_admin"           ON public.expenses;
DROP POLICY IF EXISTS "expenses_super_admin_select"    ON public.expenses;
DROP POLICY IF EXISTS "expenses_super_admin_insert"    ON public.expenses;
DROP POLICY IF EXISTS "expenses_super_admin_update"    ON public.expenses;
DROP POLICY IF EXISTS "expenses_super_admin_delete"    ON public.expenses;
DROP POLICY IF EXISTS "expenses_owner_write"           ON public.expenses;
DROP POLICY IF EXISTS "expenses_owner_insert"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_owner_update"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_owner_delete"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_write"           ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_insert"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_update"          ON public.expenses;
DROP POLICY IF EXISTS "expenses_staff_delete"          ON public.expenses;

CREATE POLICY "expenses_super_admin_select" ON public.expenses
    FOR SELECT USING (is_super_admin());
CREATE POLICY "expenses_super_admin_insert" ON public.expenses
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "expenses_super_admin_update" ON public.expenses
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "expenses_super_admin_delete" ON public.expenses
    FOR DELETE USING (is_super_admin());

-- Owner: all expenses in tenant
CREATE POLICY "expenses_owner_insert" ON public.expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id() AND get_my_role() = 'owner'
    );
CREATE POLICY "expenses_owner_update" ON public.expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');
CREATE POLICY "expenses_owner_delete" ON public.expenses
    FOR DELETE USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Staff (manager + cashier): branch-scoped
CREATE POLICY "expenses_staff_insert" ON public.expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() IN ('manager', 'cashier')
    );
CREATE POLICY "expenses_staff_update" ON public.expenses
    FOR UPDATE
    USING (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() IN ('manager', 'cashier')
    )
    WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() IN ('manager', 'cashier')
    );
CREATE POLICY "expenses_staff_delete" ON public.expenses
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() IN ('manager', 'cashier')
    );

-- ============================================================
-- fixed_expenses
-- ============================================================

DROP POLICY IF EXISTS "fixed_expenses_super_admin"        ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_select" ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_insert" ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_update" ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_super_admin_delete" ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_write"              ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_insert"             ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_update"             ON public.fixed_expenses;
DROP POLICY IF EXISTS "fixed_expenses_delete"             ON public.fixed_expenses;

CREATE POLICY "fixed_expenses_super_admin_select" ON public.fixed_expenses
    FOR SELECT USING (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_insert" ON public.fixed_expenses
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_update" ON public.fixed_expenses
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "fixed_expenses_super_admin_delete" ON public.fixed_expenses
    FOR DELETE USING (is_super_admin());

CREATE POLICY "fixed_expenses_insert" ON public.fixed_expenses
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "fixed_expenses_update" ON public.fixed_expenses
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "fixed_expenses_delete" ON public.fixed_expenses
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- suppliers
-- ============================================================

DROP POLICY IF EXISTS "suppliers_super_admin"          ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_select"   ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_insert"   ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_update"   ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_super_admin_delete"   ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_write"                ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_insert"               ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_update"               ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_delete"               ON public.suppliers;

CREATE POLICY "suppliers_super_admin_select" ON public.suppliers
    FOR SELECT USING (is_super_admin());
CREATE POLICY "suppliers_super_admin_insert" ON public.suppliers
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "suppliers_super_admin_update" ON public.suppliers
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "suppliers_super_admin_delete" ON public.suppliers
    FOR DELETE USING (is_super_admin());

CREATE POLICY "suppliers_insert" ON public.suppliers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "suppliers_update" ON public.suppliers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "suppliers_delete" ON public.suppliers
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- inventory_items
-- ============================================================

DROP POLICY IF EXISTS "inventory_items_super_admin"        ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_select" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_insert" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_update" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_super_admin_delete" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_write"              ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_insert"             ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_update"             ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_delete"             ON public.inventory_items;

CREATE POLICY "inventory_items_super_admin_select" ON public.inventory_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "inventory_items_super_admin_insert" ON public.inventory_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "inventory_items_super_admin_update" ON public.inventory_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "inventory_items_super_admin_delete" ON public.inventory_items
    FOR DELETE USING (is_super_admin());

CREATE POLICY "inventory_items_insert" ON public.inventory_items
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );
CREATE POLICY "inventory_items_update" ON public.inventory_items
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager'));
CREATE POLICY "inventory_items_delete" ON public.inventory_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- purchases
-- ============================================================

DROP POLICY IF EXISTS "purchases_super_admin"          ON public.purchases;
DROP POLICY IF EXISTS "purchases_super_admin_select"   ON public.purchases;
DROP POLICY IF EXISTS "purchases_super_admin_insert"   ON public.purchases;
DROP POLICY IF EXISTS "purchases_super_admin_update"   ON public.purchases;
DROP POLICY IF EXISTS "purchases_super_admin_delete"   ON public.purchases;
DROP POLICY IF EXISTS "purchases_write"                ON public.purchases;
DROP POLICY IF EXISTS "purchases_insert"               ON public.purchases;
DROP POLICY IF EXISTS "purchases_update"               ON public.purchases;
DROP POLICY IF EXISTS "purchases_delete"               ON public.purchases;

CREATE POLICY "purchases_super_admin_select" ON public.purchases
    FOR SELECT USING (is_super_admin());
CREATE POLICY "purchases_super_admin_insert" ON public.purchases
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "purchases_super_admin_update" ON public.purchases
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "purchases_super_admin_delete" ON public.purchases
    FOR DELETE USING (is_super_admin());

CREATE POLICY "purchases_insert" ON public.purchases
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );
CREATE POLICY "purchases_update" ON public.purchases
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'))
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() IN ('owner', 'manager', 'cashier'));
CREATE POLICY "purchases_delete" ON public.purchases
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );

-- ============================================================
-- purchase_items  (no tenant_id column; access via purchases)
-- ============================================================

DROP POLICY IF EXISTS "purchase_items_super_admin"        ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_select" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_insert" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_update" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_super_admin_delete" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_write"              ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_insert"             ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_update"             ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_delete"             ON public.purchase_items;

CREATE POLICY "purchase_items_super_admin_select" ON public.purchase_items
    FOR SELECT USING (is_super_admin());
CREATE POLICY "purchase_items_super_admin_insert" ON public.purchase_items
    FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY "purchase_items_super_admin_update" ON public.purchase_items
    FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "purchase_items_super_admin_delete" ON public.purchase_items
    FOR DELETE USING (is_super_admin());

CREATE POLICY "purchase_items_insert" ON public.purchase_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'manager', 'cashier')
        )
    );
CREATE POLICY "purchase_items_update" ON public.purchase_items
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'manager', 'cashier')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'manager', 'cashier')
        )
    );
CREATE POLICY "purchase_items_delete" ON public.purchase_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND get_my_role() IN ('owner', 'manager', 'cashier')
        )
    );

-- ============================================================
-- day_closings
-- ============================================================

DROP POLICY IF EXISTS "day_closings_super_admin"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_select" ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_insert" ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_update" ON day_closings;
DROP POLICY IF EXISTS "day_closings_super_admin_delete" ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_all"          ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_select"       ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_insert"       ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_update"       ON day_closings;
DROP POLICY IF EXISTS "day_closings_owner_delete"       ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_all"        ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_insert"     ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_update"     ON day_closings;
DROP POLICY IF EXISTS "day_closings_manager_delete"     ON day_closings;

CREATE POLICY "day_closings_super_admin_select" ON day_closings FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_insert" ON day_closings FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_update" ON day_closings FOR UPDATE TO authenticated
    USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
CREATE POLICY "day_closings_super_admin_delete" ON day_closings FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "day_closings_owner_select" ON day_closings FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_insert" ON day_closings FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_update" ON day_closings FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "day_closings_owner_delete" ON day_closings FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));

CREATE POLICY "day_closings_manager_insert" ON day_closings FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY "day_closings_manager_update" ON day_closings FOR UPDATE TO authenticated
    USING      (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'))
    WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY "day_closings_manager_delete" ON day_closings FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));

-- day_closings_staff_read stays as-is (already correct SELECT USING)
DROP POLICY IF EXISTS "day_closings_staff_read"         ON day_closings;
CREATE POLICY "day_closings_staff_read" ON day_closings FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
