-- ============================================================
-- Phase 5O: Secure Product SKU Generation
-- Apply manually after Phase 5N credit note session linkage.
-- ============================================================
--
-- Goals:
--   - Generate editable SKUs for physical and service products.
--   - Enforce tenant-level case-insensitive SKU uniqueness.
--   - Keep SKU separate from barcode.
--   - Keep stock, cost, VAT, ZATCA, POS checkout, and invoices unchanged.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not overwrite existing nonblank SKUs.
--   - Do not backfill historical products in this migration.
--   - Do not change product stock quantity or purchase cost.

BEGIN;

-- ============================================================
-- Existing-data preflight
-- ============================================================
--
-- Optional preview before applying:
--
-- SELECT tenant_id, lower(btrim(sku)) AS normalized_sku, COUNT(*) AS duplicate_count,
--        array_agg(id ORDER BY created_at, id) AS product_ids
-- FROM public.products
-- WHERE sku IS NOT NULL
--   AND btrim(sku) <> ''
-- GROUP BY tenant_id, lower(btrim(sku))
-- HAVING COUNT(*) > 1;
--
-- SELECT
--   COUNT(*) FILTER (WHERE sku IS NULL) AS null_sku_count,
--   COUNT(*) FILTER (WHERE sku IS NOT NULL AND btrim(sku) = '') AS blank_sku_count
-- FROM public.products;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.sku IS NOT NULL
      AND btrim(p.sku) <> ''
    GROUP BY p.tenant_id, lower(btrim(p.sku))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized product SKUs exist. Preview and resolve duplicates before applying Phase 5O.'
      USING ERRCODE = '23505';
  END IF;
END $$;

-- ============================================================
-- SKU normalization and generation helpers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_sku_counters (
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, prefix),
  CONSTRAINT product_sku_counters_prefix_check CHECK (prefix ~ '^[A-Z0-9]{3}$'),
  CONSTRAINT product_sku_counters_last_value_check CHECK (last_value >= 0)
);

COMMENT ON TABLE public.product_sku_counters IS
  'Tenant-scoped counters used to generate readable product and service SKUs.';

