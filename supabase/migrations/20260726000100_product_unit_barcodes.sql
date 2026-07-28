BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.normalize_product_barcode(p_barcode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
  SELECT btrim(p_barcode, E' \t\r\n');
$function$;

REVOKE ALL ON FUNCTION public.normalize_product_barcode(text)
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.product_unit_barcodes (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_unit_id uuid NOT NULL,
  barcode text NOT NULL,
  normalized_barcode text GENERATED ALWAYS AS
    (public.normalize_product_barcode(barcode)) STORED,
  barcode_type text NOT NULL DEFAULT 'unknown',
  source text NOT NULL DEFAULT 'manufacturer',
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  label_name text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  disabled_by uuid,
  CONSTRAINT product_unit_barcodes_unit_scope_fkey
    FOREIGN KEY (product_unit_id, product_id)
    REFERENCES public.product_units (id, product_id),
  CONSTRAINT product_unit_barcodes_product_scope_fkey
    FOREIGN KEY (product_id, tenant_id, branch_id)
    REFERENCES public.products (id, tenant_id, branch_id),
  CONSTRAINT product_unit_barcodes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  CONSTRAINT product_unit_barcodes_disabled_by_fkey
    FOREIGN KEY (disabled_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  CONSTRAINT product_unit_barcodes_value_length
    CHECK (length(normalized_barcode) BETWEEN 3 AND 128),
  CONSTRAINT product_unit_barcodes_no_controls
    CHECK (normalized_barcode !~ '[[:cntrl:]]'),
  CONSTRAINT product_unit_barcodes_type
    CHECK (barcode_type IN (
      'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf14',
      'gs1_databar', 'gs1_128', 'gs1_datamatrix', 'qr', 'unknown'
    )),
  CONSTRAINT product_unit_barcodes_source
    CHECK (source IN ('manufacturer', 'supplier', 'internal', 'imported')),
  CONSTRAINT product_unit_barcodes_internal_contract
    CHECK (
      source <> 'internal'
      OR (barcode_type = 'code128' AND normalized_barcode ~ '^DF[0-9A-F]{18}$')
    ),
  CONSTRAINT product_unit_barcodes_label_name
    CHECK (label_name IS NULL OR length(btrim(label_name)) BETWEEN 1 AND 80),
  CONSTRAINT product_unit_barcodes_notes
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 500),
  CONSTRAINT product_unit_barcodes_disable_state
    CHECK (
      (is_active AND disabled_at IS NULL AND disabled_by IS NULL)
      OR
      (NOT is_active AND disabled_at IS NOT NULL)
    )
);

ALTER TABLE public.product_unit_barcodes OWNER TO postgres;

CREATE UNIQUE INDEX product_unit_barcodes_active_branch_value_uidx
  ON public.product_unit_barcodes (branch_id, normalized_barcode)
  WHERE is_active;

CREATE UNIQUE INDEX product_unit_barcodes_one_primary_unit_uidx
  ON public.product_unit_barcodes (product_unit_id)
  WHERE is_active AND is_primary;

CREATE INDEX product_unit_barcodes_product_unit_idx
  ON public.product_unit_barcodes (product_id, product_unit_id, created_at, id);

COMMENT ON TABLE public.product_unit_barcodes IS
  'Branch-owned barcode aliases for authoritative commercial product units. Disabled identities are retained and never silently reassigned.';
COMMENT ON INDEX product_unit_barcodes_active_branch_value_uidx IS
  'Catalogues and products are branch-owned; active barcode identity is therefore unique within a branch.';

CREATE TABLE public.product_barcode_print_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_unit_id uuid NOT NULL,
  product_unit_barcode_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  print_kind text NOT NULL,
  copies integer NOT NULL,
  label_template text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_barcode_print_events_barcode_fkey
    FOREIGN KEY (product_unit_barcode_id)
    REFERENCES public.product_unit_barcodes(id),
  CONSTRAINT product_barcode_print_events_actor_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.user_profiles(id),
  CONSTRAINT product_barcode_print_events_copies
    CHECK (copies BETWEEN 1 AND 500),
  CONSTRAINT product_barcode_print_events_kind
    CHECK (print_kind IN ('first_print', 'reprint')),
  CONSTRAINT product_barcode_print_events_template
    CHECK (length(btrim(label_template)) BETWEEN 1 AND 40),
  CONSTRAINT product_barcode_print_events_reason
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 200)
);

