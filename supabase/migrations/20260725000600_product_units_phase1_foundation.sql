BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Product-unit scope keys are redundant with the product primary key, but the
-- composite key lets package foreign keys prove tenant and branch agreement.
CREATE UNIQUE INDEX products_id_tenant_branch_uidx
  ON public.products (id, tenant_id, branch_id);

CREATE TABLE public.product_units (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  name_ar varchar(80),
  unit_code varchar(8) NOT NULL,
  conversion_to_base numeric(18, 6) NOT NULL,
  quantity_scale smallint NOT NULL DEFAULT 3,
  pricing_method text NOT NULL DEFAULT 'calculated',
  custom_selling_price numeric(14, 2),
  selling_enabled boolean NOT NULL DEFAULT true,
  receiving_enabled boolean NOT NULL DEFAULT true,
  is_base boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  first_used_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_units_product_scope_fkey
    FOREIGN KEY (product_id, tenant_id, branch_id)
    REFERENCES public.products (id, tenant_id, branch_id)
    ON DELETE CASCADE,
  CONSTRAINT product_units_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.user_profiles (id)
    ON DELETE SET NULL,
  CONSTRAINT product_units_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES public.user_profiles (id)
    ON DELETE SET NULL,
  CONSTRAINT product_units_name_present
    CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT product_units_name_ar_present
    CHECK (name_ar IS NULL OR length(btrim(name_ar)) BETWEEN 1 AND 80),
  CONSTRAINT product_units_code_format
    CHECK (unit_code ~ '^[A-Z0-9]{2,8}$'),
  CONSTRAINT product_units_conversion_positive
    CHECK (conversion_to_base > 0),
  CONSTRAINT product_units_conversion_scale
    CHECK (scale(conversion_to_base) <= 6),
  CONSTRAINT product_units_quantity_scale_range
    CHECK (quantity_scale BETWEEN 0 AND 6),
  CONSTRAINT product_units_pricing_method
    CHECK (pricing_method IN ('calculated', 'custom')),
  CONSTRAINT product_units_custom_price_contract
    CHECK (
      (pricing_method = 'calculated' AND custom_selling_price IS NULL)
      OR
      (pricing_method = 'custom' AND custom_selling_price IS NOT NULL)
    ),
  CONSTRAINT product_units_custom_price_nonnegative
    CHECK (custom_selling_price IS NULL OR custom_selling_price >= 0),
  CONSTRAINT product_units_base_contract
    CHECK (
      is_base IS FALSE
      OR (
        conversion_to_base = 1
        AND pricing_method = 'calculated'
        AND custom_selling_price IS NULL
        AND is_active IS TRUE
      )
    ),
  CONSTRAINT product_units_sort_order_nonnegative
    CHECK (sort_order >= 0),
  CONSTRAINT product_units_version_positive
    CHECK (version > 0)
);

ALTER TABLE public.product_units OWNER TO postgres;

CREATE UNIQUE INDEX product_units_one_base_per_product_idx
  ON public.product_units (product_id)
  WHERE is_base;

-- Snapshot tables carry both product_id and product_unit_id. This redundant
-- key lets their foreign keys prove that a selected unit belongs to the same
-- product instead of merely proving that the unit UUID exists.
CREATE UNIQUE INDEX product_units_id_product_id_uidx
  ON public.product_units (id, product_id);

CREATE UNIQUE INDEX product_units_active_name_per_product_idx
  ON public.product_units (product_id, lower(btrim(name)))
  WHERE is_active;

-- Different package sizes may legitimately share one UBL unit code (for
-- example Half Carton and Carton), so unit_code is intentionally not unique.
CREATE INDEX product_units_scope_idx
  ON public.product_units (tenant_id, branch_id, product_id);

CREATE INDEX product_units_pos_lookup_idx
  ON public.product_units (product_id, sort_order, id)
  WHERE is_active AND selling_enabled;

CREATE INDEX product_units_receiving_lookup_idx
  ON public.product_units (product_id, sort_order, id)
  WHERE is_active AND receiving_enabled;

COMMENT ON TABLE public.product_units IS
  'Branch-scoped base units and alternate selling/receiving packages. Stock remains stored only in products.stock_quantity in base units.';

COMMENT ON COLUMN public.product_units.conversion_to_base IS
  'Number of base stock units represented by one selected unit. Immutable after first use.';

COMMENT ON COLUMN public.product_units.first_used_at IS
  'Database-owned lifecycle marker set by future package-aware sale or receiving functions; intentionally remains NULL in Phase 1.';

COMMENT ON COLUMN public.product_units.version IS
  'Optimistic concurrency version incremented for every commercially meaningful unit change.';

