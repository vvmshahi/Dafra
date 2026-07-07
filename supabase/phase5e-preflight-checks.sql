-- ============================================================
-- Phase 5E Preflight Checks: Branch Operations Permission Hardening
-- SELECT-only checks to run before applying:
--   supabase/phase5e-branch-operations-permission-hardening.sql
-- ============================================================
--
-- Purpose:
--   Detect existing rows that Phase 5E trigger validation may reject on
--   future INSERT/UPDATE operations.
--
-- Important:
--   - SELECT-only. This file does not modify data or schema.
--   - Expected result for each check is zero rows.
--   - Run after the branch-isolation phases that add branch_id to products,
--     categories, customers, and suppliers.

-- ============================================================
-- 1. Branch-scoped rows with NULL tenant_id or branch_id
-- ============================================================
-- Phase 5E requires tenant_id and branch_id for branch-operation rows.
-- Any row returned here can fail future scoped updates touching validated
-- columns such as tenant_id, branch_id, category_id, or supplier_id.
SELECT
  'branch_scope_required' AS issue_code,
  'categories' AS table_name,
  c.id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', c.name) AS details
FROM public.categories c
WHERE c.tenant_id IS NULL OR c.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'products',
  p.id,
  p.tenant_id,
  p.branch_id,
  jsonb_build_object('name', p.name, 'sku', p.sku)
FROM public.products p
WHERE p.tenant_id IS NULL OR p.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'customers',
  c.id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', c.name, 'phone', c.phone)
FROM public.customers c
WHERE c.tenant_id IS NULL OR c.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'suppliers',
  s.id,
  s.tenant_id,
  s.branch_id,
  jsonb_build_object('name', s.name, 'phone', s.phone)
FROM public.suppliers s
WHERE s.tenant_id IS NULL OR s.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'inventory_items',
  ii.id,
  ii.tenant_id,
  ii.branch_id,
  jsonb_build_object('name', ii.name, 'supplier_id', ii.supplier_id, 'category_id', ii.category_id)
FROM public.inventory_items ii
WHERE ii.tenant_id IS NULL OR ii.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'purchases',
  p.id,
  p.tenant_id,
  p.branch_id,
  jsonb_build_object('supplier_id', p.supplier_id, 'purchase_date', p.purchase_date)
FROM public.purchases p
WHERE p.tenant_id IS NULL OR p.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'expenses',
  e.id,
  e.tenant_id,
  e.branch_id,
  jsonb_build_object('category_id', e.category_id, 'expense_date', e.expense_date, 'description', e.description)
FROM public.expenses e
WHERE e.tenant_id IS NULL OR e.branch_id IS NULL

UNION ALL

SELECT
  'branch_scope_required',
  'fixed_expenses',
  fe.id,
  fe.tenant_id,
  fe.branch_id,
  jsonb_build_object('category_id', fe.category_id, 'name', fe.name)
FROM public.fixed_expenses fe
WHERE fe.tenant_id IS NULL OR fe.branch_id IS NULL;

-- ============================================================
-- 2. Branch IDs that do not belong to the row tenant
-- ============================================================
-- Phase 5E checks branches(id, tenant_id). Rows returned here have a missing
-- branch or a branch owned by another tenant.
SELECT
  'branch_tenant_mismatch' AS issue_code,
  'categories' AS table_name,
  c.id,
  c.tenant_id AS row_tenant_id,
  c.branch_id,
  b.tenant_id AS branch_tenant_id,
  jsonb_build_object('name', c.name) AS details
FROM public.categories c
LEFT JOIN public.branches b ON b.id = c.branch_id
WHERE c.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM c.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'products',
  p.id,
  p.tenant_id,
  p.branch_id,
  b.tenant_id,
  jsonb_build_object('name', p.name, 'sku', p.sku)
FROM public.products p
LEFT JOIN public.branches b ON b.id = p.branch_id
WHERE p.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM p.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'customers',
  c.id,
  c.tenant_id,
  c.branch_id,
  b.tenant_id,
  jsonb_build_object('name', c.name, 'phone', c.phone)
FROM public.customers c
LEFT JOIN public.branches b ON b.id = c.branch_id
WHERE c.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM c.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'suppliers',
  s.id,
  s.tenant_id,
  s.branch_id,
  b.tenant_id,
  jsonb_build_object('name', s.name, 'phone', s.phone)
FROM public.suppliers s
LEFT JOIN public.branches b ON b.id = s.branch_id
WHERE s.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM s.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'inventory_items',
  ii.id,
  ii.tenant_id,
  ii.branch_id,
  b.tenant_id,
  jsonb_build_object('name', ii.name)
FROM public.inventory_items ii
LEFT JOIN public.branches b ON b.id = ii.branch_id
WHERE ii.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM ii.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'purchases',
  p.id,
  p.tenant_id,
  p.branch_id,
  b.tenant_id,
  jsonb_build_object('supplier_id', p.supplier_id, 'purchase_date', p.purchase_date)
