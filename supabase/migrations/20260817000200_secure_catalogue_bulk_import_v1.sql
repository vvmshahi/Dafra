BEGIN;

CREATE OR REPLACE FUNCTION public.import_catalogue_rows_v1(
  p_branch_id uuid,
  p_rows jsonb,
  p_create_missing_categories boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_scope record;
  v_row jsonb;
  v_index integer := 0;
  v_source_row integer;
  v_result jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_category_id uuid;
  v_category_created boolean;
  v_base_unit_id uuid;
  v_name text;
  v_category_name text;
  v_sku text;
  v_barcode text;
  v_price numeric(12,2);
  v_opening_stock numeric(12,3);
  v_is_service boolean;
  v_track_stock boolean;
  v_created jsonb;
  v_vat_treatment text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 250 THEN
    RAISE EXCEPTION 'Import rows must be an array of at most 250 rows' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope FROM public.assert_product_write_access(p_branch_id);
  IF v_scope.branch_id IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'Forbidden branch' USING ERRCODE = '42501'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_index := v_index + 1;
    v_source_row := v_index;
    IF jsonb_typeof(v_row) = 'object'
       AND jsonb_typeof(v_row->'source_row') = 'number'
       AND (v_row->>'source_row') ~ '^[1-9][0-9]*$'
    THEN
      v_source_row := (v_row->>'source_row')::integer;
    END IF;
    BEGIN
      IF jsonb_typeof(v_row) <> 'object' OR v_row - ARRAY['source_row','name','name_ar','category','price','sku','barcode','is_service','track_stock','opening_stock','vat_treatment'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Invalid import row';
      END IF;
      v_name := NULLIF(btrim(v_row->>'name'), '');
      IF v_name IS NULL THEN RAISE EXCEPTION 'Product name is required'; END IF;
      IF length(v_name) > 255 THEN RAISE EXCEPTION 'Product name is too long'; END IF;
      IF jsonb_typeof(v_row->'price') <> 'number' THEN RAISE EXCEPTION 'Selling price must be a number'; END IF;
      v_price := (v_row->>'price')::numeric(12,2);
      IF v_price < 0 THEN RAISE EXCEPTION 'Selling price must be zero or higher'; END IF;
      IF (v_row ? 'is_service' AND jsonb_typeof(v_row->'is_service') <> 'boolean')
         OR (v_row ? 'track_stock' AND jsonb_typeof(v_row->'track_stock') <> 'boolean')
      THEN RAISE EXCEPTION 'Service and stock flags must be boolean'; END IF;
      v_is_service := COALESCE((v_row->>'is_service')::boolean, false);
      v_track_stock := COALESCE((v_row->>'track_stock')::boolean, false) AND NOT v_is_service;
      IF v_is_service AND COALESCE((v_row->>'opening_stock')::numeric, 0) > 0 THEN RAISE EXCEPTION 'Services cannot receive opening stock'; END IF;
      IF v_track_stock AND jsonb_typeof(v_row->'opening_stock') <> 'number' THEN RAISE EXCEPTION 'Opening stock is required for tracked products'; END IF;
      v_opening_stock := COALESCE((v_row->>'opening_stock')::numeric(12,3), 0);
      IF v_opening_stock < 0 THEN RAISE EXCEPTION 'Opening stock must be zero or higher'; END IF;
      v_sku := NULLIF(btrim(v_row->>'sku'), '');
      v_barcode := NULLIF(btrim(v_row->>'barcode'), '');
      IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE tenant_id = v_scope.tenant_id AND lower(btrim(sku)) = public.normalize_product_sku(v_sku)) THEN
        v_result := v_result || jsonb_build_array(jsonb_build_object('source_row', v_source_row, 'status','duplicate','reason','SKU already exists'));
        CONTINUE;
      END IF;
      IF v_barcode IS NOT NULL AND EXISTS (SELECT 1 FROM public.product_unit_barcodes WHERE branch_id = v_scope.branch_id AND normalized_barcode = public.normalize_product_barcode(v_barcode) AND is_active) THEN
        v_result := v_result || jsonb_build_array(jsonb_build_object('source_row', v_source_row, 'status','duplicate','reason','Barcode already exists'));
        CONTINUE;
      END IF;
      v_category_id := NULL; v_category_created := false; v_category_name := NULLIF(btrim(v_row->>'category'), '');
      IF v_category_name IS NOT NULL THEN
        IF length(v_category_name) > 255 THEN RAISE EXCEPTION 'Category name is too long'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_scope.branch_id::text || ':' || lower(v_category_name), 0));
        SELECT id INTO v_category_id FROM public.categories WHERE tenant_id=v_scope.tenant_id AND branch_id=v_scope.branch_id AND lower(btrim(name))=lower(v_category_name) LIMIT 1;
        IF v_category_id IS NULL THEN
          IF NOT p_create_missing_categories THEN RAISE EXCEPTION 'Category does not exist'; END IF;
          INSERT INTO public.categories(tenant_id,branch_id,name,color,is_active,sort_order) VALUES(v_scope.tenant_id,v_scope.branch_id,v_category_name,'#1c5c2e',true,0) RETURNING id INTO v_category_id;
          v_category_created := true;
        END IF;
      END IF;
      v_vat_treatment := COALESCE(NULLIF(btrim(v_row->>'vat_treatment'),''),'inherit');
      IF v_vat_treatment NOT IN ('inherit','exclusive','inclusive','exempt') THEN RAISE EXCEPTION 'Invalid VAT treatment'; END IF;
      v_created := public.create_product_secure(jsonb_build_object('branch_id',v_scope.branch_id,'name',v_name,'name_ar',NULLIF(btrim(v_row->>'name_ar'),''),'category_id',v_category_id,'price',v_price,'sku',v_sku,'is_service',v_is_service,'vat_treatment',v_vat_treatment));
      v_product_id := (v_created->>'product_id')::uuid;
      IF v_barcode IS NOT NULL THEN
        SELECT id INTO v_base_unit_id FROM product_units WHERE product_id=v_product_id AND is_base AND COALESCE(is_active,true) LIMIT 1;
        PERFORM public.create_product_unit_barcode(jsonb_build_object('product_unit_id',v_base_unit_id,'barcode',v_barcode,'barcode_type','unknown','source','imported','is_primary',true));
      END IF;
      IF v_track_stock THEN
        PERFORM public.update_product_stock_settings(jsonb_build_object('product_id',v_product_id,'track_stock',true,'opening_stock_quantity',v_opening_stock,'reason','opening_stock'));
      END IF;
      v_result := v_result || jsonb_build_array(jsonb_build_object('source_row',v_source_row,'status','created','product_id',v_product_id,'category_created',v_category_created));
    EXCEPTION WHEN unique_violation THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('source_row',v_source_row,'status','duplicate','reason','SKU or barcode already exists'));
    WHEN OTHERS THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('source_row',v_source_row,'status','failed','reason',left(SQLERRM,180)));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'results',v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.import_catalogue_rows_v1(uuid,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_catalogue_rows_v1(uuid,jsonb,boolean) TO authenticated;

COMMIT;