CREATE OR REPLACE FUNCTION public.product_unit_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_commercial_change boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Trusted tenant/branch teardown uses the service role and must still be
    -- able to cascade-delete the parent product. Browser package deletion and
    -- ordinary product deletion remain protected.
    IF auth.role() = 'service_role'
       AND NOT EXISTS (
         SELECT 1
         FROM public.products p
         WHERE p.id = OLD.product_id
           AND p.tenant_id = OLD.tenant_id
           AND p.branch_id = OLD.branch_id
       )
    THEN
      RETURN OLD;
    END IF;

    IF OLD.is_base IS TRUE THEN
      RAISE EXCEPTION 'A product base unit cannot be deleted'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.first_used_at IS NOT NULL THEN
      RAISE EXCEPTION 'A used product unit cannot be deleted; deactivate it instead'
        USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
  THEN
    RAISE EXCEPTION 'Product unit scope cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_base IS DISTINCT FROM OLD.is_base THEN
    RAISE EXCEPTION 'Product unit base relationship cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.is_base IS TRUE AND NEW.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'A product base unit cannot be deactivated'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.first_used_at IS NOT NULL THEN
    IF NEW.conversion_to_base IS DISTINCT FROM OLD.conversion_to_base THEN
      RAISE EXCEPTION 'A used product unit conversion cannot be changed; create a new unit'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.first_used_at IS DISTINCT FROM OLD.first_used_at THEN
      RAISE EXCEPTION 'Product unit first-use marker is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_commercial_change :=
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.name_ar IS DISTINCT FROM OLD.name_ar
    OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
    OR NEW.conversion_to_base IS DISTINCT FROM OLD.conversion_to_base
    OR NEW.quantity_scale IS DISTINCT FROM OLD.quantity_scale
    OR NEW.pricing_method IS DISTINCT FROM OLD.pricing_method
    OR NEW.custom_selling_price IS DISTINCT FROM OLD.custom_selling_price
    OR NEW.selling_enabled IS DISTINCT FROM OLD.selling_enabled
    OR NEW.receiving_enabled IS DISTINCT FROM OLD.receiving_enabled
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.sort_order IS DISTINCT FROM OLD.sort_order;

  IF v_commercial_change AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Product unit version must increase by one'
      USING ERRCODE = '23514';
  ELSIF NOT v_commercial_change AND NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'Product unit version may change only with a commercial change'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.product_unit_lifecycle_guard() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.product_unit_lifecycle_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_product_units_lifecycle_guard
  ON public.product_units;
CREATE TRIGGER trg_product_units_lifecycle_guard
  BEFORE UPDATE OR DELETE ON public.product_units
  FOR EACH ROW
  EXECUTE FUNCTION public.product_unit_lifecycle_guard();

DROP TRIGGER IF EXISTS trg_product_units_updated_at
  ON public.product_units;
CREATE TRIGGER trg_product_units_updated_at
  BEFORE UPDATE ON public.product_units
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_product_base_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  INSERT INTO public.product_units (
    tenant_id,
    branch_id,
    product_id,
    name,
    name_ar,
    unit_code,
    conversion_to_base,
    quantity_scale,
    pricing_method,
    custom_selling_price,
    selling_enabled,
    receiving_enabled,
    is_base,
    is_active,
    sort_order,
    version,
    created_by,
    updated_by
  ) VALUES (
    NEW.tenant_id,
    NEW.branch_id,
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.unit), ''), 'Piece'),
    NULLIF(btrim(NEW.unit_ar), ''),
    'PCE',
    1,
    3,
    'calculated',
    NULL,
    COALESCE(NEW.is_available, true),
    COALESCE(NEW.is_service, false) IS FALSE,
    true,
    true,
    0,
    1,
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (product_id) WHERE is_base
  DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.ensure_product_base_unit() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ensure_product_base_unit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_products_ensure_base_unit
  ON public.products;
CREATE TRIGGER trg_products_ensure_base_unit
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_product_base_unit();