ALTER TABLE public.product_barcode_print_events OWNER TO postgres;
CREATE INDEX product_barcode_print_events_scope_idx
  ON public.product_barcode_print_events
  (tenant_id, branch_id, product_unit_barcode_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_gtin_check_digit(
  p_value text,
  p_expected_length integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
DECLARE
  v_sum integer := 0;
  v_index integer;
  v_digit integer;
BEGIN
  IF p_expected_length NOT IN (8, 12, 13, 14)
     OR length(p_value) <> p_expected_length
     OR p_value !~ '^[0-9]+$'
  THEN
    RETURN false;
  END IF;
  FOR v_index IN 1..p_expected_length - 1 LOOP
    v_digit := substr(p_value, v_index, 1)::integer;
    v_sum := v_sum + v_digit
      * CASE WHEN ((p_expected_length - v_index) % 2) = 1 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN ((10 - (v_sum % 10)) % 10)
    = substr(p_value, p_expected_length, 1)::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_gtin_check_digit(text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_product_barcode_value(
  p_barcode text,
  p_barcode_type text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_barcode text := public.normalize_product_barcode(p_barcode);
  v_length integer;
BEGIN
  v_length := length(v_barcode);
  IF v_length NOT BETWEEN 3 AND 128 OR v_barcode ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Barcode must contain 3 to 128 printable characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_barcode_type = 'ean13' AND NOT public.validate_gtin_check_digit(v_barcode, 13)
     OR p_barcode_type = 'ean8' AND NOT public.validate_gtin_check_digit(v_barcode, 8)
     OR p_barcode_type = 'upca' AND NOT public.validate_gtin_check_digit(v_barcode, 12)
     OR p_barcode_type = 'itf14' AND NOT public.validate_gtin_check_digit(v_barcode, 14)
  THEN
    RAISE EXCEPTION 'Invalid barcode check digit'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_barcode;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_product_barcode_value(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_barcode_scope(
  p_product_unit_id uuid
)
RETURNS TABLE (
  user_id uuid,
  actor_role text,
  tenant_id uuid,
  branch_id uuid,
  product_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_product_unit_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and product unit are required'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT up.id, up.role, pu.tenant_id, pu.branch_id, pu.product_id
  FROM public.product_units pu
  JOIN public.products p
    ON p.id = pu.product_id
   AND p.tenant_id = pu.tenant_id
   AND p.branch_id = pu.branch_id
  JOIN public.user_profiles up ON up.id = v_user_id
  WHERE pu.id = p_product_unit_id
    AND p.is_active IS TRUE
    AND up.is_active IS TRUE
    AND (
      up.role = 'super_admin'
      OR (up.role = 'owner' AND up.tenant_id = pu.tenant_id)
      OR (
        up.role = 'branch'
        AND up.tenant_id = pu.tenant_id
        AND up.branch_id = pu.branch_id
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product unit not found or access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

ALTER FUNCTION public.product_barcode_scope(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.product_barcode_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_product_unit_barcode(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_id uuid;
  v_value text;
  v_type text := COALESCE(NULLIF(btrim(p_payload->>'barcode_type'), ''), 'unknown');
  v_source text := COALESCE(NULLIF(btrim(p_payload->>'source'), ''), 'manufacturer');
  v_primary boolean := COALESCE((p_payload->>'is_primary')::boolean, false);
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY[
       'product_unit_id', 'barcode', 'barcode_type', 'source',
       'is_primary', 'label_name', 'notes'
     ] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Invalid barcode payload' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN (
    'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf14',
    'gs1_databar', 'gs1_128', 'gs1_datamatrix', 'qr', 'unknown'
  ) OR v_source NOT IN ('manufacturer', 'supplier', 'internal', 'imported') THEN
    RAISE EXCEPTION 'Invalid barcode metadata' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope
  FROM public.product_barcode_scope((p_payload->>'product_unit_id')::uuid);
  v_value := public.assert_product_barcode_value(p_payload->>'barcode', v_type);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope.branch_id::text || ':' || v_value, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.product_unit_barcodes b
    WHERE b.branch_id = v_scope.branch_id
      AND b.normalized_barcode = v_value
  ) THEN
    RAISE EXCEPTION 'Barcode is already assigned in this branch'
      USING ERRCODE = '23505';
  END IF;
  IF v_primary THEN
    UPDATE public.product_unit_barcodes
    SET is_primary = false, updated_at = now()
    WHERE product_unit_id = (p_payload->>'product_unit_id')::uuid
      AND is_active AND is_primary;
  END IF;
  INSERT INTO public.product_unit_barcodes (
    tenant_id, branch_id, product_id, product_unit_id, barcode,
    barcode_type, source, is_primary, label_name, notes, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_scope.product_id,
    (p_payload->>'product_unit_id')::uuid, v_value, v_type, v_source,
    v_primary,
    NULLIF(btrim(p_payload->>'label_name'), ''),
    NULLIF(btrim(p_payload->>'notes'), ''),
    v_scope.user_id
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'barcode', v_value);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Barcode is already assigned in this branch'
      USING ERRCODE = '23505';
END;
$function$;

ALTER FUNCTION public.create_product_unit_barcode(jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.update_product_unit_barcode(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_barcode public.product_unit_barcodes%ROWTYPE;
  v_scope record;
  v_type text;
  v_source text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['barcode_id', 'barcode_type', 'source', 'label_name', 'notes'] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Invalid barcode metadata payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_barcode FROM public.product_unit_barcodes
  WHERE id = (p_payload->>'barcode_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.product_barcode_scope(v_barcode.product_unit_id);
  v_type := COALESCE(NULLIF(btrim(p_payload->>'barcode_type'), ''), v_barcode.barcode_type);
  v_source := COALESCE(NULLIF(btrim(p_payload->>'source'), ''), v_barcode.source);
  IF v_type NOT IN (
    'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf14',
    'gs1_databar', 'gs1_128', 'gs1_datamatrix', 'qr', 'unknown'
  ) OR v_source NOT IN ('manufacturer', 'supplier', 'internal', 'imported') THEN
    RAISE EXCEPTION 'Invalid barcode metadata' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_product_barcode_value(v_barcode.barcode, v_type);
  UPDATE public.product_unit_barcodes
  SET barcode_type = v_type,
      source = v_source,
      label_name = CASE WHEN p_payload ? 'label_name' THEN NULLIF(btrim(p_payload->>'label_name'), '') ELSE label_name END,
      notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(btrim(p_payload->>'notes'), '') ELSE notes END,
      updated_at = now()
  WHERE id = v_barcode.id
  RETURNING * INTO v_barcode;
  RETURN to_jsonb(v_barcode) - 'tenant_id' - 'branch_id';
END;
$function$;

ALTER FUNCTION public.update_product_unit_barcode(jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.disable_product_unit_barcode(p_barcode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_barcode public.product_unit_barcodes%ROWTYPE;
  v_scope record;
BEGIN
  SELECT * INTO v_barcode FROM public.product_unit_barcodes
  WHERE id = p_barcode_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Barcode not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.product_barcode_scope(v_barcode.product_unit_id);
  IF NOT v_barcode.is_active THEN
    RETURN jsonb_build_object('id', v_barcode.id, 'is_active', false);
  END IF;
  UPDATE public.product_unit_barcodes
  SET is_active = false, is_primary = false, disabled_at = now(),
      disabled_by = v_scope.user_id, updated_at = now()
  WHERE id = v_barcode.id;
  RETURN jsonb_build_object('id', v_barcode.id, 'is_active', false);
END;
$function$;

ALTER FUNCTION public.disable_product_unit_barcode(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_primary_product_unit_barcode(p_barcode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_barcode public.product_unit_barcodes%ROWTYPE;
  v_scope record;
BEGIN
  SELECT * INTO v_barcode FROM public.product_unit_barcodes
  WHERE id = p_barcode_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active barcode not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.product_barcode_scope(v_barcode.product_unit_id);
  UPDATE public.product_unit_barcodes
  SET is_primary = (id = v_barcode.id), updated_at = now()
  WHERE product_unit_id = v_barcode.product_unit_id AND is_active;
  RETURN jsonb_build_object('id', v_barcode.id, 'is_primary', true);
END;
$function$;

ALTER FUNCTION public.set_primary_product_unit_barcode(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.reactivate_product_unit_barcode(p_barcode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_barcode public.product_unit_barcodes%ROWTYPE;
  v_scope record;
BEGIN
  SELECT * INTO v_barcode FROM public.product_unit_barcodes
  WHERE id = p_barcode_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Barcode not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.product_barcode_scope(v_barcode.product_unit_id);
  IF v_barcode.is_active THEN
    RETURN jsonb_build_object('id', v_barcode.id, 'is_active', true);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope.branch_id::text || ':' || v_barcode.normalized_barcode, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.product_unit_barcodes b
    WHERE b.branch_id = v_scope.branch_id
      AND b.normalized_barcode = v_barcode.normalized_barcode
      AND b.is_active
      AND b.id <> v_barcode.id
  ) THEN
    RAISE EXCEPTION 'Barcode is already assigned in this branch'
      USING ERRCODE = '23505';
  END IF;
  UPDATE public.product_unit_barcodes
  SET is_active = true, disabled_at = NULL, disabled_by = NULL, updated_at = now()
  WHERE id = v_barcode.id;
  RETURN jsonb_build_object('id', v_barcode.id, 'is_active', true);
END;
$function$;

ALTER FUNCTION public.reactivate_product_unit_barcode(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_product_unit_barcodes(p_product_id uuid)
RETURNS TABLE (
  id uuid, product_id uuid, product_unit_id uuid, barcode text,
  barcode_type text, source text, is_primary boolean, is_active boolean,
  label_name text, notes text, created_at timestamptz, disabled_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_unit_id uuid;
BEGIN
  SELECT pu.id INTO v_unit_id FROM public.product_units pu
  WHERE pu.product_id = p_product_id ORDER BY pu.is_base DESC, pu.id LIMIT 1;
  PERFORM public.product_barcode_scope(v_unit_id);
  RETURN QUERY
  SELECT b.id, b.product_id, b.product_unit_id, b.barcode, b.barcode_type,
    b.source, b.is_primary, b.is_active, b.label_name, b.notes,
    b.created_at, b.disabled_at
  FROM public.product_unit_barcodes b
  WHERE b.product_id = p_product_id
  ORDER BY b.product_unit_id, b.is_active DESC, b.is_primary DESC, b.created_at, b.id;
END;
$function$;

ALTER FUNCTION public.list_product_unit_barcodes(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.resolve_product_unit_barcode(
  p_branch_id uuid,
  p_barcode text
)
RETURNS TABLE (
  resolution_status text, barcode_id uuid, barcode text, barcode_type text,
  product_id uuid, product_unit_id uuid, product_unit_version integer,
  product_name text, product_name_ar text, sku text,
  unit_name text, unit_name_ar text, unit_code text,
  conversion_to_base numeric, quantity_scale smallint,
  pricing_method text, selling_price numeric,
  stock_quantity numeric, track_stock boolean, is_service boolean,
  stock_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user public.user_profiles%ROWTYPE;
  v_value text := public.normalize_product_barcode(p_barcode);
BEGIN
  SELECT * INTO v_user FROM public.user_profiles WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR NOT (
    v_user.role = 'super_admin'
    OR (v_user.role = 'owner' AND EXISTS (
      SELECT 1 FROM public.branches br
      WHERE br.id = p_branch_id AND br.tenant_id = v_user.tenant_id
    ))
    OR (v_user.role = 'branch' AND v_user.branch_id = p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Branch access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    CASE
      WHEN NOT b.is_active THEN 'inactive_barcode'
      WHEN NOT p.is_active OR NOT p.is_available THEN 'inactive_product'
      WHEN NOT pu.is_active OR NOT pu.selling_enabled THEN 'inactive_unit'
      ELSE 'active'
    END,
    b.id, b.barcode, b.barcode_type, p.id, pu.id, pu.version,
    p.name::text, p.name_ar::text, p.sku::text,
    pu.name::text, pu.name_ar::text, pu.unit_code::text,
    pu.conversion_to_base, pu.quantity_scale, pu.pricing_method,
    CASE WHEN pu.pricing_method = 'custom'
      THEN pu.custom_selling_price
      ELSE round(p.price * pu.conversion_to_base, 2)
    END,
    p.stock_quantity, p.track_stock, p.is_service,
    public.branch_effective_stock_enabled(p.tenant_id, p.branch_id)
  FROM public.product_unit_barcodes b
  JOIN public.products p ON p.id = b.product_id
  JOIN public.product_units pu ON pu.id = b.product_unit_id
  WHERE b.branch_id = p_branch_id
    AND b.normalized_barcode = v_value
  ORDER BY b.is_active DESC, b.created_at DESC, b.id
  LIMIT 1;
END;
$function$;

ALTER FUNCTION public.resolve_product_unit_barcode(uuid, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.generate_internal_product_unit_barcode(
  p_product_unit_id uuid,
  p_is_primary boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_value text;
BEGIN
  SELECT * INTO v_scope FROM public.product_barcode_scope(p_product_unit_id);
  LOOP
    v_value := 'DF' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 18));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.product_unit_barcodes
      WHERE branch_id = v_scope.branch_id AND normalized_barcode = v_value
    );
  END LOOP;
  RETURN public.create_product_unit_barcode(jsonb_build_object(
    'product_unit_id', p_product_unit_id,
    'barcode', v_value,
    'barcode_type', 'code128',
    'source', 'internal',
    'is_primary', p_is_primary
  ));
END;
$function$;

ALTER FUNCTION public.generate_internal_product_unit_barcode(uuid, boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_product_barcode_print(
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_barcode public.product_unit_barcodes%ROWTYPE;
  v_scope record;
  v_id uuid;
  v_copies integer;
  v_kind text;
  v_reason text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY[
       'barcode_id', 'copies', 'label_template', 'print_kind', 'reason'
     ] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Invalid print payload' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_copies := (p_payload->>'copies')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid print request' USING ERRCODE = '22023';
  END;
  v_reason := NULLIF(btrim(p_payload->>'reason'), '');
  SELECT * INTO v_barcode FROM public.product_unit_barcodes
  WHERE id = (p_payload->>'barcode_id')::uuid AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active barcode not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.product_barcode_scope(v_barcode.product_unit_id);
  IF v_copies IS NULL OR v_copies NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid print request' USING ERRCODE = '22023';
  END IF;
  IF v_copies > 50 AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'A reason is required for more than 50 copies' USING ERRCODE = '22023';
  END IF;
  v_kind := CASE WHEN EXISTS (
    SELECT 1 FROM public.product_barcode_print_events pe
    WHERE pe.product_unit_barcode_id = v_barcode.id
  ) THEN 'reprint' ELSE 'first_print' END;
  INSERT INTO public.product_barcode_print_events (
    tenant_id, branch_id, product_id, product_unit_id,
    product_unit_barcode_id, actor_user_id, print_kind, copies,
    label_template, reason
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_scope.product_id,
    v_barcode.product_unit_id, v_barcode.id, v_scope.user_id, v_kind,
    v_copies, COALESCE(NULLIF(btrim(p_payload->>'label_template'), ''), 'thermal_50x30'),
    v_reason
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

ALTER FUNCTION public.record_product_barcode_print(jsonb) OWNER TO postgres;

-- Preserve existing externally-used base-product barcodes. The preflight and
-- this guard deliberately reject ambiguous branch duplicates rather than
-- silently assigning them.
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE NULLIF(public.normalize_product_barcode(p.barcode), '') IS NOT NULL
    GROUP BY p.branch_id, public.normalize_product_barcode(p.barcode)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate legacy product barcodes require resolution before migration';
  END IF;
END;
$block$;

INSERT INTO public.product_unit_barcodes (
  tenant_id, branch_id, product_id, product_unit_id, barcode,
  barcode_type, source, is_primary, created_by
)
SELECT p.tenant_id, p.branch_id, p.id, pu.id,
  public.normalize_product_barcode(p.barcode),
  'unknown', 'imported', true, NULL
FROM public.products p
JOIN public.product_units pu ON pu.product_id = p.id AND pu.is_base
WHERE NULLIF(public.normalize_product_barcode(p.barcode), '') IS NOT NULL;

ALTER TABLE public.product_unit_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_barcode_print_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_unit_barcodes_service_role_all
  ON public.product_unit_barcodes TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY product_barcode_print_events_service_role_all
  ON public.product_barcode_print_events TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.product_unit_barcodes
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_barcode_print_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.product_unit_barcodes TO service_role;
GRANT ALL ON TABLE public.product_barcode_print_events TO service_role;

REVOKE ALL ON FUNCTION public.create_product_unit_barcode(jsonb),
  public.update_product_unit_barcode(jsonb),
  public.disable_product_unit_barcode(uuid),
  public.reactivate_product_unit_barcode(uuid),
  public.set_primary_product_unit_barcode(uuid),
  public.list_product_unit_barcodes(uuid),
  public.resolve_product_unit_barcode(uuid, text),
  public.generate_internal_product_unit_barcode(uuid, boolean),
  public.record_product_barcode_print(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_product_unit_barcode(jsonb),
  public.update_product_unit_barcode(jsonb),
  public.disable_product_unit_barcode(uuid),
  public.reactivate_product_unit_barcode(uuid),
  public.set_primary_product_unit_barcode(uuid),
  public.list_product_unit_barcodes(uuid),
  public.resolve_product_unit_barcode(uuid, text),
  public.generate_internal_product_unit_barcode(uuid, boolean),
  public.record_product_barcode_print(jsonb)
  TO authenticated, service_role;

COMMIT;