FROM public.purchases p
LEFT JOIN public.branches b ON b.id = p.branch_id
WHERE p.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM p.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'expenses',
  e.id,
  e.tenant_id,
  e.branch_id,
  b.tenant_id,
  jsonb_build_object('category_id', e.category_id, 'expense_date', e.expense_date)
FROM public.expenses e
LEFT JOIN public.branches b ON b.id = e.branch_id
WHERE e.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM e.tenant_id)

UNION ALL

SELECT
  'branch_tenant_mismatch',
  'fixed_expenses',
  fe.id,
  fe.tenant_id,
  fe.branch_id,
  b.tenant_id,
  jsonb_build_object('category_id', fe.category_id, 'name', fe.name)
FROM public.fixed_expenses fe
LEFT JOIN public.branches b ON b.id = fe.branch_id
WHERE fe.branch_id IS NOT NULL
  AND (b.id IS NULL OR b.tenant_id IS DISTINCT FROM fe.tenant_id);

-- ============================================================
-- 3. Invalid category references
-- ============================================================
-- Phase 5E allows tenant-wide categories when category.branch_id is NULL,
-- but rejects missing categories, cross-tenant categories, and cross-branch
-- branch-scoped categories.
SELECT
  'category_reference_invalid' AS issue_code,
  'categories.parent_id' AS reference_path,
  c.id AS row_id,
  c.tenant_id AS row_tenant_id,
  c.branch_id AS row_branch_id,
  c.parent_id AS referenced_category_id,
  pc.tenant_id AS referenced_tenant_id,
  pc.branch_id AS referenced_branch_id,
  jsonb_build_object('name', c.name, 'parent_name', pc.name) AS details
FROM public.categories c
LEFT JOIN public.categories pc ON pc.id = c.parent_id
WHERE c.parent_id IS NOT NULL
  AND (
    pc.id IS NULL
    OR pc.tenant_id IS DISTINCT FROM c.tenant_id
    OR (pc.branch_id IS NOT NULL AND pc.branch_id IS DISTINCT FROM c.branch_id)
  )

UNION ALL

SELECT
  'category_reference_invalid',
  'products.category_id',
  p.id,
  p.tenant_id,
  p.branch_id,
  p.category_id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', p.name, 'category_name', c.name)
FROM public.products p
LEFT JOIN public.categories c ON c.id = p.category_id
WHERE p.category_id IS NOT NULL
  AND (
    c.id IS NULL
    OR c.tenant_id IS DISTINCT FROM p.tenant_id
    OR (c.branch_id IS NOT NULL AND c.branch_id IS DISTINCT FROM p.branch_id)
  )

UNION ALL

SELECT
  'category_reference_invalid',
  'inventory_items.category_id',
  ii.id,
  ii.tenant_id,
  ii.branch_id,
  ii.category_id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', ii.name, 'category_name', c.name)
FROM public.inventory_items ii
LEFT JOIN public.categories c ON c.id = ii.category_id
WHERE ii.category_id IS NOT NULL
  AND (
    c.id IS NULL
    OR c.tenant_id IS DISTINCT FROM ii.tenant_id
    OR (c.branch_id IS NOT NULL AND c.branch_id IS DISTINCT FROM ii.branch_id)
  );

-- ============================================================
-- 4. Invalid supplier references
-- ============================================================
-- Phase 5E allows tenant-wide suppliers when supplier.branch_id is NULL,
-- but rejects missing suppliers, cross-tenant suppliers, and cross-branch
-- branch-scoped suppliers.
SELECT
  'supplier_reference_invalid' AS issue_code,
  'inventory_items.supplier_id' AS reference_path,
  ii.id AS row_id,
  ii.tenant_id AS row_tenant_id,
  ii.branch_id AS row_branch_id,
  ii.supplier_id AS referenced_supplier_id,
  s.tenant_id AS referenced_tenant_id,
  s.branch_id AS referenced_branch_id,
  jsonb_build_object('name', ii.name, 'supplier_name', s.name) AS details
FROM public.inventory_items ii
LEFT JOIN public.suppliers s ON s.id = ii.supplier_id
WHERE ii.supplier_id IS NOT NULL
  AND (
    s.id IS NULL
    OR s.tenant_id IS DISTINCT FROM ii.tenant_id
    OR (s.branch_id IS NOT NULL AND s.branch_id IS DISTINCT FROM ii.branch_id)
  )

UNION ALL

SELECT
  'supplier_reference_invalid',
  'purchases.supplier_id',
  p.id,
  p.tenant_id,
  p.branch_id,
  p.supplier_id,
  s.tenant_id,
  s.branch_id,
  jsonb_build_object('purchase_date', p.purchase_date, 'supplier_name', s.name)
FROM public.purchases p
LEFT JOIN public.suppliers s ON s.id = p.supplier_id
WHERE p.supplier_id IS NOT NULL
  AND (
    s.id IS NULL
    OR s.tenant_id IS DISTINCT FROM p.tenant_id
    OR (s.branch_id IS NOT NULL AND s.branch_id IS DISTINCT FROM p.branch_id)
  );

