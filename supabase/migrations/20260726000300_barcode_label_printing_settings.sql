BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE UNIQUE INDEX IF NOT EXISTS branches_id_tenant_id_barcode_settings_uidx
  ON public.branches (id, tenant_id);

CREATE TABLE public.branch_barcode_label_settings (
  branch_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  settings jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_barcode_label_settings_scope_fkey
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES public.branches (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT branch_barcode_label_settings_actor_fkey
    FOREIGN KEY (updated_by)
    REFERENCES public.user_profiles (id),
  CONSTRAINT branch_barcode_label_settings_version
    CHECK (version > 0),
  CONSTRAINT branch_barcode_label_settings_object
    CHECK (jsonb_typeof(settings) = 'object')
);

ALTER TABLE public.branch_barcode_label_settings OWNER TO postgres;

COMMENT ON TABLE public.branch_barcode_label_settings IS
  'Branch-shared barcode label design defaults. Physical printer identity and calibration remain device-local.';

CREATE OR REPLACE FUNCTION public.default_barcode_label_settings()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'preset_id', 'standard_product',
    'template_id', 'standard',
    'output_mode', 'thermal',
    'width_mm', 50,
    'height_mm', 30,
    'margin_mm', 1.5,
    'barcode_height_mm', 12,
    'orientation', 'landscape',
    'text_alignment', 'start',
    'product_name_size', 'normal',
    'price_style', 'large',
    'content', jsonb_build_object(
      'product_name', true,
      'product_name_ar', false,
      'product_name_en', false,
      'selling_price', true,
      'unit_name', true,
      'sku', false,
      'business_name', true,
      'barcode_value', true,
      'print_date', false
    ),
    'a4', jsonb_build_object(
      'orientation', 'portrait',
      'columns', 3,
      'rows', 8,
      'margin_left_mm', 7,
      'margin_right_mm', 7,
      'margin_top_mm', 8,
      'margin_bottom_mm', 8,
      'horizontal_gap_mm', 2,
      'vertical_gap_mm', 2,
      'start_row', 1,
      'start_column', 1
    ),
    'default_copies', 1
  );
$function$;

