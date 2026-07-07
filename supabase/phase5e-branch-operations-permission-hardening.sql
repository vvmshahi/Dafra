-- ============================================================
-- Phase 5E: Branch Operations Permission Hardening
-- Apply manually after Phase 3A/3B and Phase 4C/4D purchase flows are in place.
-- ============================================================
--
-- Goals:
--   - Preserve branch users' day-to-day operational access.
--   - Reject cross-tenant/cross-branch references inside branch-scoped writes.
--   - Keep purchase stock changes on the existing confirm/reverse RPC path.
--   - Keep reports, POS, invoices, VAT/tax/payment math, ZATCA, printer,
--     Electron, username login, and manual subscription behavior unchanged.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data directly.

BEGIN;

-- ============================================================
-- Shared validation helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.phase5e_column_exists(
  p_table TEXT,
  p_column TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  )
$$;

CREATE OR REPLACE FUNCTION public.phase5e_assert_branch_scope(
  p_tenant_id UUID,
  p_branch_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Tenant and branch are required for branch operations.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_assert_optional_branch_fk(
  p_table TEXT,
  p_id UUID,
  p_label TEXT,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_allow_tenant_wide BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_has_branch_id BOOLEAN;
  v_row RECORD;
  v_sql TEXT;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  IF p_table NOT IN (
    'categories',
    'suppliers',
    'inventory_items',
    'products',
    'customers'
  ) THEN
    RAISE EXCEPTION 'Unsupported branch validation table.'
      USING ERRCODE = '22023';
  END IF;

  v_has_branch_id := public.phase5e_column_exists(p_table, 'branch_id');
  v_sql := CASE
    WHEN v_has_branch_id THEN format('SELECT tenant_id, branch_id FROM public.%I WHERE id = $1', p_table)
    ELSE format('SELECT tenant_id, NULL::uuid AS branch_id FROM public.%I WHERE id = $1', p_table)
  END;

  EXECUTE v_sql INTO v_row USING p_id;

  IF NOT FOUND OR v_row.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION '% does not belong to this tenant.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS NULL THEN
    IF p_allow_tenant_wide IS TRUE THEN
      RETURN;
    END IF;

    RAISE EXCEPTION '% must be branch-scoped.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION '% does not belong to this branch.', p_label
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5e_column_exists(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_assert_branch_scope(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_assert_optional_branch_fk(TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.phase5e_column_exists(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase5e_assert_branch_scope(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase5e_assert_optional_branch_fk(TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) TO service_role;

-- ============================================================
-- Branch-scoped operation validators
-- ============================================================

CREATE OR REPLACE FUNCTION public.phase5e_validate_category_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'categories',
    NEW.parent_id,
    'Parent category',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_product_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'categories',
    NEW.category_id,
    'Product category',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_customer_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_supplier_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_inventory_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'categories',
    NEW.category_id,
    'Inventory category',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  PERFORM public.phase5e_assert_optional_branch_fk(
    'suppliers',
    NEW.supplier_id,
    'Inventory supplier',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_purchase_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'suppliers',
    NEW.supplier_id,
    'Purchase supplier',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_purchase_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_purchase RECORD;
BEGIN
  SELECT p.id, p.tenant_id, p.branch_id
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = NEW.purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase does not exist.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.phase5e_assert_branch_scope(v_purchase.tenant_id, v_purchase.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'inventory_items',
    NEW.inventory_item_id,
    'Purchase inventory item',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    FALSE
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase5e_validate_expense_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_category RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.category_id IS NOT NULL THEN
    SELECT ec.tenant_id, COALESCE(ec.is_system, FALSE) AS is_system
      INTO v_category
    FROM public.expense_categories ec
    WHERE ec.id = NEW.category_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Expense category does not exist.'
        USING ERRCODE = '23514';
    END IF;

    IF v_category.is_system IS NOT TRUE
       AND v_category.tenant_id IS DISTINCT FROM NEW.tenant_id
    THEN
      RAISE EXCEPTION 'Expense category does not belong to this tenant.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5e_validate_category_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_product_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_customer_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_supplier_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_inventory_item_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_purchase_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_purchase_item_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_expense_scope() FROM PUBLIC;

-- ============================================================
-- Trigger attachment
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL
     AND public.phase5e_column_exists('categories', 'branch_id') THEN
    DROP TRIGGER IF EXISTS trg_phase5e_categories_scope ON public.categories;
    CREATE TRIGGER trg_phase5e_categories_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, parent_id ON public.categories
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_category_scope();
  END IF;

  IF to_regclass('public.products') IS NOT NULL
     AND public.phase5e_column_exists('products', 'branch_id') THEN
    DROP TRIGGER IF EXISTS trg_phase5e_products_scope ON public.products;
    CREATE TRIGGER trg_phase5e_products_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, category_id ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_product_scope();
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
     AND public.phase5e_column_exists('customers', 'branch_id') THEN
    DROP TRIGGER IF EXISTS trg_phase5e_customers_scope ON public.customers;
    CREATE TRIGGER trg_phase5e_customers_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON public.customers
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_customer_scope();
  END IF;

  IF to_regclass('public.suppliers') IS NOT NULL
     AND public.phase5e_column_exists('suppliers', 'branch_id') THEN
    DROP TRIGGER IF EXISTS trg_phase5e_suppliers_scope ON public.suppliers;
    CREATE TRIGGER trg_phase5e_suppliers_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON public.suppliers
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_supplier_scope();
  END IF;

  IF to_regclass('public.inventory_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_phase5e_inventory_items_scope ON public.inventory_items;
    CREATE TRIGGER trg_phase5e_inventory_items_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, category_id, supplier_id ON public.inventory_items
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_inventory_item_scope();
  END IF;

  IF to_regclass('public.purchases') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_phase5e_purchases_scope ON public.purchases;
    CREATE TRIGGER trg_phase5e_purchases_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, supplier_id ON public.purchases
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_purchase_scope();
  END IF;

  IF to_regclass('public.purchase_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_phase5e_purchase_items_scope ON public.purchase_items;
    CREATE TRIGGER trg_phase5e_purchase_items_scope
      BEFORE INSERT OR UPDATE OF purchase_id, inventory_item_id ON public.purchase_items
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_purchase_item_scope();
  END IF;

  IF to_regclass('public.expenses') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_phase5e_expenses_scope ON public.expenses;
    CREATE TRIGGER trg_phase5e_expenses_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, category_id ON public.expenses
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_expense_scope();
  END IF;

  IF to_regclass('public.fixed_expenses') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_phase5e_fixed_expenses_scope ON public.fixed_expenses;
    CREATE TRIGGER trg_phase5e_fixed_expenses_scope
      BEFORE INSERT OR UPDATE OF tenant_id, branch_id, category_id ON public.fixed_expenses
      FOR EACH ROW EXECUTE FUNCTION public.phase5e_validate_expense_scope();
  END IF;
END $$;

COMMENT ON FUNCTION public.phase5e_assert_branch_scope(UUID, UUID) IS
  'Phase 5E helper: validates that a branch-scoped operation references a branch owned by the tenant.';

COMMENT ON FUNCTION public.phase5e_assert_optional_branch_fk(TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) IS
  'Phase 5E helper: validates tenant/branch ownership for optional foreign keys used by branch operation tables.';

NOTIFY pgrst, 'reload schema';

COMMIT;
