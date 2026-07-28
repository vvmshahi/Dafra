-- ============================================================
-- Phase 5M: Product Stock Receipts
-- Apply manually after Phase 5L product stock tracking controls.
-- ============================================================
--
-- Goals:
--   - Add audited product stock receipt records for saleable products.
--   - Keep products.stock_quantity as the POS stock source of truth.
--   - Update products.cost to the latest received unit cost.
--   - Keep inventory_items and purchase receiving separate.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not change POS checkout math.
--   - Do not merge inventory_items purchasing stock with products stock.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_stock_receipts (
  id              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_id     UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  quantity        NUMERIC(12, 3) NOT NULL,
  unit_cost       NUMERIC(12, 2) NOT NULL,
  total_cost      NUMERIC(12, 2) NOT NULL,
  idempotency_key TEXT NOT NULL,
  note            TEXT,
  reference       TEXT,
  created_by      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_stock_receipts_quantity_positive CHECK (quantity > 0),
  CONSTRAINT product_stock_receipts_unit_cost_nonnegative CHECK (unit_cost >= 0),
  CONSTRAINT product_stock_receipts_total_cost_nonnegative CHECK (total_cost >= 0),
  CONSTRAINT product_stock_receipts_idempotency_key_length CHECK (
    length(idempotency_key) BETWEEN 8 AND 120
  )
);

