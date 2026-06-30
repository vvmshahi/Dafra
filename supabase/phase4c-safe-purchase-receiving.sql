-- ============================================================
-- Phase 4C safe purchase receiving confirmation + reversal
-- Apply manually after Phase 4B delete permission fix.
-- ============================================================
--
-- Goals:
--   - Stop new purchase_items inserts from increasing stock automatically.
--   - Move stock receiving to explicit SECURITY DEFINER RPCs.
--   - Preserve existing historical stock quantities.
--   - Record movement rows for every Phase 4C receive/reverse action.
--   - Prepare purchase lines for future AI/OCR review without implementing AI.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not delete existing purchases, purchase_items, or inventory.
--   - Do not modify existing stock quantities.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.
--
-- Historical behavior:
--   Existing detailed purchases may already have increased stock through
--   trg_purchase_item_update_stock. This patch drops that trigger only for
--   future inserts and does not recalculate or reverse historical stock.
--
-- New behavior:
--   - Simple Bill: no purchase_items, no stock movement.
--   - Receive Stock: insert purchase header/items with receiving_status =
--     pending_confirmation. Stock changes only when
--     public.confirm_purchase_receiving(...) succeeds.
--   - Unlinked/non-stock lines remain bill detail and are skipped for stock.
--
-- Future AI/OCR compatibility:
--   AI should create draft/pending purchase rows and purchase_items only.
--   AI must never call stock update logic. Human review must use the same
--   public.confirm_purchase_receiving(...) RPC.

BEGIN;

-- ============================================================
-- Disable legacy automatic stock update trigger for future rows
-- ============================================================

DROP TRIGGER IF EXISTS trg_purchase_item_update_stock ON public.purchase_items;

DO $$
BEGIN
  IF to_regprocedure('public.fn_purchase_item_update_stock()') IS NOT NULL THEN
    EXECUTE $sql$
      COMMENT ON FUNCTION public.fn_purchase_item_update_stock() IS
        'Legacy automatic purchase item stock trigger function. Phase 4C drops its trigger; stock receiving now goes through confirm_purchase_receiving.'
    $sql$;
  END IF;
END $$;

