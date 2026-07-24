-- Prevent browser table writes from bypassing authoritative inventory ledgers.
-- Existing SECURITY DEFINER commercial and stock RPCs continue to execute with
-- their owner privileges and are intentionally not changed here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_item_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity_before numeric(12, 3) NOT NULL,
  quantity_delta numeric(12, 3) NOT NULL,
  quantity_after numeric(12, 3) NOT NULL,
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_item_stock_movements_delta_nonzero
    CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_item_stock_movements_nonnegative
    CHECK (quantity_before >= 0 AND quantity_after >= 0),
  CONSTRAINT inventory_item_stock_movements_balance_consistent
    CHECK (quantity_after = quantity_before + quantity_delta),
  CONSTRAINT inventory_item_stock_movements_reason_nonempty
    CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT inventory_item_stock_movements_idempotency_key_length
    CHECK (length(idempotency_key) BETWEEN 8 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_stock_movements_item_idempotency_idx
  ON public.inventory_item_stock_movements (
    tenant_id,
    branch_id,
    inventory_item_id,
    idempotency_key
  );

CREATE INDEX IF NOT EXISTS inventory_item_stock_movements_item_created_idx
  ON public.inventory_item_stock_movements (inventory_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_inventory_item_stock_movement_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_items ii
    WHERE ii.id = NEW.inventory_item_id
      AND ii.tenant_id = NEW.tenant_id
      AND ii.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Inventory movement scope does not match its inventory item'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.validate_inventory_item_stock_movement_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_inventory_item_stock_movement_scope
  ON public.inventory_item_stock_movements;
CREATE TRIGGER trg_inventory_item_stock_movement_scope
  BEFORE INSERT OR UPDATE OF tenant_id, branch_id, inventory_item_id
  ON public.inventory_item_stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_inventory_item_stock_movement_scope();

ALTER TABLE public.inventory_item_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_item_stock_movements_select
  ON public.inventory_item_stock_movements;
CREATE POLICY inventory_item_stock_movements_select
  ON public.inventory_item_stock_movements
  FOR SELECT
  TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

REVOKE ALL ON TABLE public.inventory_item_stock_movements FROM PUBLIC;
REVOKE ALL ON TABLE public.inventory_item_stock_movements FROM anon;
REVOKE ALL ON TABLE public.inventory_item_stock_movements FROM authenticated;
GRANT SELECT ON TABLE public.inventory_item_stock_movements TO authenticated;
GRANT ALL ON TABLE public.inventory_item_stock_movements TO service_role;

CREATE OR REPLACE FUNCTION public.adjust_inventory_item_stock(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_item record;
  v_existing public.inventory_item_stock_movements%ROWTYPE;
  v_item_id uuid;
  v_adjustment numeric(12, 3);
  v_reason text;
  v_idempotency_key text;
  v_before numeric(12, 3);
  v_after numeric(12, 3);
  v_movement_id uuid;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid inventory adjustment payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN ('inventory_item_id', 'adjustment_quantity', 'reason', 'idempotency_key')
  ) THEN
    RAISE EXCEPTION 'Unsupported inventory adjustment field' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_item_id := NULLIF(btrim(COALESCE(p_payload ->> 'inventory_item_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid inventory item id' USING ERRCODE = '22023';
  END;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'Missing inventory item id' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'adjustment_quantity')
     OR jsonb_typeof(p_payload -> 'adjustment_quantity') <> 'number' THEN
    RAISE EXCEPTION 'Adjustment quantity must be a number' USING ERRCODE = '22023';
  END IF;
  v_adjustment := (p_payload ->> 'adjustment_quantity')::numeric(12, 3);
  IF v_adjustment = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero' USING ERRCODE = '22023';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_payload ->> 'reason', '')), '');
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A stock adjustment reason is required' USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := NULLIF(btrim(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  IF v_idempotency_key IS NULL OR length(v_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'Valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT
      ii.id,
      ii.tenant_id,
      ii.branch_id,
      ii.current_quantity,
      b.is_active AS branch_is_active,
      t.is_active AS tenant_is_active
    INTO v_item
  FROM public.inventory_items ii
  JOIN public.branches b
    ON b.id = ii.branch_id
   AND b.tenant_id = ii.tenant_id
  JOIN public.tenants t ON t.id = ii.tenant_id
  WHERE ii.id = v_item_id
  FOR UPDATE OF ii;

  IF NOT FOUND
     OR v_item.branch_is_active IS NOT TRUE
     OR v_item.tenant_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Inventory item not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_item.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_item.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_item.branch_id THEN
      RAISE EXCEPTION 'Inventory item belongs to another branch' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permission to adjust inventory stock'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.inventory_item_stock_movements
  WHERE tenant_id = v_item.tenant_id
    AND branch_id = v_item.branch_id
    AND inventory_item_id = v_item.id
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing.quantity_delta IS DISTINCT FROM v_adjustment
       OR v_existing.reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'Idempotency key was already used with different adjustment data'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'inventory_item_id', v_existing.inventory_item_id,
      'quantity_before', v_existing.quantity_before,
      'adjustment_quantity', v_existing.quantity_delta,
      'current_quantity', v_existing.quantity_after,
      'movement_id', v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'idempotent_replay', true,
      'created_at', v_existing.created_at
    );
  END IF;

  v_before := COALESCE(v_item.current_quantity, 0);
  v_after := v_before + v_adjustment;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Adjustment would make inventory stock negative'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.inventory_items
  SET current_quantity = v_after,
      updated_at = v_now
  WHERE id = v_item.id
    AND tenant_id = v_item.tenant_id
    AND branch_id = v_item.branch_id;

  INSERT INTO public.inventory_item_stock_movements (
    tenant_id,
    branch_id,
    inventory_item_id,
    quantity_before,
    quantity_delta,
    quantity_after,
    reason,
    idempotency_key,
    created_by,
    created_at
  ) VALUES (
    v_item.tenant_id,
    v_item.branch_id,
    v_item.id,
    v_before,
    v_adjustment,
    v_after,
    v_reason,
    v_idempotency_key,
    v_user_id,
    v_now
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'ok', true,
    'inventory_item_id', v_item.id,
    'quantity_before', v_before,
    'adjustment_quantity', v_adjustment,
    'current_quantity', v_after,
    'movement_id', v_movement_id,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'created_at', v_now
  );
END
$function$;

REVOKE ALL ON FUNCTION public.adjust_inventory_item_stock(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_inventory_item_stock(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_stock(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_stock(jsonb) TO service_role;

-- Table-level grants override column revocations. Replace the broad grants
-- with explicit metadata-only privileges so authoritative balances can be
-- changed only by owner-executed SECURITY DEFINER functions.
REVOKE INSERT, UPDATE ON TABLE public.products FROM authenticated;
GRANT INSERT (
  tenant_id, branch_id, category_id, name, name_ar, description, description_ar,
  sku, barcode, unit, unit_ar, price, cost, tax_rate, tax_category, is_taxable,
  min_stock_alert, image_url, is_active, is_service, vat_treatment, is_available,
  sort_order, notes
) ON public.products TO authenticated;
GRANT UPDATE (
  category_id, name, name_ar, description, description_ar, sku, barcode, unit,
  unit_ar, price, cost, tax_rate, tax_category, is_taxable, min_stock_alert,
  image_url, is_active, is_service, vat_treatment, is_available, sort_order,
  notes, updated_at
) ON public.products TO authenticated;

REVOKE INSERT, UPDATE ON TABLE public.inventory_items FROM authenticated;
GRANT INSERT (
  tenant_id, branch_id, category_id, supplier_id, name, name_ar, unit_type,
  minimum_quantity, unit_cost, notes
) ON public.inventory_items TO authenticated;
GRANT UPDATE (
  category_id, supplier_id, name, name_ar, unit_type, minimum_quantity,
  unit_cost, notes, updated_at
) ON public.inventory_items TO authenticated;

COMMIT;
