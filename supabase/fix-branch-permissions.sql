-- ============================================================
-- fix-branch-permissions.sql
--
-- Adds every branch INSERT / UPDATE / DELETE policy that was
-- missing from final-rls-fix.sql.
--
-- Run AFTER final-rls-fix.sql — this file only adds the gaps;
-- it never touches owner / super_admin policies.
--
-- Fully idempotent: DROP IF EXISTS before every CREATE.
-- Safe to run multiple times.
--
-- Missing policies by table (22 total):
--   categories      : branch INSERT, UPDATE, DELETE
--   products        : branch INSERT, DELETE
--   customers       : branch DELETE
--   invoices        : branch DELETE
--   invoice_items   : branch DELETE
--   payments        : branch UPDATE, DELETE
--   inventory_items : branch DELETE
--   purchases       : branch DELETE
--   purchase_items  : branch UPDATE, DELETE
--   day_closings    : branch UPDATE, DELETE
--   sync_queue      : branch SELECT, INSERT, UPDATE, DELETE (all 4)
--   suppliers       : branch INSERT, UPDATE
-- ============================================================

-- ── categories ───────────────────────────────────────────────
-- No branch_id column — categories are tenant-wide.
-- Branch can manage the shared catalog (add/edit/delete items).

DROP POLICY IF EXISTS "categories_branch_insert" ON categories;
DROP POLICY IF EXISTS "categories_branch_update" ON categories;
DROP POLICY IF EXISTS "categories_branch_delete" ON categories;

CREATE POLICY "categories_branch_insert" ON categories
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

CREATE POLICY "categories_branch_update" ON categories
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch');

CREATE POLICY "categories_branch_delete" ON categories
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

-- ── products ─────────────────────────────────────────────────
-- No branch_id column — products are tenant-wide.
-- UPDATE was already added in final-rls-fix.sql; only INSERT + DELETE missing.

DROP POLICY IF EXISTS "products_branch_insert" ON products;
DROP POLICY IF EXISTS "products_branch_delete" ON products;

CREATE POLICY "products_branch_insert" ON products
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

CREATE POLICY "products_branch_delete" ON products
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

-- ── customers ────────────────────────────────────────────────
-- INSERT + UPDATE already covered in final-rls-fix.sql;  only DELETE missing.

DROP POLICY IF EXISTS "customers_branch_delete" ON customers;

CREATE POLICY "customers_branch_delete" ON customers
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

-- ── invoices ─────────────────────────────────────────────────
-- SELECT + INSERT + UPDATE already covered; only DELETE missing.

DROP POLICY IF EXISTS "invoices_branch_delete" ON invoices;

CREATE POLICY "invoices_branch_delete" ON invoices
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ── invoice_items ────────────────────────────────────────────
-- SELECT + INSERT + UPDATE already covered; only DELETE missing.
-- Scoped via parent invoice's branch_id.

DROP POLICY IF EXISTS "invoice_items_branch_delete" ON invoice_items;

CREATE POLICY "invoice_items_branch_delete" ON invoice_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id        = invoice_items.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );

-- ── payments ─────────────────────────────────────────────────
-- SELECT + INSERT already covered; UPDATE + DELETE missing.
-- payments has no branch_id — scoped via parent invoice.

DROP POLICY IF EXISTS "payments_branch_update" ON payments;
DROP POLICY IF EXISTS "payments_branch_delete" ON payments;

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

-- ── inventory_items ──────────────────────────────────────────
-- INSERT + UPDATE already covered; only DELETE missing.

DROP POLICY IF EXISTS "inventory_items_branch_delete" ON inventory_items;

CREATE POLICY "inventory_items_branch_delete" ON inventory_items
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ── purchases ────────────────────────────────────────────────
-- SELECT + INSERT + UPDATE already covered; only DELETE missing.

DROP POLICY IF EXISTS "purchases_branch_delete" ON purchases;

CREATE POLICY "purchases_branch_delete" ON purchases
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ── purchase_items ───────────────────────────────────────────
-- SELECT (tenant-wide) + INSERT already covered; UPDATE + DELETE missing.
-- Scoped via parent purchase's branch_id.

DROP POLICY IF EXISTS "purchase_items_branch_update" ON purchase_items;
DROP POLICY IF EXISTS "purchase_items_branch_delete" ON purchase_items;

CREATE POLICY "purchase_items_branch_update" ON purchase_items
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id        = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND p.branch_id = get_my_branch_id()
              AND get_my_role() = 'branch'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id        = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND p.branch_id = get_my_branch_id()
              AND get_my_role() = 'branch'
        )
    );

CREATE POLICY "purchase_items_branch_delete" ON purchase_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM purchases p
            WHERE p.id        = purchase_items.purchase_id
              AND p.tenant_id = get_my_tenant_id()
              AND p.branch_id = get_my_branch_id()
              AND get_my_role() = 'branch'
        )
    );

-- ── day_closings ─────────────────────────────────────────────
-- SELECT + INSERT already covered; UPDATE + DELETE missing.
-- Uses subqueries (not helper functions) — same pattern as existing
-- day_closings policies to avoid any potential recursion.

DROP POLICY IF EXISTS "day_closings_branch_update" ON day_closings;
DROP POLICY IF EXISTS "day_closings_branch_delete" ON day_closings;

CREATE POLICY "day_closings_branch_update" ON day_closings FOR UPDATE
    USING (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    )
    WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    );

CREATE POLICY "day_closings_branch_delete" ON day_closings FOR DELETE
    USING (
        tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
        AND branch_id IN (SELECT branch_id FROM user_profiles WHERE id = auth.uid() AND role = 'branch')
    );

-- ── sync_queue ───────────────────────────────────────────────
-- Zero branch policies existed. Adding all 4.
-- sync_queue has branch_id — branch accesses only their own queue.

DROP POLICY IF EXISTS "sync_queue_branch_select" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_branch_insert" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_branch_update" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_branch_delete" ON sync_queue;

CREATE POLICY "sync_queue_branch_select" ON sync_queue
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

CREATE POLICY "sync_queue_branch_insert" ON sync_queue
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

CREATE POLICY "sync_queue_branch_update" ON sync_queue
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id())
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch' AND branch_id = get_my_branch_id());

CREATE POLICY "sync_queue_branch_delete" ON sync_queue
    FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
        AND branch_id = get_my_branch_id()
    );

-- ── suppliers ────────────────────────────────────────────────
-- SELECT already covered (tenant-wide read).
-- Branch can add / edit suppliers; only owner can delete.
-- No branch_id on suppliers — tenant-wide resource.

DROP POLICY IF EXISTS "suppliers_branch_insert" ON suppliers;
DROP POLICY IF EXISTS "suppliers_branch_update" ON suppliers;

CREATE POLICY "suppliers_branch_insert" ON suppliers
    FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'branch'
    );

CREATE POLICY "suppliers_branch_update" ON suppliers
    FOR UPDATE
    USING      (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch')
    WITH CHECK (tenant_id = get_my_tenant_id() AND get_my_role() = 'branch');
