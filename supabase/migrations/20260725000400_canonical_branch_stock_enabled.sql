BEGIN;

CREATE OR REPLACE FUNCTION public.branch_effective_stock_enabled(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT
      COALESCE(t.business_type, 'trading') <> 'service'
      AND COALESCE(b.stock_enabled, true)
    FROM public.branches b
    JOIN public.tenants t ON t.id = b.tenant_id
    WHERE b.id = p_branch_id
      AND b.tenant_id = p_tenant_id
  ), false)
$function$;

REVOKE ALL ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) IS
  'Canonical stock rule: service tenants are always disabled; trading branches default NULL to enabled and may explicitly disable stock.';

DO $patch_stock_functions$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  -- A service tenant may never opt a branch back into stock.
  v_signature := 'public.update_branch_module_settings(uuid,boolean)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%Service businesses cannot enable the stock module%' THEN
    v_old := $needle$  UPDATE public.branches
  SET stock_enabled = p_stock_enabled,$needle$;
    v_new := $replacement$  IF p_stock_enabled IS TRUE
     AND EXISTS (
       SELECT 1
       FROM public.tenants t
       WHERE t.id = v_branch.tenant_id
         AND COALESCE(t.business_type, 'trading') = 'service'
     )
  THEN
    RAISE EXCEPTION 'Service businesses cannot enable the stock module'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.branches
  SET stock_enabled = p_stock_enabled,$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_PATCH_TARGET_MISSING:%', v_signature;
    END IF;
    EXECUTE v_patched;
  END IF;

  -- Checkout remains commercially identical, but disabled stock is treated as
  -- untracked for both the balance update and its movement ledger.
  v_signature := 'public.pos_checkout(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%branch_effective_stock_enabled(v_branch.tenant_id, v_branch.id)%' THEN
    v_old := $needle$    IF COALESCE(v_product.track_stock, FALSE) IS TRUE
       AND COALESCE(v_product.is_service, FALSE) IS FALSE
    THEN$needle$;
    v_new := $replacement$    IF public.branch_effective_stock_enabled(v_branch.tenant_id, v_branch.id)
       AND COALESCE(v_product.track_stock, FALSE) IS TRUE
       AND COALESCE(v_product.is_service, FALSE) IS FALSE
    THEN$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_CHECKOUT_DEDUCTION_TARGET_MISSING';
    END IF;
    v_definition := v_patched;

    v_old := $needle$    IF (v_line ->> 'track_stock')::boolean IS TRUE THEN$needle$;
    v_new := $replacement$    IF public.branch_effective_stock_enabled(v_branch.tenant_id, v_branch.id)
       AND (v_line ->> 'track_stock')::boolean IS TRUE
    THEN$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_CHECKOUT_LEDGER_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;

  -- A disabled branch can still issue a credit note, but it cannot mutate stock.
  v_signature := 'public.create_partial_credit_note(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)%' THEN
    v_old := $needle$  v_effective_return_stock := v_return_stock AND COALESCE(v_tenant_business_type, 'trading') <> 'service';$needle$;
    v_new := $replacement$  v_effective_return_stock :=
    v_return_stock
    AND COALESCE(v_tenant_business_type, 'trading') <> 'service'
    AND public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id);$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_CREDIT_NOTE_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;

  -- The refundable-item contract reports stock eligibility, not merely the
  -- product's persisted tracking flag.
  v_signature := 'public.get_invoice_refundable_items(uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)%' THEN
    v_old := $needle$    COALESCE(p.track_stock, FALSE) AS track_stock,$needle$;
    v_new := $replacement$    (
      public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)
      AND COALESCE(p.track_stock, FALSE)
    ) AS track_stock,$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_REFUNDABLE_ITEMS_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;

  -- Inventory-item adjustments use the same branch gate as product stock.
  v_signature := 'public.adjust_inventory_item_stock(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%Stock module is disabled for this branch%' THEN
    v_old := $needle$  SELECT *
    INTO v_existing
  FROM public.inventory_item_stock_movements$needle$;
    v_new := $replacement$  IF public.branch_effective_stock_enabled(v_item.tenant_id, v_item.branch_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.inventory_item_stock_movements$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_INVENTORY_ADJUSTMENT_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;

  -- Guard the public receiving entry point before it can normalize purchase
  -- state, and guard the internal implementation before any stock mutation.
  v_signature := 'public.confirm_purchase_receiving(uuid,boolean)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%branch_effective_stock_enabled(v_purchase.tenant_id, v_purchase.branch_id)%' THEN
    v_old := $needle$  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN$needle$;
    v_new := $replacement$  IF public.branch_effective_stock_enabled(v_purchase.tenant_id, v_purchase.branch_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_PURCHASE_CONFIRM_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;

  v_signature := 'public.confirm_purchase_receiving_unchecked(uuid,boolean)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  IF v_definition NOT LIKE '%branch_effective_stock_enabled(v_purchase.tenant_id, v_purchase.branch_id)%' THEN
    v_old := $needle$  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN$needle$;
    v_new := $replacement$  IF public.branch_effective_stock_enabled(v_purchase.tenant_id, v_purchase.branch_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'STOCK_RULE_PURCHASE_UNCHECKED_TARGET_MISSING';
    END IF;
    EXECUTE v_patched;
  END IF;
END
$patch_stock_functions$;

-- Reassert the intended execution surface after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.update_branch_module_settings(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_module_settings(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_invoice_refundable_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_inventory_item_stock(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_stock(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_purchase_receiving(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_purchase_receiving_unchecked(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving_unchecked(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