-- ============================================================
-- 5. Purchase items with invalid parent purchase or inventory item
-- ============================================================
-- Phase 5E scopes purchase_items through their parent purchase and requires
-- referenced inventory_items to be branch-scoped to that same purchase branch.
SELECT
  'purchase_item_parent_invalid' AS issue_code,
  pi.id AS purchase_item_id,
  pi.purchase_id,
  pi.inventory_item_id,
  p.tenant_id AS purchase_tenant_id,
  p.branch_id AS purchase_branch_id,
  jsonb_build_object('name', pi.name, 'quantity', pi.quantity) AS details
FROM public.purchase_items pi
LEFT JOIN public.purchases p ON p.id = pi.purchase_id
WHERE p.id IS NULL

UNION ALL

SELECT
  'purchase_item_inventory_invalid',
  pi.id,
  pi.purchase_id,
  pi.inventory_item_id,
  p.tenant_id,
  p.branch_id,
  jsonb_build_object(
    'name', pi.name,
    'quantity', pi.quantity,
    'inventory_tenant_id', ii.tenant_id,
    'inventory_branch_id', ii.branch_id,
    'inventory_name', ii.name
  )
FROM public.purchase_items pi
JOIN public.purchases p ON p.id = pi.purchase_id
LEFT JOIN public.inventory_items ii ON ii.id = pi.inventory_item_id
WHERE pi.inventory_item_id IS NOT NULL
  AND (
    ii.id IS NULL
    OR ii.tenant_id IS DISTINCT FROM p.tenant_id
    OR ii.branch_id IS NULL
    OR ii.branch_id IS DISTINCT FROM p.branch_id
  );

-- ============================================================
-- 6. Expense category issues
-- ============================================================
-- Phase 5E allows system expense categories, and allows custom categories
-- only when they belong to the same tenant as the expense/fixed expense.
SELECT
  'expense_category_invalid' AS issue_code,
  'expenses.category_id' AS reference_path,
  e.id AS row_id,
  e.tenant_id AS row_tenant_id,
  e.branch_id AS row_branch_id,
  e.category_id AS referenced_category_id,
  ec.tenant_id AS referenced_tenant_id,
  COALESCE(ec.is_system, FALSE) AS referenced_is_system,
  jsonb_build_object('expense_date', e.expense_date, 'description', e.description, 'category_name', ec.name) AS details
FROM public.expenses e
LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
WHERE e.category_id IS NOT NULL
  AND (
    ec.id IS NULL
    OR (COALESCE(ec.is_system, FALSE) IS NOT TRUE AND ec.tenant_id IS DISTINCT FROM e.tenant_id)
  )

UNION ALL

SELECT
  'expense_category_invalid',
  'fixed_expenses.category_id',
  fe.id,
  fe.tenant_id,
  fe.branch_id,
  fe.category_id,
  ec.tenant_id,
  COALESCE(ec.is_system, FALSE),
  jsonb_build_object('name', fe.name, 'category_name', ec.name)
FROM public.fixed_expenses fe
LEFT JOIN public.expense_categories ec ON ec.id = fe.category_id
WHERE fe.category_id IS NOT NULL
  AND (
    ec.id IS NULL
    OR (COALESCE(ec.is_system, FALSE) IS NOT TRUE AND ec.tenant_id IS DISTINCT FROM fe.tenant_id)
  );

-- ============================================================
-- 7. Branch-scoped lookup rows that are still tenant-wide
-- ============================================================
-- These may be intentionally legacy/shared rows, but after branch isolation
-- products/categories/customers/suppliers are expected to be branch-scoped.
-- Rows here are especially relevant because Phase 5E trigger attachment for
-- these tables assumes branch_id exists.
SELECT
  'legacy_tenant_wide_lookup' AS issue_code,
  'categories' AS table_name,
  c.id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', c.name) AS details
FROM public.categories c
WHERE c.branch_id IS NULL

UNION ALL

SELECT
  'legacy_tenant_wide_lookup',
  'products',
  p.id,
  p.tenant_id,
  p.branch_id,
  jsonb_build_object('name', p.name, 'sku', p.sku)
FROM public.products p
WHERE p.branch_id IS NULL

UNION ALL

SELECT
  'legacy_tenant_wide_lookup',
  'customers',
  c.id,
  c.tenant_id,
  c.branch_id,
  jsonb_build_object('name', c.name, 'phone', c.phone)
FROM public.customers c
WHERE c.branch_id IS NULL

UNION ALL

SELECT
  'legacy_tenant_wide_lookup',
  'suppliers',
  s.id,
  s.tenant_id,
  s.branch_id,
  jsonb_build_object('name', s.name, 'phone', s.phone)
FROM public.suppliers s
WHERE s.branch_id IS NULL;