-- ============================================================
-- Purchase receiving metadata
-- ============================================================

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS receiving_status TEXT NOT NULL DEFAULT 'not_applicable';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS supplier_item_name TEXT;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'stock';

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS receiving_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2);

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(5, 2);

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS match_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_receiving_status_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_receiving_status_check
      CHECK (
        receiving_status IN (
          'not_applicable',
          'draft',
          'pending_confirmation',
          'confirmed',
          'cancelled',
          'reversed',
          'confirmed_legacy'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_items_line_type_check'
      AND conrelid = 'public.purchase_items'::regclass
  ) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_line_type_check
      CHECK (line_type IN ('stock', 'non_stock', 'unmatched', 'ignored')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_items_receiving_status_check'
      AND conrelid = 'public.purchase_items'::regclass
  ) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_receiving_status_check
      CHECK (receiving_status IN ('pending', 'confirmed', 'skipped', 'cancelled', 'reversed')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_items_match_source_check'
      AND conrelid = 'public.purchase_items'::regclass
  ) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_match_source_check
      CHECK (match_source IN ('manual', 'ai', 'mapping', 'none')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.purchases.receiving_status IS
  'Stock receiving lifecycle independent of accounting status. New detailed purchases start pending_confirmation and stock changes only through confirm_purchase_receiving.';

COMMENT ON COLUMN public.purchase_items.supplier_item_name IS
  'Supplier bill item name, kept separate from the internal stock item name for future AI/OCR and supplier mapping.';

COMMENT ON COLUMN public.purchase_items.line_type IS
  'stock lines may affect inventory after confirmation; non_stock/unmatched/ignored lines remain bill detail only.';

COMMENT ON COLUMN public.purchase_items.match_source IS
  'How an internal item match was selected: manual, ai, mapping, or none. AI matches must still be human-confirmed before receiving.';

CREATE INDEX IF NOT EXISTS purchases_branch_receiving_status_idx
  ON public.purchases (branch_id, receiving_status, purchase_date DESC);

CREATE INDEX IF NOT EXISTS purchase_items_receiving_status_idx
  ON public.purchase_items (purchase_id, receiving_status);

CREATE INDEX IF NOT EXISTS purchase_items_inventory_receiving_idx
  ON public.purchase_items (inventory_item_id, receiving_status)
  WHERE inventory_item_id IS NOT NULL;

-- ============================================================
-- Phase 4C stock movement ledger
-- ============================================================

CREATE TABLE IF NOT EXISTS public.purchase_stock_movements (
  id                 UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id          UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  purchase_id        UUID NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  purchase_item_id   UUID REFERENCES public.purchase_items(id) ON DELETE RESTRICT,
  inventory_item_id  UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity_delta     NUMERIC(12, 3) NOT NULL,
  unit_cost          NUMERIC(12, 2),
  reason             TEXT NOT NULL,
  reversal_of        UUID REFERENCES public.purchase_stock_movements(id) ON DELETE RESTRICT,
  created_by         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_stock_movements_quantity_nonzero CHECK (quantity_delta <> 0),
  CONSTRAINT purchase_stock_movements_reason_check
    CHECK (reason IN ('purchase_receiving_confirmed', 'purchase_receiving_reversed'))
);

CREATE INDEX IF NOT EXISTS purchase_stock_movements_purchase_idx
  ON public.purchase_stock_movements (purchase_id, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_stock_movements_inventory_idx
  ON public.purchase_stock_movements (inventory_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_stock_movements_branch_idx
  ON public.purchase_stock_movements (branch_id, created_at DESC);

ALTER TABLE public.purchase_stock_movements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.purchase_stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.purchase_stock_movements TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.purchase_stock_movements TO service_role;

DROP POLICY IF EXISTS phase4c_purchase_stock_movements_select ON public.purchase_stock_movements;
DROP POLICY IF EXISTS phase4c_purchase_stock_movements_service_all ON public.purchase_stock_movements;

CREATE POLICY phase4c_purchase_stock_movements_select
  ON public.purchase_stock_movements
  FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

CREATE POLICY phase4c_purchase_stock_movements_service_all
  ON public.purchase_stock_movements
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.purchase_stock_movements IS
  'Phase 4C stock movement ledger for confirmed and reversed purchase receiving. Browser users read only; writes go through receiving RPCs.';

-- ============================================================
-- Future supplier item mapping placeholder
-- ============================================================

CREATE TABLE IF NOT EXISTS public.supplier_item_mappings (
  id                         UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id                  UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id                UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_item_name         TEXT NOT NULL,
  normalized_name            TEXT NOT NULL,
  matched_inventory_item_id  UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  matched_product_id         UUID REFERENCES public.products(id) ON DELETE SET NULL,
  match_confidence           NUMERIC(5, 2),
  confirmation_status        TEXT NOT NULL DEFAULT 'manual_confirmed',
  confirmed_by               UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  last_used_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_item_mappings_confirmation_status_check
    CHECK (confirmation_status IN ('ai_suggested', 'manual_confirmed', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_item_mappings_supplier_name_idx
  ON public.supplier_item_mappings (tenant_id, branch_id, supplier_id, normalized_name)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_item_mappings_branch_idx
  ON public.supplier_item_mappings (branch_id, last_used_at DESC NULLS LAST);

ALTER TABLE public.supplier_item_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supplier_item_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_item_mappings TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.supplier_item_mappings TO service_role;

DROP POLICY IF EXISTS phase4c_supplier_item_mappings_select ON public.supplier_item_mappings;
DROP POLICY IF EXISTS phase4c_supplier_item_mappings_service_all ON public.supplier_item_mappings;

CREATE POLICY phase4c_supplier_item_mappings_select
  ON public.supplier_item_mappings
  FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

CREATE POLICY phase4c_supplier_item_mappings_service_all
  ON public.supplier_item_mappings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.supplier_item_mappings IS
  'Future AI/OCR supplier item mapping table. Phase 4C creates it read-only for browser users; later phases should add safe RPCs for confirmation/override.';

-- ============================================================
-- Narrow direct browser mutation grants for purchase state
-- ============================================================

REVOKE UPDATE, DELETE ON TABLE public.purchases FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.purchases FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.purchase_items FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.purchase_items FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.purchases TO authenticated;
GRANT SELECT, INSERT ON TABLE public.purchase_items TO authenticated;

-- ============================================================
-- RPC helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_purchase_receiving(
  p_purchase_id UUID,
  p_confirm BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_line RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_total_lines INTEGER := 0;
  v_stock_lines INTEGER := 0;
  v_skipped_lines INTEGER := 0;
  v_total_quantity NUMERIC(12, 3) := 0;
  v_inventory_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Receiving confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receiving:' || p_purchase_id::text, 0));

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to receive this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to receive this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to receive this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases can be confirmed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled' THEN
    RAISE EXCEPTION 'This purchase is cancelled and cannot be received.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') NOT IN ('draft', 'pending_confirmation') THEN
    IF v_purchase.receiving_status = 'confirmed' THEN
      RAISE EXCEPTION 'This purchase receiving has already been confirmed.'
        USING ERRCODE = '23514';
    END IF;

    RAISE EXCEPTION 'This purchase is not pending receiving confirmation.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
  ) THEN
    RAISE EXCEPTION 'This purchase receiving has already been confirmed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_total_lines
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_total_lines = 0 THEN
    RAISE EXCEPTION 'Add purchase item lines before confirming receiving.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_stock_lines
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id
    AND pi.inventory_item_id IS NOT NULL
    AND COALESCE(pi.line_type, 'stock') = 'stock'
    AND COALESCE(pi.quantity, 0) > 0;

  IF v_stock_lines = 0 THEN
    RAISE EXCEPTION 'At least one linked stock item is required before confirming receiving.'
      USING ERRCODE = '23514';
  END IF;

  v_stock_lines := 0;

  FOR v_line IN
    SELECT pi.*
    FROM public.purchase_items pi
    WHERE pi.purchase_id = v_purchase.id
    ORDER BY pi.created_at, pi.id
    FOR UPDATE
  LOOP
    IF COALESCE(v_line.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'Purchase line quantity must be greater than zero.'
        USING ERRCODE = '23514';
    END IF;

    IF v_line.inventory_item_id IS NOT NULL
       AND COALESCE(v_line.line_type, 'stock') = 'stock'
    THEN
      UPDATE public.inventory_items ii
      SET current_quantity = COALESCE(ii.current_quantity, 0) + v_line.quantity,
          unit_cost = CASE
            WHEN COALESCE(v_line.unit_cost, 0) > 0 THEN v_line.unit_cost
            ELSE ii.unit_cost
          END,
          updated_at = v_now
      WHERE ii.id = v_line.inventory_item_id
        AND ii.tenant_id = v_purchase.tenant_id
        AND ii.branch_id = v_purchase.branch_id
      RETURNING ii.id INTO v_inventory_id;

      IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Linked stock item was not found in this branch.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.purchase_stock_movements (
        tenant_id,
        branch_id,
        purchase_id,
        purchase_item_id,
        inventory_item_id,
        quantity_delta,
        unit_cost,
        reason,
        created_by,
        created_at
      ) VALUES (
        v_purchase.tenant_id,
        v_purchase.branch_id,
        v_purchase.id,
        v_line.id,
        v_line.inventory_item_id,
        v_line.quantity,
        v_line.unit_cost,
        'purchase_receiving_confirmed',
        v_user_id,
        v_now
      );

      UPDATE public.purchase_items
      SET receiving_status = 'confirmed',
          received_quantity = v_line.quantity,
          confirmed_at = v_now
      WHERE id = v_line.id;

      v_stock_lines := v_stock_lines + 1;
      v_total_quantity := v_total_quantity + v_line.quantity;
    ELSE
      UPDATE public.purchase_items
      SET receiving_status = 'skipped',
          received_quantity = 0,
          confirmed_at = v_now
      WHERE id = v_line.id;

      v_skipped_lines := v_skipped_lines + 1;
    END IF;
  END LOOP;

  UPDATE public.purchases
  SET receiving_status = 'confirmed',
      status = CASE WHEN status = 'draft' THEN 'posted' ELSE status END,
      received_at = v_now,
      received_by = v_user_id,
      updated_at = v_now
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_receiving_confirmed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'stock_lines_confirmed', v_stock_lines,
      'lines_skipped', v_skipped_lines,
      'total_quantity_received', v_total_quantity,
      'has_bill_number', v_purchase.bill_number IS NOT NULL,
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'receiving_status', 'confirmed',
    'stock_lines_confirmed', v_stock_lines,
    'lines_skipped', v_skipped_lines,
    'total_quantity_received', v_total_quantity
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_receiving(
  p_purchase_id UUID,
  p_reason TEXT,
  p_confirm BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_movement RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_reversed_lines INTEGER := 0;
  v_reversed_quantity NUMERIC(12, 3) := 0;
  v_available_quantity NUMERIC(12, 3);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel/reversal confirmation is required' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A cancellation or reversal reason is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receiving:' || p_purchase_id::text, 0));

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases can use this cancel/reversal flow.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('cancelled', 'reversed') THEN
    RAISE EXCEPTION 'This purchase receiving is already cancelled or reversed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('draft', 'pending_confirmation') THEN
    UPDATE public.purchase_items
    SET receiving_status = 'cancelled'
    WHERE purchase_id = v_purchase.id
      AND receiving_status = 'pending';

    UPDATE public.purchases
    SET receiving_status = 'cancelled',
        status = 'cancelled',
        cancelled_at = v_now,
        cancelled_by = v_user_id,
        cancellation_reason = v_reason,
        updated_at = v_now
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_receiving_cancelled',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'warning',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'receiving_status_before', v_purchase.receiving_status,
        'reason_length', length(v_reason),
        'stock_changed', false,
        'total_amount', v_purchase.total_amount
      ),
      NULL,
      NULL
    );

    RETURN jsonb_build_object(
      'ok', true,
      'purchase_id', v_purchase.id,
      'receiving_status', 'cancelled',
      'stock_changed', false
    );
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') <> 'confirmed' THEN
    RAISE EXCEPTION 'This purchase receiving is not confirmed and cannot be reversed.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
  ) THEN
    RAISE EXCEPTION 'This received purchase has no Phase 4C stock movement records. Use a manual inventory adjustment.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_movement IN
    SELECT psm.*
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.purchase_stock_movements rev
        WHERE rev.reversal_of = psm.id
      )
    ORDER BY psm.created_at, psm.id
    FOR UPDATE
  LOOP
    SELECT ii.current_quantity
      INTO v_available_quantity
    FROM public.inventory_items ii
    WHERE ii.id = v_movement.inventory_item_id
      AND ii.tenant_id = v_purchase.tenant_id
      AND ii.branch_id = v_purchase.branch_id
    FOR UPDATE;

    IF v_available_quantity IS NULL THEN
      RAISE EXCEPTION 'Linked stock item was not found in this branch.'
        USING ERRCODE = '23514';
    END IF;

    IF v_available_quantity < v_movement.quantity_delta THEN
      RAISE EXCEPTION 'Cannot reverse receiving because current stock is lower than the received quantity.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.inventory_items
    SET current_quantity = current_quantity - v_movement.quantity_delta,
        updated_at = v_now
    WHERE id = v_movement.inventory_item_id;

    INSERT INTO public.purchase_stock_movements (
      tenant_id,
      branch_id,
      purchase_id,
      purchase_item_id,
      inventory_item_id,
      quantity_delta,
      unit_cost,
      reason,
      reversal_of,
      created_by,
      created_at
    ) VALUES (
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_purchase.id,
      v_movement.purchase_item_id,
      v_movement.inventory_item_id,
      -v_movement.quantity_delta,
      v_movement.unit_cost,
      'purchase_receiving_reversed',
      v_movement.id,
      v_user_id,
      v_now
    );

    UPDATE public.purchase_items
    SET receiving_status = 'reversed'
    WHERE id = v_movement.purchase_item_id;

    v_reversed_lines := v_reversed_lines + 1;
    v_reversed_quantity := v_reversed_quantity + v_movement.quantity_delta;
  END LOOP;

  IF v_reversed_lines = 0 THEN
    RAISE EXCEPTION 'This purchase receiving has already been reversed.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchases
  SET receiving_status = 'reversed',
      status = 'cancelled',
      reversed_at = v_now,
      reversed_by = v_user_id,
      reversal_reason = v_reason,
      updated_at = v_now
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_receiving_reversed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'reversed_lines', v_reversed_lines,
      'reversed_quantity', v_reversed_quantity,
      'reason_length', length(v_reason),
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'receiving_status', 'reversed',
    'stock_changed', true,
    'reversed_lines', v_reversed_lines,
    'reversed_quantity', v_reversed_quantity
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_purchase_receiving(UUID, TEXT, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_receiving(UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) IS
  'Confirms pending receive-stock purchases and increases inventory only for linked stock lines. Safe human confirmation path for future AI/OCR drafts.';

COMMENT ON FUNCTION public.cancel_purchase_receiving(UUID, TEXT, BOOLEAN) IS
  'Cancels pending purchase receiving or reverses confirmed Phase 4C receiving through stock movement reversal rows. Does not delete purchases or attachments.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm legacy auto-stock trigger is disabled:
--
-- SELECT trigger_name
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table = 'purchase_items'
--   AND trigger_name = 'trg_purchase_item_update_stock';
--
-- Expected: zero rows.
--
-- 2) Confirm new receiving columns:
--
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     table_name = 'purchases'
--     AND column_name IN (
--       'receiving_status',
--       'received_at',
--       'received_by',
--       'cancelled_at',
--       'cancelled_by',
--       'cancellation_reason',
--       'reversed_at',
--       'reversed_by',
--       'reversal_reason'
--     )
--     OR table_name = 'purchase_items'
--     AND column_name IN (
--       'supplier_item_name',
--       'line_type',
--       'receiving_status',
--       'received_quantity',
--       'match_confidence',
--       'match_source',
--       'confirmed_at'
--     )
--   )
-- ORDER BY table_name, column_name;
--
-- 3) Confirm movement/mapping tables:
--
-- SELECT to_regclass('public.purchase_stock_movements') AS purchase_stock_movements,
--        to_regclass('public.supplier_item_mappings') AS supplier_item_mappings;
--
-- 4) Confirm browser roles cannot directly update/delete purchase state:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('purchases', 'purchase_items')
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type IN ('UPDATE', 'DELETE')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: zero rows.
--
-- 5) Confirm RPC privileges:
--
-- SELECT
--   has_function_privilege(
--     'authenticated',
--     'public.confirm_purchase_receiving(uuid, boolean)',
--     'EXECUTE'
--   ) AS authenticated_can_confirm_receiving,
--   has_function_privilege(
--     'authenticated',
--     'public.cancel_purchase_receiving(uuid, text, boolean)',
--     'EXECUTE'
--   ) AS authenticated_can_cancel_receiving;
--
-- 6) Confirm movement RLS policies:
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('purchase_stock_movements', 'supplier_item_mappings')
-- ORDER BY tablename, policyname;
--
-- 7) Confirm audit rows after manual tests:
--
-- SELECT action, target_type, target_id, severity, status, metadata, created_at
-- FROM public.audit_events
-- WHERE action IN (
--   'purchase_receiving_confirmed',
--   'purchase_receiving_cancelled',
--   'purchase_receiving_reversed'
-- )
-- ORDER BY created_at DESC
-- LIMIT 20;

-- ============================================================
-- Manual test checklist after applying SQL and deploying frontend
-- ============================================================
--
-- - Simple bill create still works.
-- - Simple bill delete still works through public.delete_purchase_bill.
-- - Receive Stock save creates a pending receiving purchase.
-- - New linked receive-stock purchase does not increase stock before confirm.
-- - Confirm Receiving increases linked stock exactly once.
-- - Repeated Confirm Receiving is blocked.
-- - Unlinked/non-stock lines remain bill detail and do not affect stock.
-- - Cancel pending receiving does not affect stock.
-- - Reverse confirmed receiving subtracts stock and creates reversal movements.
-- - Reverse is blocked if current stock is lower than the received quantity.
-- - Audit events appear for confirm/cancel/reverse.
-- - POS checkout still works.
-- - Normal invoice ZATCA report still works.
-- - Credit note ZATCA report still works.