ALTER FUNCTION public.default_barcode_label_settings() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.validate_barcode_label_settings(
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_content jsonb;
  v_a4 jsonb;
  v_columns integer;
  v_rows integer;
BEGIN
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Invalid barcode label settings payload'
      USING ERRCODE = '22023';
  END IF;

  IF p_settings - ARRAY[
       'schema_version', 'preset_id', 'template_id', 'output_mode',
       'width_mm', 'height_mm', 'margin_mm', 'barcode_height_mm',
       'orientation', 'text_alignment', 'product_name_size', 'price_style',
       'content', 'a4', 'default_copies'
     ] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(p_settings)) <> 15
  THEN
    RAISE EXCEPTION 'Invalid barcode label settings payload'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_settings->'schema_version') <> 'number'
     OR (p_settings->>'schema_version')::numeric <> 1
     OR jsonb_typeof(p_settings->'preset_id') <> 'string'
     OR p_settings->>'preset_id' NOT IN (
       'compact_sticker', 'standard_product', 'detailed_product',
       'carton_label', 'a4_sheet', 'custom'
     )
     OR jsonb_typeof(p_settings->'template_id') <> 'string'
     OR p_settings->>'template_id' NOT IN ('compact', 'standard', 'detailed')
     OR jsonb_typeof(p_settings->'output_mode') <> 'string'
     OR p_settings->>'output_mode' NOT IN ('thermal', 'a4')
     OR jsonb_typeof(p_settings->'orientation') <> 'string'
     OR p_settings->>'orientation' NOT IN ('portrait', 'landscape')
     OR jsonb_typeof(p_settings->'text_alignment') <> 'string'
     OR p_settings->>'text_alignment' NOT IN ('start', 'center')
     OR jsonb_typeof(p_settings->'product_name_size') <> 'string'
     OR p_settings->>'product_name_size' NOT IN ('small', 'normal', 'large')
     OR jsonb_typeof(p_settings->'price_style') <> 'string'
     OR p_settings->>'price_style' NOT IN ('normal', 'large')
  THEN
    RAISE EXCEPTION 'Invalid barcode label setting option'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_settings->'width_mm') <> 'number'
     OR (p_settings->>'width_mm')::numeric NOT BETWEEN 20 AND 200
     OR jsonb_typeof(p_settings->'height_mm') <> 'number'
     OR (p_settings->>'height_mm')::numeric NOT BETWEEN 15 AND 200
     OR jsonb_typeof(p_settings->'margin_mm') <> 'number'
     OR (p_settings->>'margin_mm')::numeric NOT BETWEEN 0 AND 10
     OR jsonb_typeof(p_settings->'barcode_height_mm') <> 'number'
     OR (p_settings->>'barcode_height_mm')::numeric NOT BETWEEN 6 AND 40
     OR jsonb_typeof(p_settings->'default_copies') <> 'number'
     OR (p_settings->>'default_copies')::numeric <> trunc((p_settings->>'default_copies')::numeric)
     OR (p_settings->>'default_copies')::integer NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'Invalid barcode label dimensions or copies'
      USING ERRCODE = '22023';
  END IF;

  v_content := p_settings->'content';
  IF jsonb_typeof(v_content) <> 'object' THEN
    RAISE EXCEPTION 'Invalid or empty barcode label content'
      USING ERRCODE = '22023';
  END IF;

  IF v_content - ARRAY[
       'product_name', 'product_name_ar', 'product_name_en', 'selling_price',
       'unit_name', 'sku', 'business_name', 'barcode_value', 'print_date'
     ] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(v_content)) <> 9
     OR EXISTS (
       SELECT 1
       FROM jsonb_each(v_content) AS entry
       WHERE jsonb_typeof(entry.value) <> 'boolean'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_each(v_content) AS entry
       WHERE entry.value = 'true'::jsonb
     )
  THEN
    RAISE EXCEPTION 'Invalid or empty barcode label content'
      USING ERRCODE = '22023';
  END IF;

  v_a4 := p_settings->'a4';
  IF jsonb_typeof(v_a4) <> 'object' THEN
    RAISE EXCEPTION 'Invalid A4 barcode sheet settings'
      USING ERRCODE = '22023';
  END IF;

  IF v_a4 - ARRAY[
       'orientation', 'columns', 'rows',
       'margin_left_mm', 'margin_right_mm', 'margin_top_mm', 'margin_bottom_mm',
       'horizontal_gap_mm', 'vertical_gap_mm', 'start_row', 'start_column'
     ] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(v_a4)) <> 11
     OR jsonb_typeof(v_a4->'orientation') <> 'string'
     OR v_a4->>'orientation' NOT IN ('portrait', 'landscape')
  THEN
    RAISE EXCEPTION 'Invalid A4 barcode sheet settings'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_a4->'columns') <> 'number'
     OR jsonb_typeof(v_a4->'rows') <> 'number'
     OR jsonb_typeof(v_a4->'start_column') <> 'number'
     OR jsonb_typeof(v_a4->'start_row') <> 'number'
     OR jsonb_typeof(v_a4->'margin_left_mm') <> 'number'
     OR jsonb_typeof(v_a4->'margin_right_mm') <> 'number'
     OR jsonb_typeof(v_a4->'margin_top_mm') <> 'number'
     OR jsonb_typeof(v_a4->'margin_bottom_mm') <> 'number'
     OR jsonb_typeof(v_a4->'horizontal_gap_mm') <> 'number'
     OR jsonb_typeof(v_a4->'vertical_gap_mm') <> 'number'
  THEN
    RAISE EXCEPTION 'Invalid A4 barcode sheet dimensions'
      USING ERRCODE = '22023';
  END IF;

  v_columns := (v_a4->>'columns')::integer;
  v_rows := (v_a4->>'rows')::integer;
  IF (v_a4->>'columns')::numeric <> trunc((v_a4->>'columns')::numeric)
     OR (v_a4->>'rows')::numeric <> trunc((v_a4->>'rows')::numeric)
     OR (v_a4->>'start_column')::numeric <> trunc((v_a4->>'start_column')::numeric)
     OR (v_a4->>'start_row')::numeric <> trunc((v_a4->>'start_row')::numeric)
     OR v_columns NOT BETWEEN 1 AND 10
     OR v_rows NOT BETWEEN 1 AND 20
     OR (v_a4->>'start_column')::integer NOT BETWEEN 1 AND v_columns
     OR (v_a4->>'start_row')::integer NOT BETWEEN 1 AND v_rows
     OR (v_a4->>'margin_left_mm')::numeric NOT BETWEEN 0 AND 30
     OR (v_a4->>'margin_right_mm')::numeric NOT BETWEEN 0 AND 30
     OR (v_a4->>'margin_top_mm')::numeric NOT BETWEEN 0 AND 30
     OR (v_a4->>'margin_bottom_mm')::numeric NOT BETWEEN 0 AND 30
     OR (v_a4->>'horizontal_gap_mm')::numeric NOT BETWEEN 0 AND 20
     OR (v_a4->>'vertical_gap_mm')::numeric NOT BETWEEN 0 AND 20
  THEN
    RAISE EXCEPTION 'Invalid A4 barcode sheet dimensions'
      USING ERRCODE = '22023';
  END IF;

  RETURN p_settings;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid numeric barcode label setting'
      USING ERRCODE = '22023';
