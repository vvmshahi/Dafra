-- ============================================================
-- Phase 5G: Fix purchase supplier scope validation
-- ============================================================
--
-- Purpose:
--   Fix a Phase 5E purchase trigger false rejection where a branch-scoped
--   supplier that matches the purchase tenant_id and branch_id can still be
--   rejected with "Purchase supplier does not belong to this tenant."
--
-- Scope:
--   - Replaces only public.phase5e_validate_purchase_scope().
--   - Keeps the existing purchases trigger attached.
--   - Preserves tenant isolation and branch isolation.
--   - Does not weaken RLS, disable triggers, or change purchase calculations.
--
-- Diagnostic queries for the reported case:
--
-- SELECT id, tenant_id, branch_id, name, is_active
-- FROM public.suppliers
-- WHERE id = 'ddee1c5a-b918-4244-84f4-34e3c75c88f2';
--
-- SELECT id, tenant_id
-- FROM public.branches
-- WHERE id = '371dee75-6e46-496e-89e7-1a7492b51a3c';
--
-- Expected:
--   supplier.tenant_id = purchase.tenant_id
--   supplier.branch_id = purchase.branch_id
--   branch.tenant_id   = purchase.tenant_id
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.phase5e_validate_purchase_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_supplier RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.id, s.tenant_id, s.branch_id, COALESCE(s.is_active, TRUE) AS is_active
    INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = NEW.supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchase supplier is not active.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5e_validate_purchase_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase5e_validate_purchase_scope() TO service_role;

COMMENT ON FUNCTION public.phase5e_validate_purchase_scope() IS
  'Phase 5G fix: validates purchase supplier scope explicitly by tenant_id and branch_id to avoid Phase 5E generic helper false rejection for branch-scoped suppliers.';

NOTIFY pgrst, 'reload schema';

COMMIT;