CREATE INDEX IF NOT EXISTS product_stock_receipts_branch_created_idx
  ON public.product_stock_receipts (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS product_stock_receipts_product_created_idx
  ON public.product_stock_receipts (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS product_stock_receipts_supplier_created_idx
  ON public.product_stock_receipts (supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_stock_receipts_product_idempotency_key_idx
  ON public.product_stock_receipts (tenant_id, branch_id, product_id, idempotency_key);

ALTER TABLE public.product_stock_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_stock_receipts FROM PUBLIC, anon;
GRANT ALL PRIVILEGES ON TABLE public.product_stock_receipts TO service_role;

COMMENT ON TABLE public.product_stock_receipts IS
  'Audited lightweight product stock receipts for saleable products. Separate from inventory_items purchase receiving.';

COMMENT ON COLUMN public.product_stock_receipts.idempotency_key IS
  'Replay-protection key for one intentional product stock receipt.';

CREATE OR REPLACE FUNCTION public.receive_product_stock(
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
  v_supplier RECORD;
  v_existing_receipt RECORD;
  v_receipt_id UUID := pg_catalog.gen_random_uuid();
  v_product_id UUID;
  v_supplier_id UUID;
  v_product_id_text TEXT;
  v_supplier_id_text TEXT;
  v_quantity NUMERIC(12, 3);
  v_unit_cost NUMERIC(12, 2);
  v_total_cost NUMERIC(12, 2);
  v_idempotency_key TEXT;
  v_note TEXT;
  v_reference TEXT;
  v_before_quantity NUMERIC(12, 3);
  v_after_quantity NUMERIC(12, 3);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product stock receipt payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'supplier_id',
      'quantity',
      'unit_cost',
      'idempotency_key',
      'note',
      'reference'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product stock receipt field' USING ERRCODE = '22023';
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

  v_supplier_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '');
  IF v_supplier_id_text IS NOT NULL THEN
    BEGIN
      v_supplier_id := v_supplier_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid supplier id' USING ERRCODE = '22023';
    END;
  END IF;

  IF NOT (p_payload ? 'quantity') OR jsonb_typeof(p_payload -> 'quantity') <> 'number' THEN
    RAISE EXCEPTION 'Quantity received must be a number' USING ERRCODE = '22023';
  END IF;

  v_quantity := (p_payload ->> 'quantity')::NUMERIC(12, 3);
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity received must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'unit_cost') OR jsonb_typeof(p_payload -> 'unit_cost') <> 'number' THEN
    RAISE EXCEPTION 'Unit purchase cost must be a number' USING ERRCODE = '22023';
  END IF;

  v_unit_cost := (p_payload ->> 'unit_cost')::NUMERIC(12, 2);
  IF v_unit_cost < 0 THEN
    RAISE EXCEPTION 'Unit purchase cost must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(TRIM(COALESCE(p_payload ->> 'note', '')), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;

  v_reference := NULLIF(TRIM(COALESCE(p_payload ->> 'reference', '')), '');
  IF v_reference IS NOT NULL AND length(v_reference) > 120 THEN
    RAISE EXCEPTION 'Reference is too long' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Insufficient permission to receive product stock' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
    RAISE EXCEPTION 'Product stock receiving is not available for service businesses'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.stock_enabled, TRUE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.track_stock, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Product must track stock before receiving stock'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.is_service, FALSE) IS TRUE THEN
    RAISE EXCEPTION 'Service products cannot receive stock'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier_id IS NOT NULL THEN
    SELECT id, tenant_id, branch_id, is_active
      INTO v_supplier
    FROM public.suppliers
    WHERE id = v_supplier_id;

    IF NOT FOUND OR v_supplier.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Supplier not found or inactive' USING ERRCODE = '42501';
    END IF;

    IF v_supplier.tenant_id IS DISTINCT FROM v_product.tenant_id
       OR v_supplier.branch_id IS DISTINCT FROM v_product.branch_id
    THEN
      RAISE EXCEPTION 'Supplier belongs to another branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
    INTO v_existing_receipt
  FROM public.product_stock_receipts
  WHERE tenant_id = v_product.tenant_id
    AND branch_id = v_product.branch_id
    AND product_id = v_product.id
    AND idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'receipt_id', v_existing_receipt.id,
      'product_id', v_existing_receipt.product_id,
      'supplier_id', v_existing_receipt.supplier_id,
      'quantity', v_existing_receipt.quantity,
      'unit_cost', v_existing_receipt.unit_cost,
      'total_cost', v_existing_receipt.total_cost,
      'stock_quantity_before', COALESCE(v_product.stock_quantity, 0) - v_existing_receipt.quantity,
      'stock_quantity', COALESCE(v_product.stock_quantity, 0),
      'idempotency_key', v_existing_receipt.idempotency_key,
      'idempotent_replay', true,
      'created_at', v_existing_receipt.created_at
    );
  END IF;

  v_before_quantity := COALESCE(v_product.stock_quantity, 0);
  v_after_quantity := v_before_quantity + v_quantity;
  v_total_cost := round(v_quantity * v_unit_cost, 2);

  UPDATE public.products
  SET stock_quantity = v_after_quantity,
      cost = v_unit_cost,
      updated_at = v_now
  WHERE id = v_product.id;

  INSERT INTO public.product_stock_receipts (
    id,
    tenant_id,
    branch_id,
    product_id,
    supplier_id,
    quantity,
    unit_cost,
    total_cost,
    idempotency_key,
    note,
    reference,
    created_by,
    created_at
  ) VALUES (
    v_receipt_id,
    v_product.tenant_id,
    v_product.branch_id,
    v_product.id,
    v_supplier_id,
    v_quantity,
    v_unit_cost,
    v_total_cost,
    v_idempotency_key,
    v_note,
    v_reference,
    v_user_id,
    v_now
  );

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
    v_quantity,
    'stock_receipt',
    v_user_id,
    v_now,
    v_idempotency_key
  );

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_receipt_id,
    'product_id', v_product.id,
    'supplier_id', v_supplier_id,
    'quantity', v_quantity,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'stock_quantity_before', v_before_quantity,
    'stock_quantity', v_after_quantity,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'created_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_product_stock(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(JSONB) TO authenticated;

COMMENT ON FUNCTION public.receive_product_stock(JSONB) IS
  'Receives stock for an existing tracked saleable product, updates products.stock_quantity and latest cost, and records an audited product stock receipt.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm table and function exist:
--
-- SELECT
--   to_regclass('public.product_stock_receipts') IS NOT NULL AS receipts_table_exists,
--   to_regprocedure('public.receive_product_stock(jsonb)') IS NOT NULL AS rpc_exists,
--   has_function_privilege('authenticated', 'public.receive_product_stock(jsonb)', 'EXECUTE') AS authenticated_can_receive_product_stock;
--
-- 2) Confirm idempotency index:
--
-- SELECT to_regclass('public.product_stock_receipts_product_idempotency_key_idx') AS receipt_idempotency_idx;