END;
$function$;

ALTER FUNCTION public.validate_barcode_label_settings(jsonb) OWNER TO postgres;

ALTER TABLE public.branch_barcode_label_settings
  ADD CONSTRAINT branch_barcode_label_settings_valid
  CHECK (
    public.validate_barcode_label_settings(settings) = settings
  );

CREATE OR REPLACE FUNCTION public.barcode_label_settings_scope(
  p_branch_id uuid
)
RETURNS TABLE (
  user_id uuid,
  actor_role text,
  tenant_id uuid,
  branch_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and branch are required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT up.id, up.role::text, b.tenant_id, b.id
  FROM public.branches b
  JOIN public.user_profiles up ON up.id = v_user_id
  WHERE b.id = p_branch_id
    AND b.is_active IS TRUE
    AND up.is_active IS TRUE
    AND (
      up.role = 'super_admin'
      OR (up.role = 'owner' AND up.tenant_id = b.tenant_id)
      OR (
        up.role = 'branch'
        AND up.tenant_id = b.tenant_id
        AND up.branch_id = b.id
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found or access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

ALTER FUNCTION public.barcode_label_settings_scope(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_branch_barcode_label_settings(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_row public.branch_barcode_label_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_scope
  FROM public.barcode_label_settings_scope(p_branch_id);

  SELECT * INTO v_row
  FROM public.branch_barcode_label_settings
  WHERE branch_id = v_scope.branch_id
    AND tenant_id = v_scope.tenant_id;

  RETURN jsonb_build_object(
    'branch_id', v_scope.branch_id,
    'settings', CASE
      WHEN v_row.branch_id IS NULL THEN public.default_barcode_label_settings()
      ELSE public.validate_barcode_label_settings(v_row.settings)
    END,
    'has_saved_default', v_row.branch_id IS NOT NULL,
    'version', COALESCE(v_row.version, 0),
    'can_edit', true
  );
END;
$function$;

ALTER FUNCTION public.get_branch_barcode_label_settings(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.update_branch_barcode_label_settings(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_scope record;
  v_settings jsonb;
  v_row public.branch_barcode_label_settings%ROWTYPE;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['branch_id', 'settings'] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Invalid branch barcode label settings payload'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := (p_payload->>'branch_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid branch id' USING ERRCODE = '22023';
  END;

  SELECT * INTO v_scope
  FROM public.barcode_label_settings_scope(v_branch_id);
  v_settings := public.validate_barcode_label_settings(p_payload->'settings');

  INSERT INTO public.branch_barcode_label_settings (
    branch_id, tenant_id, settings, updated_by
  ) VALUES (
    v_scope.branch_id, v_scope.tenant_id, v_settings, v_scope.user_id
  )
  ON CONFLICT (branch_id) DO UPDATE
    SET settings = EXCLUDED.settings,
        version = public.branch_barcode_label_settings.version + 1,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    WHERE public.branch_barcode_label_settings.tenant_id = EXCLUDED.tenant_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode label settings branch scope mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.record_audit_event(
    'branch_barcode_label_settings_updated',
    v_scope.tenant_id,
    v_scope.branch_id,
    v_scope.user_id,
    v_scope.actor_role,
    'branch',
    v_scope.branch_id,
    'info',
    'succeeded',
    jsonb_build_object(
      'schema_version', 1,
      'preset_id', v_settings->>'preset_id',
      'template_id', v_settings->>'template_id',
      'output_mode', v_settings->>'output_mode',
      'version', v_row.version
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'branch_id', v_row.branch_id,
    'settings', v_row.settings,
    'has_saved_default', true,
    'version', v_row.version,
    'can_edit', true
  );
END;
$function$;

ALTER FUNCTION public.update_branch_barcode_label_settings(jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_product_barcode_print_status(
  p_product_id uuid
)
RETURNS TABLE (
  barcode_id uuid,
  print_count bigint,
  last_printed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_scope record;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);
  IF v_scope.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_product.branch_id
  THEN
    RAISE EXCEPTION 'Product belongs to another branch'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.id, count(e.id), max(e.created_at)
  FROM public.product_unit_barcodes b
  LEFT JOIN public.product_barcode_print_events e
    ON e.product_unit_barcode_id = b.id
   AND e.tenant_id = b.tenant_id
   AND e.branch_id = b.branch_id
  WHERE b.product_id = v_product.id
    AND b.tenant_id = v_product.tenant_id
    AND b.branch_id = v_product.branch_id
  GROUP BY b.id;
END;
$function$;

ALTER FUNCTION public.get_product_barcode_print_status(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_product_barcode_print_batch(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_template text;
  v_reason text;
  v_total integer := 0;
  v_copies integer;
  v_event_id uuid;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['items', 'label_template', 'reason'] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Invalid barcode print batch payload'
      USING ERRCODE = '22023';
  END IF;

  v_items := p_payload->'items';
  v_template := NULLIF(btrim(p_payload->>'label_template'), '');
  v_reason := NULLIF(btrim(p_payload->>'reason'), '');
  IF jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 100
     OR v_template IS NULL
     OR length(v_template) > 40
  THEN
    RAISE EXCEPTION 'Invalid barcode print batch'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    WHERE jsonb_typeof(item) <> 'object'
       OR item - ARRAY['barcode_id', 'copies'] <> '{}'::jsonb
       OR NOT (item ?& ARRAY['barcode_id', 'copies'])
       OR jsonb_typeof(item->'barcode_id') <> 'string'
       OR jsonb_typeof(item->'copies') <> 'number'
  ) OR EXISTS (
    SELECT item->>'barcode_id'
    FROM jsonb_array_elements(v_items) item
    GROUP BY item->>'barcode_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid or duplicate barcode print rows'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    BEGIN
      IF (v_item->>'copies')::numeric
         <> trunc((v_item->>'copies')::numeric)
      THEN
        RAISE EXCEPTION 'Invalid barcode print row'
          USING ERRCODE = '22023';
      END IF;
      v_copies := (v_item->>'copies')::integer;
      PERFORM (v_item->>'barcode_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid barcode print row'
        USING ERRCODE = '22023';
    END;
    IF v_copies NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Invalid barcode print copies'
        USING ERRCODE = '22023';
    END IF;
    v_total := v_total + v_copies;
  END LOOP;

  IF v_total > 500 THEN
    RAISE EXCEPTION 'A barcode print batch cannot exceed 500 labels'
      USING ERRCODE = '22023';
  END IF;
  IF v_total > 50 AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'A reason is required for more than 50 labels'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_event_id := public.record_product_barcode_print(jsonb_build_object(
      'barcode_id', v_item->>'barcode_id',
      'copies', (v_item->>'copies')::integer,
      'label_template', v_template,
      'reason', v_reason
    ));
    v_result := v_result || jsonb_build_array((
      SELECT jsonb_build_object(
        'event_id', event.id,
        'barcode_id', event.product_unit_barcode_id,
        'print_kind', event.print_kind,
        'copies', event.copies
      )
      FROM public.product_barcode_print_events event
      WHERE event.id = v_event_id
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'total_labels', v_total,
    'events', v_result
  );
END;
$function$;

ALTER FUNCTION public.record_product_barcode_print_batch(jsonb) OWNER TO postgres;

ALTER TABLE public.branch_barcode_label_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY branch_barcode_label_settings_service_role_all
  ON public.branch_barcode_label_settings
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.branch_barcode_label_settings
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.branch_barcode_label_settings TO service_role;

REVOKE ALL ON FUNCTION
  public.default_barcode_label_settings(),
  public.validate_barcode_label_settings(jsonb),
  public.barcode_label_settings_scope(uuid),
  public.get_branch_barcode_label_settings(uuid),
  public.update_branch_barcode_label_settings(jsonb),
  public.get_product_barcode_print_status(uuid),
  public.record_product_barcode_print_batch(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.get_branch_barcode_label_settings(uuid),
  public.update_branch_barcode_label_settings(jsonb),
  public.get_product_barcode_print_status(uuid),
  public.record_product_barcode_print_batch(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_product_barcode_print_batch(jsonb) IS
  'Atomically records a scoped barcode print request. First-print versus reprint remains server-authoritative and barcode identity is never changed.';

COMMIT;
