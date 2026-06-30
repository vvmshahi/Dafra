-- ============================================================
-- Phase 4D: supplier item mapping foundation + purchase bill paths
-- Apply manually after phase4c-purchase-ux-simplification.sql.
-- ============================================================
--
-- Goals:
--   - Complete the supplier item mapping foundation for future AI/OCR drafts.
--   - Let staff remember supplier item -> internal inventory matches.
--   - Store new purchase bill attachments as private object paths.
--   - Keep existing purchases.bill_url links working for compatibility.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not modify existing stock quantities.
--   - Do not delete existing storage files.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

-- ============================================================
-- Purchase bill attachment path compatibility
-- ============================================================

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS bill_path TEXT;

COMMENT ON COLUMN public.purchases.bill_path IS
  'Private Storage object path for purchase bill attachments. Existing bill_url is kept for legacy signed URL compatibility.';

CREATE INDEX IF NOT EXISTS purchases_bill_path_idx
  ON public.purchases (branch_id, created_at DESC)
  WHERE bill_path IS NOT NULL;

-- ============================================================
-- Supplier item mapping table compatibility upgrade
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_supplier_item_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    trim(
      regexp_replace(
        regexp_replace(lower(COALESCE(p_name, '')), '[^[:alnum:]]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;

REVOKE ALL ON FUNCTION public.normalize_supplier_item_name(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_supplier_item_name(TEXT) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.supplier_item_mappings (
  id                              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id                       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id                       UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id                     UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_item_name              TEXT NOT NULL,
  normalized_supplier_item_name   TEXT NOT NULL,
  normalized_name                 TEXT NOT NULL,
  matched_inventory_item_id       UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  matched_product_id              UUID REFERENCES public.products(id) ON DELETE SET NULL,
  confidence                      NUMERIC(5, 2),
  match_confidence                NUMERIC(5, 2),
  match_source                    TEXT NOT NULL DEFAULT 'manual',
  confirmation_status             TEXT NOT NULL DEFAULT 'manual_confirmed',
  is_active                       BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_by                    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  confirmed_at                    TIMESTAMPTZ,
  last_used_at                    TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_item_mappings_match_source_check
    CHECK (match_source IN ('manual', 'ai', 'imported')),
  CONSTRAINT supplier_item_mappings_confirmation_status_check
    CHECK (confirmation_status IN ('ai_suggested', 'manual_confirmed', 'rejected'))
);

ALTER TABLE public.supplier_item_mappings
  ALTER COLUMN branch_id DROP NOT NULL;

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS normalized_supplier_item_name TEXT;

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5, 2);

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(5, 2);

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS match_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'manual_confirmed';

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.supplier_item_mappings
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

UPDATE public.supplier_item_mappings
SET normalized_supplier_item_name = COALESCE(
      NULLIF(normalized_supplier_item_name, ''),
      NULLIF(normalized_name, ''),
      public.normalize_supplier_item_name(supplier_item_name)
    ),
    normalized_name = COALESCE(
      NULLIF(normalized_name, ''),
      NULLIF(normalized_supplier_item_name, ''),
      public.normalize_supplier_item_name(supplier_item_name)
    ),
    confidence = COALESCE(confidence, match_confidence),
    match_confidence = COALESCE(match_confidence, confidence),
    match_source = CASE
      WHEN confirmation_status = 'ai_suggested' THEN 'ai'
      ELSE COALESCE(NULLIF(match_source, ''), 'manual')
    END,
    confirmed_at = CASE
      WHEN confirmation_status = 'manual_confirmed' THEN COALESCE(confirmed_at, created_at)
      ELSE confirmed_at
    END
WHERE normalized_supplier_item_name IS NULL
   OR normalized_name IS NULL
   OR confidence IS NULL
   OR match_confidence IS NULL
   OR match_source IS NULL
   OR confirmed_at IS NULL;

ALTER TABLE public.supplier_item_mappings
  ALTER COLUMN normalized_supplier_item_name SET NOT NULL;

ALTER TABLE public.supplier_item_mappings
  ALTER COLUMN normalized_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_item_mappings_match_source_check'
      AND conrelid = 'public.supplier_item_mappings'::regclass
  ) THEN
    ALTER TABLE public.supplier_item_mappings
      ADD CONSTRAINT supplier_item_mappings_match_source_check
      CHECK (match_source IN ('manual', 'ai', 'imported')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS supplier_item_mappings_lookup_idx
  ON public.supplier_item_mappings (
    tenant_id,
    supplier_id,
    normalized_supplier_item_name,
    branch_id,
    is_active
  );

CREATE INDEX IF NOT EXISTS supplier_item_mappings_inventory_idx
  ON public.supplier_item_mappings (matched_inventory_item_id)
  WHERE matched_inventory_item_id IS NOT NULL AND is_active IS TRUE;

ALTER TABLE public.supplier_item_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supplier_item_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_item_mappings TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.supplier_item_mappings TO service_role;

DROP POLICY IF EXISTS phase4d_supplier_item_mappings_select ON public.supplier_item_mappings;
DROP POLICY IF EXISTS phase4d_supplier_item_mappings_service_all ON public.supplier_item_mappings;

CREATE POLICY phase4d_supplier_item_mappings_select
  ON public.supplier_item_mappings
  FOR SELECT TO authenticated
  USING (
    (branch_id IS NULL AND public.rls_can_access_tenant(tenant_id))
    OR (branch_id IS NOT NULL AND public.rls_can_access_branch(tenant_id, branch_id))
  );

CREATE POLICY phase4d_supplier_item_mappings_service_all
  ON public.supplier_item_mappings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.supplier_item_mappings IS
  'Supplier bill item name mappings used only to suggest internal inventory/product matches. Mappings never update stock directly.';

COMMENT ON COLUMN public.supplier_item_mappings.branch_id IS
  'Nullable for future tenant-wide/product mappings; inventory-item mappings are normally branch-specific.';

COMMENT ON COLUMN public.supplier_item_mappings.match_source IS
  'Mapping origin: manual, ai, or imported. Manual matches should be preferred over future AI suggestions.';

-- ============================================================
-- Mapping suggestion and manual remember RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.suggest_supplier_item_mapping(
  p_supplier_id UUID,
  p_supplier_item_name TEXT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_supplier RECORD;
  v_branch_id UUID;
  v_normalized TEXT;
  v_mapping RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  v_normalized := public.normalize_supplier_item_name(p_supplier_item_name);
  IF v_normalized IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_profile.branch_id);

  SELECT s.id, s.tenant_id
    INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = p_supplier_id;

  IF NOT FOUND OR v_supplier.tenant_id IS DISTINCT FROM v_profile.tenant_id THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_branch_id IS NULL OR v_profile.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'You do not have permission to use mappings for this branch.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to use supplier item mappings.'
      USING ERRCODE = '42501';
  END IF;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = v_branch_id
      AND b.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch not found for this tenant' USING ERRCODE = '42501';
  END IF;

  SELECT
    m.*,
    ii.name AS matched_inventory_item_name,
    ii.unit_cost AS matched_inventory_unit_cost
    INTO v_mapping
  FROM public.supplier_item_mappings m
  LEFT JOIN public.inventory_items ii
    ON ii.id = m.matched_inventory_item_id
   AND ii.tenant_id = m.tenant_id
   AND ii.branch_id = v_branch_id
  WHERE m.tenant_id = v_profile.tenant_id
    AND m.supplier_id = p_supplier_id
    AND m.normalized_supplier_item_name = v_normalized
    AND COALESCE(m.is_active, TRUE) IS TRUE
    AND (m.branch_id = v_branch_id OR m.branch_id IS NULL)
    AND (m.matched_inventory_item_id IS NULL OR ii.id IS NOT NULL)
  ORDER BY
    CASE WHEN m.branch_id = v_branch_id THEN 0 ELSE 1 END,
    CASE COALESCE(m.match_source, 'manual')
      WHEN 'manual' THEN 0
      WHEN 'imported' THEN 1
      WHEN 'ai' THEN 2
      ELSE 3
    END,
    m.confirmed_at DESC NULLS LAST,
    m.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  UPDATE public.supplier_item_mappings
  SET last_used_at = NOW(),
      updated_at = NOW()
  WHERE id = v_mapping.id;

  RETURN jsonb_build_object(
    'ok', true,
    'matched', true,
    'mapping_id', v_mapping.id,
    'supplier_id', p_supplier_id,
    'supplier_item_name', v_mapping.supplier_item_name,
    'matched_inventory_item_id', v_mapping.matched_inventory_item_id,
    'matched_inventory_item_name', v_mapping.matched_inventory_item_name,
    'matched_inventory_unit_cost', v_mapping.matched_inventory_unit_cost,
    'matched_product_id', v_mapping.matched_product_id,
    'match_source', v_mapping.match_source,
    'confidence', COALESCE(v_mapping.confidence, v_mapping.match_confidence)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_supplier_item_mapping(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_supplier_item_mapping(UUID, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_supplier_item_mapping(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_supplier_id UUID;
  v_branch_id UUID;
  v_inventory_item_id UUID;
  v_supplier_item_name TEXT;
  v_normalized TEXT;
  v_mapping RECORD;
  v_action TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid mapping payload' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  v_supplier_id := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '')::uuid;
  v_branch_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid,
    v_profile.branch_id
  );
  v_inventory_item_id := NULLIF(TRIM(COALESCE(p_payload ->> 'matched_inventory_item_id', '')), '')::uuid;
  v_supplier_item_name := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_item_name', '')), '');
  v_normalized := public.normalize_supplier_item_name(v_supplier_item_name);

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier is required' USING ERRCODE = '22023';
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for inventory item mappings' USING ERRCODE = '22023';
  END IF;

  IF v_inventory_item_id IS NULL THEN
    RAISE EXCEPTION 'Inventory item is required' USING ERRCODE = '22023';
  END IF;

  IF v_supplier_item_name IS NULL OR v_normalized IS NULL THEN
    RAISE EXCEPTION 'Supplier item name is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_supplier_item_name) > 500 THEN
    RAISE EXCEPTION 'Supplier item name is too long' USING ERRCODE = '22023';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'You do not have permission to update mappings for this branch.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to update supplier item mappings.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = v_supplier_id
      AND s.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = v_branch_id
      AND b.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_items ii
    WHERE ii.id = v_inventory_item_id
      AND ii.tenant_id = v_profile.tenant_id
      AND ii.branch_id = v_branch_id
  ) THEN
    RAISE EXCEPTION 'Inventory item not found in this branch' USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_mapping
  FROM public.supplier_item_mappings m
  WHERE m.tenant_id = v_profile.tenant_id
    AND m.supplier_id = v_supplier_id
    AND m.normalized_supplier_item_name = v_normalized
    AND m.branch_id IS NOT DISTINCT FROM v_branch_id
  ORDER BY m.is_active DESC, m.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.supplier_item_mappings
    SET supplier_item_name = v_supplier_item_name,
        normalized_supplier_item_name = v_normalized,
        normalized_name = v_normalized,
        matched_inventory_item_id = v_inventory_item_id,
        matched_product_id = NULL,
        confidence = 1.00,
        match_confidence = 1.00,
        match_source = 'manual',
        confirmation_status = 'manual_confirmed',
        is_active = TRUE,
        confirmed_by = v_user_id,
        confirmed_at = NOW(),
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = v_mapping.id
    RETURNING * INTO v_mapping;

    v_action := 'supplier_item_mapping_updated';
  ELSE
    INSERT INTO public.supplier_item_mappings (
      tenant_id,
      branch_id,
      supplier_id,
      supplier_item_name,
      normalized_supplier_item_name,
      normalized_name,
      matched_inventory_item_id,
      matched_product_id,
      confidence,
      match_confidence,
      match_source,
      confirmation_status,
      is_active,
      confirmed_by,
      confirmed_at,
      last_used_at
    ) VALUES (
      v_profile.tenant_id,
      v_branch_id,
      v_supplier_id,
      v_supplier_item_name,
      v_normalized,
      v_normalized,
      v_inventory_item_id,
      NULL,
      1.00,
      1.00,
      'manual',
      'manual_confirmed',
      TRUE,
      v_user_id,
      NOW(),
      NOW()
    )
    RETURNING * INTO v_mapping;

    v_action := 'supplier_item_mapping_created';
  END IF;

  PERFORM public.record_audit_event(
    v_action,
    v_profile.tenant_id,
    v_branch_id,
    v_user_id,
    v_profile.role,
    'supplier_item_mapping',
    v_mapping.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'supplier_id', v_supplier_id,
      'matched_inventory_item_id', v_inventory_item_id,
      'match_source', 'manual',
      'branch_specific', v_branch_id IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mapping_id', v_mapping.id,
    'supplier_id', v_supplier_id,
    'matched_inventory_item_id', v_inventory_item_id,
    'match_source', 'manual'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_supplier_item_mapping(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_supplier_item_mapping(jsonb) TO authenticated;

-- ============================================================
-- Purchase bill attachment RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.purchase_bill_path_is_valid(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_bill_path TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    p_tenant_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND NULLIF(TRIM(COALESCE(p_bill_path, '')), '') IS NOT NULL
    AND p_bill_path LIKE p_tenant_id::text || '/' || p_branch_id::text || '/purchases/%'
    AND POSITION('..' IN p_bill_path) = 0,
    FALSE
  )
$$;

REVOKE ALL ON FUNCTION public.purchase_bill_path_is_valid(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_bill_path_is_valid(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.set_purchase_bill_attachment(
  p_purchase_id UUID,
  p_bill_path TEXT DEFAULT NULL,
  p_clear BOOLEAN DEFAULT FALSE
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
  v_bill_path TEXT := NULLIF(TRIM(COALESCE(p_bill_path, '')), '');
  v_clear BOOLEAN := COALESCE(p_clear, FALSE);
  v_action TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

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
      RAISE EXCEPTION 'You do not have permission to update this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to update this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to update this attachment.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled'
     OR COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('cancelled', 'reversed')
  THEN
    RAISE EXCEPTION 'This purchase can no longer be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF v_clear IS NOT TRUE THEN
    IF v_bill_path IS NULL THEN
      RAISE EXCEPTION 'Bill attachment path is required' USING ERRCODE = '22023';
    END IF;

    IF public.purchase_bill_path_is_valid(v_purchase.tenant_id, v_purchase.branch_id, v_bill_path) IS NOT TRUE THEN
      RAISE EXCEPTION 'Bill attachment path is not valid for this purchase branch.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.purchases
  SET bill_path = CASE WHEN v_clear THEN NULL ELSE v_bill_path END,
      bill_url = CASE WHEN v_clear OR v_bill_path IS NOT NULL THEN NULL ELSE bill_url END,
      updated_at = NOW()
  WHERE id = v_purchase.id;

  v_action := CASE WHEN v_clear THEN 'purchase_attachment_removed' ELSE 'purchase_attachment_uploaded' END;

  PERFORM public.record_audit_event(
    v_action,
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    CASE WHEN v_clear THEN 'warning' ELSE 'info' END,
    'succeeded',
    jsonb_build_object(
      'storage_bucket', 'purchases-bills',
      'path_format', 'tenant/branch/purchases/object',
      'had_previous_bill_url', v_purchase.bill_url IS NOT NULL,
      'had_previous_bill_path', v_purchase.bill_path IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'attachment_path_set', v_clear IS NOT TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_purchase_bill_attachment(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_purchase_bill_attachment(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_purchase_attachment_viewed(p_purchase_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to view this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to view this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to view this attachment.'
      USING ERRCODE = '42501';
  END IF;

  IF v_purchase.bill_path IS NULL AND v_purchase.bill_url IS NULL THEN
    RAISE EXCEPTION 'No purchase attachment found' USING ERRCODE = '22023';
  END IF;

  PERFORM public.record_audit_event(
    'purchase_attachment_viewed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'has_bill_path', v_purchase.bill_path IS NOT NULL,
      'legacy_bill_url', v_purchase.bill_path IS NULL AND v_purchase.bill_url IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'purchase_id', v_purchase.id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_purchase_attachment_viewed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_purchase_attachment_viewed(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm Phase 4D columns:
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'purchases'
--   AND column_name IN ('bill_url', 'bill_path')
-- ORDER BY column_name;
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'supplier_item_mappings'
--   AND column_name IN (
--     'branch_id',
--     'supplier_item_name',
--     'normalized_supplier_item_name',
--     'matched_inventory_item_id',
--     'matched_product_id',
--     'confidence',
--     'match_source',
--     'is_active',
--     'confirmed_by',
--     'confirmed_at',
--     'last_used_at'
--   )
-- ORDER BY column_name;
--
-- 2) Confirm browser roles can call safe RPCs but cannot write mappings directly:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.suggest_supplier_item_mapping(uuid, text, uuid)', 'EXECUTE') AS can_suggest_mapping,
--   has_function_privilege('authenticated', 'public.upsert_supplier_item_mapping(jsonb)', 'EXECUTE') AS can_upsert_mapping,
--   has_function_privilege('authenticated', 'public.set_purchase_bill_attachment(uuid, text, boolean)', 'EXECUTE') AS can_set_purchase_attachment,
--   has_function_privilege('authenticated', 'public.record_purchase_attachment_viewed(uuid)', 'EXECUTE') AS can_audit_attachment_view;
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'supplier_item_mappings'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
--
-- Expected: zero rows.
--
-- 3) Confirm storage path validator:
--
-- SELECT public.purchase_bill_path_is_valid(
--   '00000000-0000-0000-0000-000000000001'::uuid,
--   '00000000-0000-0000-0000-000000000002'::uuid,
--   '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/purchases/example/bill.pdf'
-- ) AS valid_example;
--
-- 4) Confirm audit rows after manual tests:
--
-- SELECT action, target_type, target_id, severity, status, metadata, created_at
-- FROM public.audit_events
-- WHERE action IN (
--   'supplier_item_mapping_created',
--   'supplier_item_mapping_updated',
--   'purchase_attachment_uploaded',
--   'purchase_attachment_removed',
--   'purchase_attachment_viewed'
-- )
-- ORDER BY created_at DESC
-- LIMIT 20;