REVOKE ALL ON TABLE public.product_sku_counters FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.product_sku_counters TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_product_sku(
  p_sku TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_sku TEXT;
BEGIN
  IF p_sku IS NULL THEN
    RETURN NULL;
  END IF;

  v_sku := upper(btrim(p_sku));

  IF v_sku = '' THEN
    RAISE EXCEPTION 'SKU cannot be blank' USING ERRCODE = '22023';
  END IF;

  IF length(v_sku) < 3 OR length(v_sku) > 50 THEN
    RAISE EXCEPTION 'SKU must be 3 to 50 characters' USING ERRCODE = '22023';
  END IF;

  IF v_sku !~ '^[A-Z0-9][A-Z0-9_-]*[A-Z0-9]$' THEN
    RAISE EXCEPTION 'SKU may contain only A-Z, 0-9, hyphen, and underscore, and must start and end with a letter or number'
      USING ERRCODE = '22023';
  END IF;

  IF v_sku ~ '[-_]{2,}' THEN
    RAISE EXCEPTION 'SKU cannot contain repeated separators'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_sku;
END;
$$;

CREATE OR REPLACE FUNCTION public.product_sku_prefix(
  p_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := regexp_replace(upper(COALESCE(p_name, '')), '[^A-Z0-9]', '', 'g');

  IF v_clean = '' THEN
    RETURN 'PRD';
  END IF;

  RETURN left(rpad(v_clean, 3, 'X'), 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.next_product_sku(
  p_tenant_id UUID,
  p_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_prefix TEXT;
  v_value BIGINT;
  v_sku TEXT;
  v_attempts INTEGER := 0;
  v_max_attempts CONSTANT INTEGER := 100;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required for SKU generation' USING ERRCODE = '22023';
  END IF;

  v_prefix := public.product_sku_prefix(p_name);

  LOOP
    v_attempts := v_attempts + 1;

    INSERT INTO public.product_sku_counters (tenant_id, prefix, last_value)
    VALUES (p_tenant_id, v_prefix, 1)
    ON CONFLICT (tenant_id, prefix)
    DO UPDATE
      SET last_value = public.product_sku_counters.last_value + 1,
          updated_at = NOW()
    RETURNING last_value INTO v_value;

    v_sku := v_prefix || '-' || lpad(v_value::text, 4, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.tenant_id = p_tenant_id
        AND p.sku IS NOT NULL
        AND lower(btrim(p.sku)) = lower(v_sku)
    ) THEN
      RETURN v_sku;
    END IF;

    IF v_attempts >= v_max_attempts THEN
      RAISE EXCEPTION 'Unable to generate a unique product SKU. Please enter a SKU manually.'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_product_sku(
  p_tenant_id UUID,
  p_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_prefix TEXT;
  v_value BIGINT;
  v_sku TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required for SKU suggestion' USING ERRCODE = '22023';
  END IF;

  v_prefix := public.product_sku_prefix(p_name);

  SELECT COALESCE(c.last_value, 0) + 1
    INTO v_value
  FROM public.product_sku_counters c
  WHERE c.tenant_id = p_tenant_id
    AND c.prefix = v_prefix;

  v_value := COALESCE(v_value, 1);

  LOOP
    v_sku := v_prefix || '-' || lpad(v_value::text, 4, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.tenant_id = p_tenant_id
        AND p.sku IS NOT NULL
        AND lower(btrim(p.sku)) = lower(v_sku)
    ) THEN
      RETURN v_sku;
    END IF;

    v_value := v_value + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_product_sku(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_sku_prefix(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_product_sku(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.peek_product_sku(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_product_sku(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_sku_prefix(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_product_sku(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.peek_product_sku(UUID, TEXT) TO service_role;

-- ============================================================
-- Product SKU trigger safety net
-- ============================================================

CREATE OR REPLACE FUNCTION public.products_sku_normalize_generate_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      NEW.sku := public.next_product_sku(NEW.tenant_id, NEW.name);
    ELSE
      NEW.sku := public.normalize_product_sku(NEW.sku);
    END IF;
  ELSIF NEW.sku IS DISTINCT FROM OLD.sku THEN
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      NEW.sku := public.next_product_sku(NEW.tenant_id, NEW.name);
    ELSE
      NEW.sku := public.normalize_product_sku(NEW.sku);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sku_normalize_generate ON public.products;
CREATE TRIGGER trg_products_sku_normalize_generate
  BEFORE INSERT OR UPDATE OF sku ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_sku_normalize_generate_trigger();

CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_normalized_sku_uidx
  ON public.products (tenant_id, lower(btrim(sku)))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

COMMENT ON INDEX public.products_tenant_normalized_sku_uidx IS
  'Enforces tenant-level case-insensitive product/service SKU uniqueness, including archived products.';

REVOKE ALL ON FUNCTION public.products_sku_normalize_generate_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.products_sku_normalize_generate_trigger() TO service_role;

-- ============================================================
-- Secure product RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.product_rpc_profile()
RETURNS TABLE (
  id UUID,
  role TEXT,
  tenant_id UUID,
  branch_id UUID,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT up.id, up.role::text, up.tenant_id, up.branch_id, up.is_active
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.assert_product_write_access(
  p_branch_id UUID
)
RETURNS TABLE (
  tenant_id UUID,
  branch_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_profile RECORD;
  v_branch RECORD;
  v_tenant RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.product_rpc_profile();

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role NOT IN ('super_admin', 'owner', 'admin', 'branch', 'manager') THEN
    RAISE EXCEPTION 'Insufficient permission to manage products' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active
    INTO v_branch
  FROM public.branches b
  WHERE b.id = COALESCE(p_branch_id, v_profile.branch_id);

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.is_active
    INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_branch.tenant_id;

  IF NOT FOUND OR v_tenant.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Business account is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    RETURN QUERY SELECT v_branch.tenant_id, v_branch.id;
    RETURN;
  END IF;

  IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('branch', 'manager')
     AND v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
    RAISE EXCEPTION 'Branch belongs to another profile' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_branch.tenant_id, v_branch.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.suggest_product_sku(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_scope RECORD;
  v_name TEXT;
  v_branch_id UUID;
  v_branch_id_text TEXT;
  v_sku TEXT;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid SKU suggestion payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN ('name', 'branch_id')
  ) THEN
    RAISE EXCEPTION 'Unsupported SKU suggestion field' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required for SKU suggestion' USING ERRCODE = '22023';
  END IF;

  v_branch_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '');
  IF v_branch_id_text IS NOT NULL THEN
    BEGIN
      v_branch_id := v_branch_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid branch id' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_branch_id);

  v_sku := public.peek_product_sku(v_scope.tenant_id, v_name);

  RETURN jsonb_build_object(
    'ok', true,
    'sku', v_sku,
    'prefix', public.product_sku_prefix(v_name),
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_product_secure(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_scope RECORD;
  v_product_id UUID;
  v_branch_id UUID;
  v_branch_id_text TEXT;
  v_category_id UUID;
  v_category_id_text TEXT;
  v_name TEXT;
  v_sku TEXT;
  v_price NUMERIC(12, 2);
  v_sort_order INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'branch_id',
      'name',
      'name_ar',
      'category_id',
      'description',
      'price',
      'vat_treatment',
      'image_url',
      'is_available',
      'sort_order',
      'sku',
      'notes',
      'is_service'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product field' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'price') OR jsonb_typeof(p_payload -> 'price') <> 'number' THEN
    RAISE EXCEPTION 'Product price must be a number' USING ERRCODE = '22023';
  END IF;
  v_price := (p_payload ->> 'price')::NUMERIC(12, 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'Product price must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_branch_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '');
  IF v_branch_id_text IS NOT NULL THEN
    BEGIN
      v_branch_id := v_branch_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid branch id' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_branch_id);

  v_category_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'category_id', '')), '');
  IF v_category_id_text IS NOT NULL THEN
    BEGIN
      v_category_id := v_category_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid category id' USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.tenant_id = v_scope.tenant_id
        AND c.branch_id = v_scope.branch_id
        AND c.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Product category does not belong to this branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'sku' AND NULLIF(btrim(COALESCE(p_payload ->> 'sku', '')), '') IS NOT NULL THEN
    v_sku := public.normalize_product_sku(p_payload ->> 'sku');
  ELSE
    v_sku := public.next_product_sku(v_scope.tenant_id, v_name);
  END IF;

  v_sort_order := COALESCE(NULLIF(p_payload ->> 'sort_order', '')::INTEGER, 0);

  BEGIN
    INSERT INTO public.products (
      tenant_id,
      branch_id,
      name,
      name_ar,
      category_id,
      description,
      price,
      vat_treatment,
      image_url,
      is_available,
      sort_order,
      sku,
      notes,
      is_service
    ) VALUES (
      v_scope.tenant_id,
      v_scope.branch_id,
      v_name,
      NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
      v_category_id,
      NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
      v_price,
      COALESCE(NULLIF(p_payload ->> 'vat_treatment', ''), 'inherit'),
      NULLIF(btrim(COALESCE(p_payload ->> 'image_url', '')), ''),
      COALESCE((p_payload ->> 'is_available')::BOOLEAN, TRUE),
      v_sort_order,
      v_sku,
      NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), ''),
      COALESCE((p_payload ->> 'is_service')::BOOLEAN, FALSE)
    )
    RETURNING id, sku INTO v_product_id, v_sku;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SKU already exists for another product in this business'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product_id,
    'sku', v_sku,
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_secure(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_scope RECORD;
  v_product RECORD;
  v_product_id UUID;
  v_product_id_text TEXT;
  v_category_id UUID;
  v_category_id_text TEXT;
  v_name TEXT;
  v_sku TEXT;
  v_price NUMERIC(12, 2);
  v_sort_order INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'name',
      'name_ar',
      'category_id',
      'description',
      'price',
      'vat_treatment',
      'image_url',
      'is_available',
      'sort_order',
      'sku',
      'notes',
      'is_service'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product field' USING ERRCODE = '22023';
  END IF;

  v_product_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'product_id', '')), '');
  IF v_product_id_text IS NULL THEN
    RAISE EXCEPTION 'Missing product id' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := v_product_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id' USING ERRCODE = '22023';
  END;

  SELECT p.*
    INTO v_product
  FROM public.products p
  WHERE p.id = v_product_id
  FOR UPDATE;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_product.branch_id THEN
    RAISE EXCEPTION 'Product belongs to another branch' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'price') OR jsonb_typeof(p_payload -> 'price') <> 'number' THEN
    RAISE EXCEPTION 'Product price must be a number' USING ERRCODE = '22023';
  END IF;
  v_price := (p_payload ->> 'price')::NUMERIC(12, 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'Product price must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_category_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'category_id', '')), '');
  IF v_category_id_text IS NOT NULL THEN
    BEGIN
      v_category_id := v_category_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid category id' USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.tenant_id = v_scope.tenant_id
        AND c.branch_id = v_scope.branch_id
        AND c.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Product category does not belong to this branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'sku' AND NULLIF(btrim(COALESCE(p_payload ->> 'sku', '')), '') IS NOT NULL THEN
    v_sku := public.normalize_product_sku(p_payload ->> 'sku');
  ELSIF p_payload ? 'sku' THEN
    v_sku := public.next_product_sku(v_scope.tenant_id, v_name);
  ELSE
    v_sku := v_product.sku;
  END IF;

  v_sort_order := COALESCE(NULLIF(p_payload ->> 'sort_order', '')::INTEGER, 0);

  BEGIN
    UPDATE public.products
    SET name = v_name,
        name_ar = NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
        category_id = v_category_id,
        description = NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
        price = v_price,
        vat_treatment = COALESCE(NULLIF(p_payload ->> 'vat_treatment', ''), 'inherit'),
        image_url = NULLIF(btrim(COALESCE(p_payload ->> 'image_url', '')), ''),
        is_available = COALESCE((p_payload ->> 'is_available')::BOOLEAN, TRUE),
        sort_order = v_sort_order,
        sku = v_sku,
        notes = NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), ''),
        is_service = COALESCE((p_payload ->> 'is_service')::BOOLEAN, COALESCE(v_product.is_service, FALSE)),
        updated_at = NOW()
    WHERE id = v_product.id
    RETURNING sku INTO v_sku;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SKU already exists for another product in this business'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product.id,
    'sku', v_sku,
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.product_rpc_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_product_write_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suggest_product_sku(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product_secure(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_secure(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.suggest_product_sku(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_secure(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_secure(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_rpc_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_product_write_access(UUID) TO service_role;

COMMENT ON FUNCTION public.suggest_product_sku(JSONB) IS
  'Returns a non-authoritative product SKU suggestion for the authenticated tenant/branch.';
COMMENT ON FUNCTION public.create_product_secure(JSONB) IS
  'Creates a product or service with tenant-level normalized SKU validation/generation.';
COMMENT ON FUNCTION public.update_product_secure(JSONB) IS
  'Updates product details with tenant-level normalized SKU validation without touching stock quantity or cost.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- OPTIONAL MANUAL BACKFILL - DO NOT RUN WITH THE MIGRATION
-- ============================================================
--
-- Preview products missing SKU:
--
-- SELECT id, tenant_id, branch_id, name, is_service, created_at
-- FROM public.products
-- WHERE sku IS NULL OR btrim(sku) = ''
-- ORDER BY tenant_id, created_at, id;
--
-- Preview normalized duplicate conflicts:
--
-- SELECT tenant_id, lower(btrim(sku)) AS normalized_sku, COUNT(*) AS duplicate_count,
--        array_agg(id ORDER BY created_at, id) AS product_ids
-- FROM public.products
-- WHERE sku IS NOT NULL
--   AND btrim(sku) <> ''
-- GROUP BY tenant_id, lower(btrim(sku))
-- HAVING COUNT(*) > 1;
--
-- Guarded deterministic backfill for missing/blank SKUs.
-- Review output carefully before committing the transaction.
--
-- BEGIN;
-- WITH candidates AS (
--   SELECT
--     p.id,
--     p.tenant_id,
--     p.name,
--     public.product_sku_prefix(p.name) AS prefix,
--     row_number() OVER (
--       PARTITION BY p.tenant_id, public.product_sku_prefix(p.name)
--       ORDER BY p.created_at, p.id
--     ) AS sequence_offset
--   FROM public.products p
--   WHERE p.sku IS NULL OR btrim(p.sku) = ''
-- ),
-- base_values AS (
--   SELECT
--     c.*,
--     COALESCE(psc.last_value, 0) AS base_value
--   FROM candidates c
--   LEFT JOIN public.product_sku_counters psc
--     ON psc.tenant_id = c.tenant_id
--    AND psc.prefix = c.prefix
-- ),
-- proposed AS (
--   SELECT
--     id,
--     tenant_id,
--     prefix,
--     prefix || '-' || lpad((base_value + sequence_offset)::text, 4, '0') AS proposed_sku
--   FROM base_values
-- ),
-- conflicts AS (
--   SELECT proposed_sku, COUNT(*) AS conflict_count
--   FROM proposed
--   GROUP BY proposed_sku
--   HAVING COUNT(*) > 1
--   UNION ALL
--   SELECT pr.proposed_sku, COUNT(*) AS conflict_count
--   FROM proposed pr
--   JOIN public.products existing
--     ON existing.tenant_id = pr.tenant_id
--    AND existing.id <> pr.id
--    AND existing.sku IS NOT NULL
--    AND lower(btrim(existing.sku)) = lower(pr.proposed_sku)
--   GROUP BY pr.proposed_sku
-- )
-- SELECT * FROM conflicts;
--
-- -- Run this UPDATE only after the conflict preview returns zero rows.
-- WITH candidates AS (
--   SELECT
--     p.id,
--     p.tenant_id,
--     public.product_sku_prefix(p.name) AS prefix,
--     row_number() OVER (
--       PARTITION BY p.tenant_id, public.product_sku_prefix(p.name)
--       ORDER BY p.created_at, p.id
--     ) AS sequence_offset
--   FROM public.products p
--   WHERE p.sku IS NULL OR btrim(p.sku) = ''
-- ),
-- proposed AS (
--   SELECT
--     c.id,
--     c.tenant_id,
--     c.prefix,
--     c.prefix || '-' || lpad((
--       COALESCE(psc.last_value, 0) + c.sequence_offset
--     )::text, 4, '0') AS proposed_sku
--   FROM candidates c
--   LEFT JOIN public.product_sku_counters psc
--     ON psc.tenant_id = c.tenant_id
--    AND psc.prefix = c.prefix
-- )
-- UPDATE public.products p
-- SET sku = proposed.proposed_sku,
--     updated_at = NOW()
-- FROM proposed
-- WHERE p.id = proposed.id
--   AND (p.sku IS NULL OR btrim(p.sku) = '')
-- RETURNING p.id, p.tenant_id, p.branch_id, p.name, p.sku;
--
-- -- After reviewing RETURNING output, manually advance counters per prefix if needed,
-- -- then COMMIT. Otherwise ROLLBACK.
-- ROLLBACK;