-- Existing products receive exactly one compatibility base row. The predicate
-- and partial unique index make this backfill idempotent without rewriting any
-- product balance, price, tracking flag, or historical document.
INSERT INTO public.product_units (
  tenant_id,
  branch_id,
  product_id,
  name,
  name_ar,
  unit_code,
  conversion_to_base,
  quantity_scale,
  pricing_method,
  custom_selling_price,
  selling_enabled,
  receiving_enabled,
  is_base,
  is_active,
  sort_order,
  version,
  created_by,
  updated_by
)
SELECT
  p.tenant_id,
  p.branch_id,
  p.id,
  COALESCE(NULLIF(btrim(p.unit), ''), 'Piece'),
  NULLIF(btrim(p.unit_ar), ''),
  'PCE',
  1,
  3,
  'calculated',
  NULL,
  COALESCE(p.is_available, true),
  COALESCE(p.is_service, false) IS FALSE,
  true,
  true,
  0,
  1,
  NULL,
  NULL
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_units pu
  WHERE pu.product_id = p.id
    AND pu.is_base IS TRUE
)
ON CONFLICT (product_id) WHERE is_base
DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_product_units(
  p_product_id uuid
)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  name text,
  name_ar text,
  unit_code text,
  conversion_to_base numeric,
  quantity_scale smallint,
  pricing_method text,
  custom_selling_price numeric,
  resolved_selling_price numeric,
  selling_enabled boolean,
  receiving_enabled boolean,
  is_base boolean,
  is_active boolean,
  sort_order integer,
  version integer,
  first_used_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_product record;
  v_scope record;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Missing product id'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.price, p.is_active
    INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_product.branch_id
  THEN
    RAISE EXCEPTION 'Product belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pu.id,
    pu.product_id,
    pu.name::text,
    pu.name_ar::text,
    pu.unit_code::text,
    pu.conversion_to_base,
    pu.quantity_scale,
    pu.pricing_method,
    pu.custom_selling_price,
    CASE
      WHEN pu.pricing_method = 'custom' THEN pu.custom_selling_price
      ELSE round(COALESCE(v_product.price, 0) * pu.conversion_to_base, 2)
    END AS resolved_selling_price,
    pu.selling_enabled,
    pu.receiving_enabled,
    pu.is_base,
    pu.is_active,
    pu.sort_order,
    pu.version,
    pu.first_used_at,
    pu.created_at,
    pu.updated_at
  FROM public.product_units pu
  WHERE pu.product_id = v_product.id
    AND pu.tenant_id = v_product.tenant_id
    AND pu.branch_id = v_product.branch_id
  ORDER BY pu.is_base DESC, pu.sort_order, pu.created_at, pu.id;
END;
$function$;

ALTER FUNCTION public.get_product_units(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.create_product_unit(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_product record;
  v_scope record;
  v_product_id uuid;
  v_unit_id uuid := pg_catalog.gen_random_uuid();
  v_name text;
  v_name_ar text;
  v_unit_code text;
  v_conversion_raw numeric;
  v_conversion numeric(18, 6);
  v_quantity_scale smallint;
  v_pricing_method text;
  v_custom_price numeric(14, 2);
  v_selling_enabled boolean;
  v_receiving_enabled boolean;
  v_sort_order integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid product unit payload'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'name',
      'name_ar',
      'unit_code',
      'conversion_to_base',
      'quantity_scale',
      'pricing_method',
      'custom_selling_price',
      'selling_enabled',
      'receiving_enabled',
      'sort_order'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product unit field'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := NULLIF(btrim(COALESCE(p_payload ->> 'product_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id'
      USING ERRCODE = '22023';
  END;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Missing product id'
      USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  v_name_ar := NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), '');
  v_unit_code := upper(NULLIF(btrim(COALESCE(p_payload ->> 'unit_code', '')), ''));
  v_pricing_method := COALESCE(
    NULLIF(btrim(p_payload ->> 'pricing_method'), ''),
    'calculated'
  );

  IF v_name IS NULL OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Product unit name is required and must not exceed 80 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_name_ar IS NOT NULL AND length(v_name_ar) > 80 THEN
    RAISE EXCEPTION 'Arabic product unit name must not exceed 80 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_unit_code IS NULL OR v_unit_code !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'Invalid product unit code'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_payload -> 'conversion_to_base') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Product unit conversion must be a number'
      USING ERRCODE = '22023';
  END IF;

  v_conversion_raw := (p_payload ->> 'conversion_to_base')::numeric;
  IF v_conversion_raw <= 0 OR scale(v_conversion_raw) > 6 THEN
    RAISE EXCEPTION 'Product unit conversion must be positive with at most 6 decimal places'
      USING ERRCODE = '22023';
  END IF;
  v_conversion := v_conversion_raw::numeric(18, 6);

  IF p_payload ? 'quantity_scale' THEN
    IF jsonb_typeof(p_payload -> 'quantity_scale') IS DISTINCT FROM 'number'
       OR (p_payload ->> 'quantity_scale')::numeric <> trunc((p_payload ->> 'quantity_scale')::numeric)
    THEN
      RAISE EXCEPTION 'Product unit quantity scale must be an integer'
        USING ERRCODE = '22023';
    END IF;
    v_quantity_scale := (p_payload ->> 'quantity_scale')::smallint;
  ELSE
    v_quantity_scale := 3;
  END IF;

  IF v_quantity_scale NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'Product unit quantity scale must be between 0 and 6'
      USING ERRCODE = '22023';
  END IF;

  IF v_pricing_method NOT IN ('calculated', 'custom') THEN
    RAISE EXCEPTION 'Invalid product unit pricing method'
      USING ERRCODE = '22023';
  END IF;

  IF v_pricing_method = 'custom' THEN
    IF jsonb_typeof(p_payload -> 'custom_selling_price') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Custom product unit price is required'
        USING ERRCODE = '22023';
    END IF;
    v_custom_price := (p_payload ->> 'custom_selling_price')::numeric(14, 2);
    IF v_custom_price < 0 THEN
      RAISE EXCEPTION 'Custom product unit price cannot be negative'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_payload ? 'custom_selling_price'
        AND jsonb_typeof(p_payload -> 'custom_selling_price') IS DISTINCT FROM 'null'
  THEN
    RAISE EXCEPTION 'Calculated product units cannot set a custom price'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload ? 'selling_enabled'
     AND jsonb_typeof(p_payload -> 'selling_enabled') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'selling_enabled must be a boolean'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload ? 'receiving_enabled'
     AND jsonb_typeof(p_payload -> 'receiving_enabled') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'receiving_enabled must be a boolean'
      USING ERRCODE = '22023';
  END IF;

  v_selling_enabled := COALESCE((p_payload ->> 'selling_enabled')::boolean, true);
  v_receiving_enabled := COALESCE((p_payload ->> 'receiving_enabled')::boolean, true);

  IF p_payload ? 'sort_order' THEN
    IF jsonb_typeof(p_payload -> 'sort_order') IS DISTINCT FROM 'number'
       OR (p_payload ->> 'sort_order')::numeric <> trunc((p_payload ->> 'sort_order')::numeric)
    THEN
      RAISE EXCEPTION 'Product unit sort order must be an integer'
        USING ERRCODE = '22023';
    END IF;
    v_sort_order := (p_payload ->> 'sort_order')::integer;
  ELSE
    v_sort_order := 0;
  END IF;

  IF v_sort_order < 0 THEN
    RAISE EXCEPTION 'Product unit sort order cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    p.id,
    p.tenant_id,
    p.branch_id,
    p.is_active,
    p.is_service,
    COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_product.branch_id
  THEN
    RAISE EXCEPTION 'Product belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  IF v_product.business_type = 'service'
     OR COALESCE(v_product.is_service, false) IS TRUE
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO public.product_units (
      id,
      tenant_id,
      branch_id,
      product_id,
      name,
      name_ar,
      unit_code,
      conversion_to_base,
      quantity_scale,
      pricing_method,
      custom_selling_price,
      selling_enabled,
      receiving_enabled,
      is_base,
      is_active,
      sort_order,
      version,
      created_by,
      updated_by
    ) VALUES (
      v_unit_id,
      v_product.tenant_id,
      v_product.branch_id,
      v_product.id,
      v_name,
      v_name_ar,
      v_unit_code,
      v_conversion,
      v_quantity_scale,
      v_pricing_method,
      v_custom_price,
      v_selling_enabled,
      v_receiving_enabled,
      false,
      true,
      v_sort_order,
      1,
      auth.uid(),
      auth.uid()
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'An active product unit with this name already exists'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'product_unit_id', v_unit_id,
    'product_id', v_product.id,
    'version', 1,
    'is_base', false
  );
