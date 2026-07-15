-- ============================================================
-- Phase 5L: Product Stock Tracking Controls
-- Apply manually after Phase 5F branch stock module toggle.
-- ============================================================
--
-- Goals:
--   - Add a narrow RPC for audited POS product stock tracking changes.
--   - Keep products.stock_quantity as the POS stock source of truth.
--   - Record opening stock and manual stock changes in pos_stock_movements.
--   - Preserve the separate inventory_items purchase receiving system.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not change POS checkout math.
--   - Do not merge inventory_items purchasing stock with products stock.

BEGIN;

ALTER TABLE public.pos_stock_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pos_stock_movements_product_idempotency_key_idx
  ON public.pos_stock_movements (tenant_id, branch_id, product_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.pos_stock_movements.idempotency_key IS
  'Optional replay-protection key for browser-initiated manual POS product stock adjustments.';

CREATE OR REPLACE FUNCTION public.update_product_stock_settings(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_product RECORD;
  v_product_id UUID;
  v_product_id_text TEXT;
  v_has_track_stock BOOLEAN := FALSE;
  v_has_opening_stock BOOLEAN := FALSE;
  v_has_adjustment BOOLEAN := FALSE;
  v_requested_track_stock BOOLEAN;
  v_opening_stock_quantity NUMERIC(12, 3);
  v_adjustment_quantity NUMERIC(12, 3);
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_existing_movement RECORD;
  v_before_quantity NUMERIC(12, 3);
  v_after_quantity NUMERIC(12, 3);
  v_final_track_stock BOOLEAN;
  v_stock_module_enabled BOOLEAN;
  v_opening_movement_exists BOOLEAN := FALSE;
  v_movement_count INTEGER := 0;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid stock settings payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'track_stock',
      'opening_stock_quantity',
      'adjustment_quantity',
      'idempotency_key',
      'reason'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported stock setting' USING ERRCODE = '22023';
  END IF;

  v_product_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'product_id', '')), '');
  IF v_product_id_text IS NULL THEN
    RAISE EXCEPTION 'Missing product id' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := v_product_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id' USING ERRCODE = '22023';
  END;

  v_has_track_stock := p_payload ? 'track_stock';
  IF v_has_track_stock AND jsonb_typeof(p_payload -> 'track_stock') <> 'boolean' THEN
    RAISE EXCEPTION 'track_stock must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF v_has_track_stock THEN
    v_requested_track_stock := (p_payload ->> 'track_stock')::BOOLEAN;
  END IF;

  v_has_opening_stock := (p_payload ? 'opening_stock_quantity')
    AND jsonb_typeof(p_payload -> 'opening_stock_quantity') <> 'null';
  IF v_has_opening_stock
     AND jsonb_typeof(p_payload -> 'opening_stock_quantity') <> 'number'
  THEN
    RAISE EXCEPTION 'Opening stock must be a number' USING ERRCODE = '22023';
  END IF;

  IF v_has_opening_stock THEN
    v_opening_stock_quantity := (p_payload ->> 'opening_stock_quantity')::NUMERIC(12, 3);
    IF v_opening_stock_quantity < 0 THEN
      RAISE EXCEPTION 'Opening stock must be zero or higher' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_has_adjustment := (p_payload ? 'adjustment_quantity')
    AND jsonb_typeof(p_payload -> 'adjustment_quantity') <> 'null';
  IF v_has_adjustment
     AND jsonb_typeof(p_payload -> 'adjustment_quantity') <> 'number'
  THEN
    RAISE EXCEPTION 'Adjustment quantity must be a number' USING ERRCODE = '22023';
  END IF;

  IF v_has_adjustment THEN
    v_adjustment_quantity := (p_payload ->> 'adjustment_quantity')::NUMERIC(12, 3);
    IF v_adjustment_quantity = 0 THEN
      RAISE EXCEPTION 'Adjustment quantity cannot be zero' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  IF v_has_adjustment THEN
    IF v_idempotency_key IS NULL
       OR length(v_idempotency_key) < 8
       OR length(v_idempotency_key) > 120
    THEN
      RAISE EXCEPTION 'Valid idempotency key is required for manual stock adjustments'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION 'idempotency_key is only supported for manual stock adjustments'
      USING ERRCODE = '22023';
  END IF;

  v_reason := NULLIF(TRIM(COALESCE(p_payload ->> 'reason', '')), '');
  IF v_reason IS NOT NULL
     AND v_reason NOT IN ('opening_stock', 'manual_adjustment', 'tracking_enabled', 'tracking_disabled')
  THEN
    RAISE EXCEPTION 'Unsupported stock adjustment reason' USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_track_stock AND NOT v_has_adjustment THEN
    RAISE EXCEPTION 'At least one stock setting is required' USING ERRCODE = '22023';
  END IF;

  IF v_has_adjustment AND v_has_track_stock AND v_requested_track_stock IS FALSE THEN
    RAISE EXCEPTION 'Adjust stock before disabling tracking' USING ERRCODE = '23514';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT
      p.id,
      p.tenant_id,
      p.branch_id,
      p.name,
      p.track_stock,
      p.stock_quantity,
      p.is_service,
      p.is_active,
      b.is_active AS branch_is_active,
      b.stock_enabled,
      t.is_active AS tenant_is_active,
      COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.branches b ON b.id = p.branch_id
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.tenant_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Business account is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_product.branch_id
    THEN
      RAISE EXCEPTION 'Product belongs to another branch' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permission to update product stock' USING ERRCODE = '42501';
  END IF;

  v_final_track_stock := COALESCE(v_requested_track_stock, COALESCE(v_product.track_stock, FALSE));
  v_before_quantity := COALESCE(v_product.stock_quantity, 0);
  v_after_quantity := v_before_quantity;

  IF v_final_track_stock IS TRUE OR v_has_adjustment THEN
    IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
      RAISE EXCEPTION 'Product stock tracking is not available for service businesses'
        USING ERRCODE = '23514';
    END IF;

    v_stock_module_enabled := COALESCE(v_product.stock_enabled, TRUE);
    IF v_stock_module_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Stock module is disabled for this branch'
        USING ERRCODE = '23514';
    END IF;

    IF COALESCE(v_product.is_service, FALSE) IS TRUE THEN
      RAISE EXCEPTION 'Service products cannot track stock'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_has_adjustment AND COALESCE(v_product.track_stock, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Enable stock tracking before adjusting stock'
      USING ERRCODE = '23514';
  END IF;

  IF v_has_adjustment THEN
    SELECT id, quantity_delta, created_at
      INTO v_existing_movement
    FROM public.pos_stock_movements
    WHERE tenant_id = v_product.tenant_id
      AND branch_id = v_product.branch_id
      AND product_id = v_product.id
      AND idempotency_key = v_idempotency_key
      AND reason = 'manual_adjustment'
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'product_id', v_product.id,
        'track_stock', COALESCE(v_product.track_stock, FALSE),
        'stock_quantity_before', COALESCE(v_product.stock_quantity, 0) - v_existing_movement.quantity_delta,
        'stock_quantity', COALESCE(v_product.stock_quantity, 0),
        'movement_count', 0,
        'idempotency_key', v_idempotency_key,
        'idempotent_replay', true,
        'updated_at', v_existing_movement.created_at
      );
    END IF;
  END IF;

  IF v_has_track_stock AND v_requested_track_stock IS TRUE THEN
    IF COALESCE(v_product.track_stock, FALSE) IS FALSE THEN
      IF NOT v_has_opening_stock THEN
        RAISE EXCEPTION 'Opening stock is required when enabling tracking'
          USING ERRCODE = '22023';
      END IF;

      v_after_quantity := v_opening_stock_quantity;

      SELECT EXISTS (
        SELECT 1
        FROM public.pos_stock_movements
        WHERE product_id = v_product.id
          AND tenant_id = v_product.tenant_id
          AND branch_id = v_product.branch_id
          AND reason = 'opening_stock'
      )
        INTO v_opening_movement_exists;

      UPDATE public.products
      SET track_stock = TRUE,
          stock_quantity = v_after_quantity,
          updated_at = v_updated_at
      WHERE id = v_product.id;

      IF v_opening_movement_exists IS FALSE THEN
        INSERT INTO public.pos_stock_movements (
          tenant_id,
          branch_id,
          product_id,
          invoice_id,
          quantity_delta,
          reason,
          created_by,
          created_at
        ) VALUES (
          v_product.tenant_id,
          v_product.branch_id,
          v_product.id,
          NULL,
          v_after_quantity - v_before_quantity,
          'opening_stock',
          v_user_id,
          v_updated_at
        );
        v_movement_count := v_movement_count + 1;
      ELSIF v_after_quantity IS DISTINCT FROM v_before_quantity THEN
        INSERT INTO public.pos_stock_movements (
          tenant_id,
          branch_id,
          product_id,
          invoice_id,
          quantity_delta,
          reason,
          created_by,
          created_at
        ) VALUES (
          v_product.tenant_id,
          v_product.branch_id,
          v_product.id,
          NULL,
          v_after_quantity - v_before_quantity,
          'manual_adjustment',
          v_user_id,
          v_updated_at
        );
        v_movement_count := v_movement_count + 1;
      END IF;
    ELSE
      IF v_has_opening_stock AND v_opening_stock_quantity IS DISTINCT FROM v_before_quantity THEN
        RAISE EXCEPTION 'Use Adjust Stock to change stock for an already tracked product'
          USING ERRCODE = '23514';
      END IF;

      UPDATE public.products
      SET track_stock = TRUE,
          updated_at = v_updated_at
      WHERE id = v_product.id;
    END IF;
  ELSIF v_has_track_stock AND v_requested_track_stock IS FALSE THEN
    UPDATE public.products
    SET track_stock = FALSE,
        updated_at = v_updated_at
    WHERE id = v_product.id;

    v_final_track_stock := FALSE;
    v_after_quantity := v_before_quantity;
  END IF;

  IF v_has_adjustment THEN
    v_after_quantity := v_after_quantity + v_adjustment_quantity;

    IF v_after_quantity < 0 THEN
      RAISE EXCEPTION 'Adjustment would make stock negative' USING ERRCODE = '23514';
    END IF;

    UPDATE public.products
    SET stock_quantity = v_after_quantity,
        updated_at = v_updated_at
    WHERE id = v_product.id;

    INSERT INTO public.pos_stock_movements (
      tenant_id,
      branch_id,
      product_id,
      invoice_id,
      quantity_delta,
      reason,
      created_by,
      created_at,
      idempotency_key
    ) VALUES (
      v_product.tenant_id,
      v_product.branch_id,
      v_product.id,
      NULL,
      v_adjustment_quantity,
      'manual_adjustment',
      v_user_id,
      v_updated_at,
      v_idempotency_key
    );

    v_movement_count := v_movement_count + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product.id,
    'track_stock', v_final_track_stock,
    'stock_quantity_before', v_before_quantity,
    'stock_quantity', v_after_quantity,
    'movement_count', v_movement_count,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_stock_settings(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product_stock_settings(JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_product_stock_settings(JSONB) IS
  'Safely updates POS product stock tracking and audited stock quantity changes without broad browser stock writes.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm function exists and is executable:
--
-- SELECT
--   to_regprocedure('public.update_product_stock_settings(jsonb)') IS NOT NULL AS rpc_exists,
--   has_function_privilege('authenticated', 'public.update_product_stock_settings(jsonb)', 'EXECUTE') AS authenticated_can_update_product_stock;
--
-- 2) Confirm no table/RLS policy changes were introduced by this patch.
--
