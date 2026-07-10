BEGIN;

-- Replace the product/category validators with explicit lookups. This keeps
-- Phase 5E tenant/branch isolation strict while avoiding generic helper drift.

CREATE OR REPLACE FUNCTION public.phase5e_validate_category_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_parent RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.tenant_id, c.branch_id
    INTO v_parent
  FROM public.categories c
  WHERE c.id = NEW.parent_id;

  IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Parent category does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_parent.branch_id IS NULL THEN
    RAISE EXCEPTION 'Parent category must be branch-scoped.'
      USING ERRCODE = '23514';
  END IF;

  IF v_parent.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Parent category does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

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
DECLARE
  v_category RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.tenant_id, c.branch_id
    INTO v_category
  FROM public.categories c
  WHERE c.id = NEW.category_id;

  IF NOT FOUND OR v_category.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Product category does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_category.branch_id IS NULL THEN
    RAISE EXCEPTION 'Product category must be branch-scoped.'
      USING ERRCODE = '23514';
  END IF;

  IF v_category.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Product category does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5e_validate_category_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5e_validate_product_scope() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.phase5e_validate_category_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.phase5e_validate_product_scope() TO service_role;

COMMENT ON FUNCTION public.phase5e_validate_category_scope() IS
  'Phase 5H explicit category parent tenant/branch validation for branch-scoped catalog operations.';

COMMENT ON FUNCTION public.phase5e_validate_product_scope() IS
  'Phase 5H explicit product category tenant/branch validation for branch-scoped catalog operations.';

NOTIFY pgrst, 'reload schema';

COMMIT;