END;
$function$;

ALTER FUNCTION public.create_product_unit(jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.update_product_unit(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_unit public.product_units%ROWTYPE;
  v_product record;
  v_scope record;
  v_unit_id uuid;
  v_expected_version integer;
  v_name text;
  v_name_ar text;
  v_unit_code text;
  v_conversion_raw numeric;
  v_conversion numeric(18, 6);
  v_quantity_scale smallint;
  v_pricing_method text;
  v_custom_price numeric(14, 2);
  v_selling_enabled boolean;
  v_receiving_enabled boolean;
  v_sort_order integer;
  v_changed boolean;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid product unit payload'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_unit_id',
      'expected_version',
      'name',
      'name_ar',
      'unit_code',
      'conversion_to_base',
      'quantity_scale',
      'pricing_method',
      'custom_selling_price',
      'selling_enabled',
      'receiving_enabled',
      'sort_order'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product unit field'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_unit_id := NULLIF(btrim(COALESCE(p_payload ->> 'product_unit_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product unit id'
      USING ERRCODE = '22023';
  END;

  IF v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Missing product unit id'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_payload -> 'expected_version') IS DISTINCT FROM 'number'
     OR (p_payload ->> 'expected_version')::numeric <> trunc((p_payload ->> 'expected_version')::numeric)
  THEN
    RAISE EXCEPTION 'Expected product unit version must be an integer'
      USING ERRCODE = '22023';
  END IF;
  v_expected_version := (p_payload ->> 'expected_version')::integer;

  SELECT *
    INTO v_unit
  FROM public.product_units
  WHERE id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product unit not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    p.id,
    p.tenant_id,
    p.branch_id,
    p.is_active,
    p.is_service,
    COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_unit.product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_unit.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_unit.branch_id
     OR v_product.tenant_id IS DISTINCT FROM v_unit.tenant_id
     OR v_product.branch_id IS DISTINCT FROM v_unit.branch_id
  THEN
    RAISE EXCEPTION 'Product unit belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  IF v_expected_version <> v_unit.version THEN
    RAISE EXCEPTION 'Product unit was changed by another request'
      USING ERRCODE = '40001';
  END IF;

  IF v_unit.is_base IS FALSE
     AND (
       v_product.business_type = 'service'
       OR COALESCE(v_product.is_service, false) IS TRUE
     )
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;

  v_name := CASE
    WHEN p_payload ? 'name'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '')
    ELSE v_unit.name
  END;
  v_name_ar := CASE
    WHEN p_payload ? 'name_ar'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), '')
    ELSE v_unit.name_ar
  END;
  v_unit_code := CASE
    WHEN p_payload ? 'unit_code'
      THEN upper(NULLIF(btrim(COALESCE(p_payload ->> 'unit_code', '')), ''))
    ELSE v_unit.unit_code
  END;

  IF v_name IS NULL OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Product unit name is required and must not exceed 80 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_name_ar IS NOT NULL AND length(v_name_ar) > 80 THEN
    RAISE EXCEPTION 'Arabic product unit name must not exceed 80 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_unit_code IS NULL OR v_unit_code !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'Invalid product unit code'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload ? 'conversion_to_base' THEN
    IF jsonb_typeof(p_payload -> 'conversion_to_base') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Product unit conversion must be a number'
        USING ERRCODE = '22023';
    END IF;
    v_conversion_raw := (p_payload ->> 'conversion_to_base')::numeric;
    IF v_conversion_raw <= 0 OR scale(v_conversion_raw) > 6 THEN
      RAISE EXCEPTION 'Product unit conversion must be positive with at most 6 decimal places'
        USING ERRCODE = '22023';
    END IF;
    v_conversion := v_conversion_raw::numeric(18, 6);
  ELSE
    v_conversion := v_unit.conversion_to_base;
  END IF;

  IF v_unit.is_base IS TRUE AND v_conversion <> 1 THEN
    RAISE EXCEPTION 'A product base unit conversion must remain 1'
      USING ERRCODE = '23514';
  END IF;

  IF v_unit.first_used_at IS NOT NULL
     AND v_conversion IS DISTINCT FROM v_unit.conversion_to_base
  THEN
    RAISE EXCEPTION 'A used product unit conversion cannot be changed; create a new unit'
      USING ERRCODE = '23514';
  END IF;

  IF p_payload ? 'quantity_scale' THEN
    IF jsonb_typeof(p_payload -> 'quantity_scale') IS DISTINCT FROM 'number'
       OR (p_payload ->> 'quantity_scale')::numeric <> trunc((p_payload ->> 'quantity_scale')::numeric)
    THEN
      RAISE EXCEPTION 'Product unit quantity scale must be an integer'
        USING ERRCODE = '22023';
    END IF;
    v_quantity_scale := (p_payload ->> 'quantity_scale')::smallint;
  ELSE
    v_quantity_scale := v_unit.quantity_scale;
  END IF;

  IF v_quantity_scale NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'Product unit quantity scale must be between 0 and 6'
      USING ERRCODE = '22023';
  END IF;

  v_pricing_method := CASE
    WHEN p_payload ? 'pricing_method'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'pricing_method', '')), '')
    ELSE v_unit.pricing_method
  END;

  IF v_pricing_method NOT IN ('calculated', 'custom') THEN
    RAISE EXCEPTION 'Invalid product unit pricing method'
      USING ERRCODE = '22023';
  END IF;

  IF v_unit.is_base IS TRUE AND v_pricing_method <> 'calculated' THEN
    RAISE EXCEPTION 'A product base unit must use calculated pricing'
      USING ERRCODE = '23514';
  END IF;

  IF v_pricing_method = 'calculated' THEN
    IF p_payload ? 'custom_selling_price'
       AND jsonb_typeof(p_payload -> 'custom_selling_price') IS DISTINCT FROM 'null'
    THEN
      RAISE EXCEPTION 'Calculated product units cannot set a custom price'
        USING ERRCODE = '22023';
    END IF;
    v_custom_price := NULL;
  ELSE
    IF p_payload ? 'custom_selling_price' THEN
      IF jsonb_typeof(p_payload -> 'custom_selling_price') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Custom product unit price is required'
          USING ERRCODE = '22023';
      END IF;
      v_custom_price := (p_payload ->> 'custom_selling_price')::numeric(14, 2);
    ELSE
      v_custom_price := v_unit.custom_selling_price;
    END IF;

    IF v_custom_price IS NULL OR v_custom_price < 0 THEN
      RAISE EXCEPTION 'Custom product unit price is required and cannot be negative'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_payload ? 'selling_enabled'
     AND jsonb_typeof(p_payload -> 'selling_enabled') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'selling_enabled must be a boolean'
      USING ERRCODE = '22023';
  END IF;
  v_selling_enabled := CASE
    WHEN p_payload ? 'selling_enabled'
      THEN (p_payload ->> 'selling_enabled')::boolean
    ELSE v_unit.selling_enabled
  END;

  IF p_payload ? 'receiving_enabled'
     AND jsonb_typeof(p_payload -> 'receiving_enabled') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'receiving_enabled must be a boolean'
      USING ERRCODE = '22023';
  END IF;
  v_receiving_enabled := CASE
    WHEN p_payload ? 'receiving_enabled'
      THEN (p_payload ->> 'receiving_enabled')::boolean
    ELSE v_unit.receiving_enabled
  END;

  IF p_payload ? 'sort_order' THEN
    IF jsonb_typeof(p_payload -> 'sort_order') IS DISTINCT FROM 'number'
       OR (p_payload ->> 'sort_order')::numeric <> trunc((p_payload ->> 'sort_order')::numeric)
    THEN
      RAISE EXCEPTION 'Product unit sort order must be an integer'
        USING ERRCODE = '22023';
    END IF;
    v_sort_order := (p_payload ->> 'sort_order')::integer;
  ELSE
    v_sort_order := v_unit.sort_order;
  END IF;

  IF v_sort_order < 0 THEN
    RAISE EXCEPTION 'Product unit sort order cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  v_changed :=
    v_name IS DISTINCT FROM v_unit.name
    OR v_name_ar IS DISTINCT FROM v_unit.name_ar
    OR v_unit_code IS DISTINCT FROM v_unit.unit_code
    OR v_conversion IS DISTINCT FROM v_unit.conversion_to_base
    OR v_quantity_scale IS DISTINCT FROM v_unit.quantity_scale
    OR v_pricing_method IS DISTINCT FROM v_unit.pricing_method
    OR v_custom_price IS DISTINCT FROM v_unit.custom_selling_price
    OR v_selling_enabled IS DISTINCT FROM v_unit.selling_enabled
    OR v_receiving_enabled IS DISTINCT FROM v_unit.receiving_enabled
    OR v_sort_order IS DISTINCT FROM v_unit.sort_order;

  IF v_changed THEN
    BEGIN
      UPDATE public.product_units
      SET name = v_name,
          name_ar = v_name_ar,
          unit_code = v_unit_code,
          conversion_to_base = v_conversion,
          quantity_scale = v_quantity_scale,
          pricing_method = v_pricing_method,
          custom_selling_price = v_custom_price,
          selling_enabled = v_selling_enabled,
          receiving_enabled = v_receiving_enabled,
          sort_order = v_sort_order,
          version = v_unit.version + 1,
          updated_by = auth.uid()
      WHERE id = v_unit.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'An active product unit with this name already exists'
        USING ERRCODE = '23505';
    END;

    v_unit.version := v_unit.version + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_unit_id', v_unit.id,
    'product_id', v_unit.product_id,
    'version', v_unit.version,
    'changed', v_changed
  );
