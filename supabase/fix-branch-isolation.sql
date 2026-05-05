-- ============================================================
-- FIX: Branch isolation for products, categories, customers, suppliers
--
-- Before this migration every record was scoped to tenant_id only,
-- meaning all branches in a tenant shared one catalogue.
-- After: each record belongs to a specific branch.
-- ============================================================

-- ── 1. Add branch_id columns ─────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

-- ── 2. Back-fill: assign existing rows to the first branch of their tenant ──

UPDATE products p
SET branch_id = (
  SELECT b.id FROM branches b
  WHERE b.tenant_id = p.tenant_id
  ORDER BY b.created_at
  LIMIT 1
)
WHERE p.branch_id IS NULL;

UPDATE categories c
SET branch_id = (
  SELECT b.id FROM branches b
  WHERE b.tenant_id = c.tenant_id
  ORDER BY b.created_at
  LIMIT 1
)
WHERE c.branch_id IS NULL;

UPDATE customers cu
SET branch_id = (
  SELECT b.id FROM branches b
  WHERE b.tenant_id = cu.tenant_id
  ORDER BY b.created_at
  LIMIT 1
)
WHERE cu.branch_id IS NULL;

UPDATE suppliers s
SET branch_id = (
  SELECT b.id FROM branches b
  WHERE b.tenant_id = s.tenant_id
  ORDER BY b.created_at
  LIMIT 1
)
WHERE s.branch_id IS NULL;

-- ── 3. Enforce NOT NULL after back-fill ──────────────────────

ALTER TABLE products   ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE customers  ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE suppliers  ALTER COLUMN branch_id SET NOT NULL;

-- ── 4. Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_products_branch    ON products   (branch_id);
CREATE INDEX IF NOT EXISTS idx_categories_branch  ON categories (branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_branch   ON customers  (branch_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch   ON suppliers  (branch_id);

-- ── 5. expense_categories: system rows stay tenant-wide (branch_id NULL) ──
--      Custom categories already use tenant_id and that is intentional.
--      No schema change needed — the existing query already handles this:
--      .or('tenant_id.is.null,tenant_id.eq.${tid}')