END;
$function$;

ALTER FUNCTION public.update_product_unit(jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.deactivate_product_unit(
  p_product_unit_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_unit public.product_units%ROWTYPE;
  v_scope record;
BEGIN
  IF p_product_unit_id IS NULL OR p_expected_version IS NULL OR p_expected_version <= 0 THEN
    RAISE EXCEPTION 'Valid product unit id and expected version are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_unit
  FROM public.product_units
  WHERE id = p_product_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product unit not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_scope
  FROM public.assert_product_write_access(v_unit.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_unit.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_unit.branch_id
  THEN
    RAISE EXCEPTION 'Product unit belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  IF v_unit.is_base IS TRUE THEN
    RAISE EXCEPTION 'A product base unit cannot be deactivated'
      USING ERRCODE = '23514';
  END IF;

  IF p_expected_version <> v_unit.version THEN
    RAISE EXCEPTION 'Product unit was changed by another request'
      USING ERRCODE = '40001';
  END IF;

  IF v_unit.is_active IS TRUE THEN
    UPDATE public.product_units
    SET is_active = false,
        version = version + 1,
        updated_by = auth.uid()
    WHERE id = v_unit.id;
    v_unit.version := v_unit.version + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_unit_id', v_unit.id,
    'version', v_unit.version,
    'is_active', false
  );
END;
$function$;

ALTER FUNCTION public.deactivate_product_unit(uuid, integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.reactivate_product_unit(
  p_product_unit_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_unit public.product_units%ROWTYPE;
  v_product record;
  v_scope record;
BEGIN
  IF p_product_unit_id IS NULL OR p_expected_version IS NULL OR p_expected_version <= 0 THEN
    RAISE EXCEPTION 'Valid product unit id and expected version are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_unit
  FROM public.product_units
  WHERE id = p_product_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product unit not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    p.id,
    p.tenant_id,
    p.branch_id,
    p.is_active,
    p.is_service,
    COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_unit.product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_scope
  FROM public.assert_product_write_access(v_unit.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_unit.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_unit.branch_id
     OR v_product.tenant_id IS DISTINCT FROM v_unit.tenant_id
     OR v_product.branch_id IS DISTINCT FROM v_unit.branch_id
  THEN
    RAISE EXCEPTION 'Product unit belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  IF v_unit.is_base IS FALSE
     AND (
       v_product.business_type = 'service'
       OR COALESCE(v_product.is_service, false) IS TRUE
     )
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;

  IF p_expected_version <> v_unit.version THEN
    RAISE EXCEPTION 'Product unit was changed by another request'
      USING ERRCODE = '40001';
  END IF;

  IF v_unit.is_active IS FALSE THEN
    BEGIN
      UPDATE public.product_units
      SET is_active = true,
          version = version + 1,
          updated_by = auth.uid()
      WHERE id = v_unit.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'An active product unit with this name already exists'
        USING ERRCODE = '23505';
    END;
    v_unit.version := v_unit.version + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_unit_id', v_unit.id,
    'version', v_unit.version,
    'is_active', true
  );
END;
$function$;

ALTER FUNCTION public.reactivate_product_unit(uuid, integer) OWNER TO postgres;

-- Private lifecycle helper for later checkout/receiving phases. It is not
-- invoked by Phase 1 and is not executable by browser roles.
CREATE OR REPLACE FUNCTION public.mark_product_unit_used(
  p_product_unit_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  UPDATE public.product_units
  SET first_used_at = COALESCE(first_used_at, now())
  WHERE id = p_product_unit_id
$function$;

ALTER FUNCTION public.mark_product_unit_used(uuid) OWNER TO postgres;

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_units_authenticated_select
  ON public.product_units;
CREATE POLICY product_units_authenticated_select
  ON public.product_units
  FOR SELECT
  TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

DROP POLICY IF EXISTS product_units_service_role_all
  ON public.product_units;
CREATE POLICY product_units_service_role_all
  ON public.product_units
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.product_units
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_units
  TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.product_units
  TO service_role;

REVOKE ALL ON FUNCTION public.get_product_units(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_product_unit(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_product_unit(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_product_unit(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reactivate_product_unit(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_product_unit_used(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_product_units(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_unit(jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_product_unit(jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_product_unit(uuid, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_product_unit(uuid, integer)
  TO authenticated, service_role;

-- Package-ready document snapshots. All columns are nullable so existing
-- checkout, credit notes, reports, and ZATCA code continue unchanged.
ALTER TABLE public.invoice_items
  ADD COLUMN product_unit_id uuid,
  ADD COLUMN product_unit_version integer,
  ADD COLUMN selling_unit_name varchar(80),
  ADD COLUMN selling_unit_name_ar varchar(80),
  ADD COLUMN selling_unit_code varchar(8),
  ADD COLUMN package_quantity numeric(18, 6),
  ADD COLUMN package_quantity_scale smallint,
  ADD COLUMN conversion_to_base numeric(18, 6),
  ADD COLUMN base_quantity numeric(18, 6),
  ADD COLUMN base_unit_name varchar(80),
  ADD COLUMN base_unit_name_ar varchar(80),
  ADD COLUMN base_unit_code varchar(8),
  ADD COLUMN base_quantity_scale smallint,
  ADD COLUMN package_pricing_method text,
  ADD COLUMN base_unit_price numeric(14, 2),
  ADD COLUMN package_unit_price numeric(14, 2),
  ADD COLUMN stock_tracked_at_sale boolean,
  ADD COLUMN service_item_at_sale boolean;

ALTER TABLE public.product_stock_receipts
  ADD COLUMN product_unit_id uuid,
  ADD COLUMN product_unit_version integer,
  ADD COLUMN package_quantity numeric(18, 6),
  ADD COLUMN conversion_to_base numeric(18, 6),
  ADD COLUMN base_quantity numeric(18, 6),
  ADD COLUMN package_unit_name varchar(80),
  ADD COLUMN base_unit_name varchar(80),
  ADD COLUMN package_unit_code varchar(8),
  ADD COLUMN base_unit_code varchar(8),
  ADD COLUMN package_unit_cost numeric(14, 2),
  ADD COLUMN base_unit_cost numeric(18, 6);

ALTER TABLE public.pos_stock_movements
  ADD COLUMN product_unit_id uuid,
  ADD COLUMN product_unit_version integer,
  ADD COLUMN package_quantity numeric(18, 6),
  ADD COLUMN conversion_to_base numeric(18, 6),
  ADD COLUMN base_quantity numeric(18, 6),
  ADD COLUMN selling_unit_name varchar(80),
  ADD COLUMN base_unit_name varchar(80);

ALTER TABLE public.purchase_items
  ADD COLUMN stock_target_type text,
  ADD COLUMN product_id uuid,
  ADD COLUMN product_unit_id uuid,
  ADD COLUMN product_unit_version integer,
  ADD COLUMN package_quantity numeric(18, 6),
  ADD COLUMN conversion_to_base numeric(18, 6),
  ADD COLUMN base_quantity numeric(18, 6),
  ADD COLUMN purchase_unit_name varchar(80),
  ADD COLUMN base_unit_name varchar(80),
  ADD COLUMN package_unit_code varchar(8),
  ADD COLUMN base_unit_code varchar(8),
  ADD COLUMN package_unit_cost numeric(14, 2),
  ADD COLUMN base_unit_cost numeric(18, 6);

ALTER TABLE public.purchase_stock_movements
  ADD COLUMN stock_target_type text,
  ADD COLUMN product_id uuid,
  ADD COLUMN product_unit_id uuid,
  ADD COLUMN product_unit_version integer,
  ADD COLUMN package_quantity numeric(18, 6),
  ADD COLUMN conversion_to_base numeric(18, 6),
  ADD COLUMN base_quantity numeric(18, 6),
  ADD COLUMN package_unit_name varchar(80),
  ADD COLUMN base_unit_name varchar(80);

-- NOT VALID avoids scanning historical transaction tables in this additive
-- release. PostgreSQL still enforces these foreign keys and target-type checks
-- for every new non-NULL value; a later package-writing phase can validate the
-- historical side after its preflight confirms all Phase 1 columns are NULL.
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_product_unit_id_fkey
  FOREIGN KEY (product_unit_id, product_id)
  REFERENCES public.product_units(id, product_id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT invoice_items_product_unit_requires_product
  CHECK (product_unit_id IS NULL OR product_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.product_stock_receipts
  ADD CONSTRAINT product_stock_receipts_product_unit_id_fkey
  FOREIGN KEY (product_unit_id, product_id)
  REFERENCES public.product_units(id, product_id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.pos_stock_movements
  ADD CONSTRAINT pos_stock_movements_product_unit_id_fkey
  FOREIGN KEY (product_unit_id, product_id)
  REFERENCES public.product_units(id, product_id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT pos_stock_movements_product_unit_requires_product
  CHECK (product_unit_id IS NULL OR product_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_product_id_package_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT purchase_items_product_unit_id_fkey
  FOREIGN KEY (product_unit_id, product_id)
  REFERENCES public.product_units(id, product_id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT purchase_items_product_unit_requires_product
  CHECK (product_unit_id IS NULL OR product_id IS NOT NULL)
  NOT VALID,
  ADD CONSTRAINT purchase_items_stock_target_type_check
  CHECK (
    stock_target_type IS NULL
    OR stock_target_type IN ('none', 'inventory_item', 'saleable_product')
  )
  NOT VALID;

ALTER TABLE public.purchase_stock_movements
  ADD CONSTRAINT purchase_stock_movements_product_id_package_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT purchase_stock_movements_product_unit_id_fkey
  FOREIGN KEY (product_unit_id, product_id)
  REFERENCES public.product_units(id, product_id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT purchase_stock_movements_product_unit_requires_product
  CHECK (product_unit_id IS NULL OR product_id IS NOT NULL)
  NOT VALID,
  ADD CONSTRAINT purchase_stock_movements_stock_target_type_check
  CHECK (
    stock_target_type IS NULL
    OR stock_target_type IN ('inventory_item', 'saleable_product')
  )
  NOT VALID;

-- purchase_items has a legacy authenticated table-level INSERT grant. Replace
-- it with the same original-column access so Phase 1 snapshot columns remain
-- database-owned and cannot be populated directly by browser clients.
REVOKE INSERT ON TABLE public.purchase_items
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  id,
  purchase_id,
  inventory_item_id,
  name,
  quantity,
  unit_cost,
  total,
  created_at,
  supplier_item_name,
  line_type,
  receiving_status,
  received_quantity,
  tax_rate,
  vat_amount,
  discount_amount,
  match_confidence,
  match_source,
  ignored_at,
  confirmed_at
) ON public.purchase_items TO authenticated;

COMMENT ON COLUMN public.invoice_items.product_unit_id IS
  'Nullable Phase 1 package reference. Legacy invoice rows remain NULL and are not inferred from current product configuration.';

COMMENT ON COLUMN public.purchase_items.stock_target_type IS
  'Reserved for a later explicit inventory_item or saleable_product receiving target; Phase 1 leaves all existing and new legacy rows NULL.';

COMMIT;
