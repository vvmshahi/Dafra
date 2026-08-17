BEGIN;

-- Product receiving is intentionally separate from the legacy inventory_items
-- purchase path. Existing rows remain valid and are never rewritten.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS creation_request_fingerprint text;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS product_unit_id uuid REFERENCES public.product_units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS product_unit_version integer,
  ADD COLUMN IF NOT EXISTS receiving_unit_name text,
  ADD COLUMN IF NOT EXISTS receiving_unit_name_ar text,
  ADD COLUMN IF NOT EXISTS receiving_unit_code text,
  ADD COLUMN IF NOT EXISTS conversion_to_base numeric(18, 6),
  ADD COLUMN IF NOT EXISTS base_quantity numeric(12, 3),
  ADD COLUMN IF NOT EXISTS base_unit_name text,
  ADD COLUMN IF NOT EXISTS base_unit_code text,
  ADD COLUMN IF NOT EXISTS base_unit_cost numeric(18, 6);

ALTER TABLE public.product_stock_receipts
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_item_id uuid REFERENCES public.purchase_items(id) ON DELETE RESTRICT;

ALTER TABLE public.pos_stock_movements
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_item_id uuid REFERENCES public.purchase_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS purchase_items_product_receiving_idx
  ON public.purchase_items (purchase_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_stock_receipts_purchase_idx
  ON public.product_stock_receipts (purchase_id, created_at DESC)
  WHERE purchase_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_simple_purchase_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_supplier record;
  v_existing record;
  v_branch_id uuid;
  v_supplier_id uuid;
  v_operation_id uuid;
  v_date date;
  v_amount numeric(12,2);
  v_subtotal numeric(12,2);
  v_vat numeric(12,2);
  v_total numeric(12,2);
  v_tax_mode text;
  v_payment_method text;
  v_payment_status text;
  v_fingerprint text;
  v_purchase_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Authentication and a purchase payload are required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
    'branch_id','supplier_id','purchase_date','amount','tax_input_mode',
    'payment_method','payment_status','bill_number','notes','operation_id'
  )) THEN RAISE EXCEPTION 'Unsupported simple purchase field' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'),'')::uuid;
    v_supplier_id := NULLIF(btrim(p_payload->>'supplier_id'),'')::uuid;
    v_operation_id := NULLIF(btrim(p_payload->>'operation_id'),'')::uuid;
    v_date := NULLIF(btrim(p_payload->>'purchase_date'),'')::date;
    v_amount := NULLIF(btrim(p_payload->>'amount'),'')::numeric(12,2);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid simple purchase value' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_supplier_id IS NULL OR v_operation_id IS NULL OR v_date IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Branch, supplier, date, operation id, and a positive amount are required' USING ERRCODE = '22023';
  END IF;
  v_tax_mode := NULLIF(btrim(p_payload->>'tax_input_mode'),'');
  v_payment_method := NULLIF(btrim(p_payload->>'payment_method'),'');
  v_payment_status := coalesce(NULLIF(btrim(p_payload->>'payment_status'),''), 'paid');
  IF v_tax_mode NOT IN ('included','excluded') THEN RAISE EXCEPTION 'VAT treatment is required' USING ERRCODE = '22023'; END IF;
  IF v_payment_method NOT IN ('cash','card','bank_transfer') THEN RAISE EXCEPTION 'An explicit payment method is required' USING ERRCODE = '22023'; END IF;
  IF v_payment_status NOT IN ('paid','unpaid','partial') THEN RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id = v_user_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_branch.is_active IS NOT TRUE
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_profile.role::text NOT IN ('owner','admin') AND v_profile.branch_id IS DISTINCT FROM v_branch_id) THEN
    RAISE EXCEPTION 'Branch access is not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_supplier_id;
  IF NOT FOUND OR v_supplier.is_active IS NOT TRUE OR v_supplier.tenant_id IS DISTINCT FROM v_branch.tenant_id OR v_supplier.branch_id IS DISTINCT FROM v_branch_id THEN
    RAISE EXCEPTION 'Supplier is outside the active branch scope' USING ERRCODE = '42501';
  END IF;
  v_fingerprint := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch_id::text || ':' || v_user_id::text || ':' || v_operation_id::text, 0));
  SELECT id, creation_request_fingerprint INTO v_existing FROM public.purchases
    WHERE tenant_id = v_branch.tenant_id AND branch_id = v_branch_id AND added_by = v_user_id AND creation_idempotency_key = v_operation_id;
  IF FOUND THEN
    IF v_existing.creation_request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('ok',true,'purchase_id',v_existing.id,'idempotent_replay',true);
  END IF;
  IF v_tax_mode = 'included' THEN v_total := round(v_amount,2); v_vat := round(v_total * 15 / 115,2); v_subtotal := round(v_total-v_vat,2);
  ELSE v_subtotal := round(v_amount,2); v_vat := round(v_subtotal * .15,2); v_total := round(v_subtotal+v_vat,2); END IF;
  INSERT INTO public.purchases (tenant_id,branch_id,supplier_id,added_by,purchase_date,purchase_mode,status,receiving_status,bill_number,tax_input_mode,payment_status,payment_method,notes,subtotal,vat_amount,total_amount,creation_idempotency_key,creation_request_fingerprint)
  VALUES (v_branch.tenant_id,v_branch_id,v_supplier_id,v_user_id,v_date,'simple_bill','posted','not_applicable',NULLIF(btrim(p_payload->>'bill_number'),''),v_tax_mode,v_payment_status,v_payment_method,NULLIF(btrim(p_payload->>'notes'),''),v_subtotal,v_vat,v_total,v_operation_id,v_fingerprint)
  RETURNING id INTO v_purchase_id;
  RETURN jsonb_build_object('ok',true,'purchase_id',v_purchase_id,'subtotal',v_subtotal,'vat_amount',v_vat,'total_amount',v_total,'idempotent_replay',false);
END
$function$;

CREATE OR REPLACE FUNCTION public.create_product_purchase_and_receive_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_profile record; v_branch record; v_supplier record; v_existing record;
  v_branch_id uuid; v_supplier_id uuid; v_operation_id uuid; v_date date; v_tax_mode text; v_payment_method text; v_payment_status text;
  v_items jsonb; v_item jsonb; v_validated jsonb := '[]'::jsonb; v_resolved record; v_product_id uuid; v_unit_id uuid; v_expected_version integer;
  v_quantity numeric; v_unit_cost numeric(14,2); v_line_total numeric(14,2); v_subtotal numeric(12,2); v_vat numeric(12,2); v_total numeric(12,2); v_raw_total numeric := 0;
  v_fingerprint text; v_purchase_id uuid; v_line_id uuid; v_receipt_id uuid; v_index integer := 0; v_receipt_key text; v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Authentication and a purchase payload are required' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('branch_id','supplier_id','purchase_date','tax_input_mode','payment_method','payment_status','bill_number','notes','operation_id','items')) THEN RAISE EXCEPTION 'Unsupported product purchase field' USING ERRCODE='22023'; END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'),'')::uuid; v_supplier_id := NULLIF(btrim(p_payload->>'supplier_id'),'')::uuid; v_operation_id := NULLIF(btrim(p_payload->>'operation_id'),'')::uuid; v_date := NULLIF(btrim(p_payload->>'purchase_date'),'')::date;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid product purchase identifier' USING ERRCODE='22023'; END;
  v_tax_mode := NULLIF(btrim(p_payload->>'tax_input_mode'),''); v_payment_method := NULLIF(btrim(p_payload->>'payment_method'),''); v_payment_status := coalesce(NULLIF(btrim(p_payload->>'payment_status'),''),'paid'); v_items := p_payload->'items';
  IF v_branch_id IS NULL OR v_supplier_id IS NULL OR v_operation_id IS NULL OR v_date IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'Branch, supplier, date, operation id, and items are required' USING ERRCODE='22023'; END IF;
  IF v_tax_mode NOT IN ('included','excluded') THEN RAISE EXCEPTION 'VAT treatment is required' USING ERRCODE='22023'; END IF;
  IF v_payment_method NOT IN ('cash','card','bank_transfer') THEN RAISE EXCEPTION 'An explicit payment method is required' USING ERRCODE='22023'; END IF;
  IF v_payment_status NOT IN ('paid','unpaid','partial') THEN RAISE EXCEPTION 'Invalid payment status' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id=v_user_id; SELECT * INTO v_branch FROM public.branches WHERE id=v_branch_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_branch.is_active IS NOT TRUE OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id OR (v_profile.role::text NOT IN ('owner','admin') AND v_profile.branch_id IS DISTINCT FROM v_branch_id) THEN RAISE EXCEPTION 'Branch access is not permitted' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_supplier FROM public.suppliers WHERE id=v_supplier_id;
  IF NOT FOUND OR v_supplier.is_active IS NOT TRUE OR v_supplier.tenant_id IS DISTINCT FROM v_branch.tenant_id OR v_supplier.branch_id IS DISTINCT FROM v_branch_id THEN RAISE EXCEPTION 'Supplier is outside the active branch scope' USING ERRCODE='42501'; END IF;
  v_fingerprint := encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch_id::text || ':' || v_user_id::text || ':' || v_operation_id::text,0));
  SELECT id, creation_request_fingerprint INTO v_existing FROM public.purchases WHERE tenant_id=v_branch.tenant_id AND branch_id=v_branch_id AND added_by=v_user_id AND creation_idempotency_key=v_operation_id;
  IF FOUND THEN IF v_existing.creation_request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('ok',true,'purchase_id',v_existing.id,'idempotent_replay',true); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_index := v_index+1;
    BEGIN v_product_id := NULLIF(btrim(v_item->>'product_id'),'')::uuid; v_unit_id := NULLIF(btrim(v_item->>'product_unit_id'),'')::uuid; v_expected_version := NULLIF(btrim(v_item->>'expected_product_unit_version'),'')::integer; v_quantity := NULLIF(btrim(v_item->>'quantity'),'')::numeric; v_unit_cost := NULLIF(btrim(v_item->>'unit_cost'),'')::numeric(14,2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid purchase item value' USING ERRCODE='22023'; END;
    IF jsonb_typeof(v_item) <> 'object' OR v_product_id IS NULL OR v_unit_id IS NULL OR v_expected_version IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN RAISE EXCEPTION 'Every purchase item requires a product, receiving unit, valid quantity, and unit cost' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.products WHERE id=v_product_id FOR UPDATE;
    PERFORM 1 FROM public.product_units WHERE id=v_unit_id FOR UPDATE;
    SELECT * INTO v_resolved FROM public.resolve_product_commercial_unit(v_product_id,v_unit_id,v_quantity,v_expected_version,'receive');
    IF v_resolved.tenant_id IS DISTINCT FROM v_branch.tenant_id OR v_resolved.branch_id IS DISTINCT FROM v_branch_id OR v_resolved.effective_stock_enabled IS NOT TRUE OR v_resolved.stock_tracked IS NOT TRUE OR v_resolved.service_item IS TRUE THEN RAISE EXCEPTION 'Purchase item is not eligible to receive stock' USING ERRCODE='23514'; END IF;
    v_line_total := round(v_quantity*v_unit_cost,2); v_raw_total := v_raw_total + (v_quantity*v_unit_cost);
    v_validated := v_validated || jsonb_build_array(jsonb_build_object('product_id',v_product_id,'unit_id',v_resolved.product_unit_id,'version',v_resolved.product_unit_version,'name',v_resolved.selling_unit_name,'name_ar',v_resolved.selling_unit_name_ar,'code',v_resolved.selling_unit_code,'conversion',v_resolved.conversion_to_base,'base_quantity',v_resolved.base_quantity,'base_name',v_resolved.base_unit_name,'base_code',v_resolved.base_unit_code,'quantity',v_quantity,'unit_cost',v_unit_cost,'base_cost',round(v_unit_cost/v_resolved.conversion_to_base,6),'total',v_line_total));
  END LOOP;
  IF v_tax_mode='included' THEN v_total:=round(v_raw_total,2); v_vat:=round(v_total*15/115,2); v_subtotal:=round(v_total-v_vat,2); ELSE v_subtotal:=round(v_raw_total,2); v_vat:=round(v_subtotal*.15,2); v_total:=round(v_subtotal+v_vat,2); END IF;
  INSERT INTO public.purchases (tenant_id,branch_id,supplier_id,added_by,purchase_date,purchase_mode,status,receiving_status,bill_number,tax_input_mode,payment_status,payment_method,notes,subtotal,vat_amount,total_amount,creation_idempotency_key,creation_request_fingerprint)
  VALUES (v_branch.tenant_id,v_branch_id,v_supplier_id,v_user_id,v_date,'detailed_receiving','posted','confirmed',NULLIF(btrim(p_payload->>'bill_number'),''),v_tax_mode,v_payment_status,v_payment_method,NULLIF(btrim(p_payload->>'notes'),''),v_subtotal,v_vat,v_total,v_operation_id,v_fingerprint) RETURNING id INTO v_purchase_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_validated) LOOP
    INSERT INTO public.purchase_items (purchase_id,product_id,product_unit_id,product_unit_version,receiving_unit_name,receiving_unit_name_ar,receiving_unit_code,conversion_to_base,base_quantity,base_unit_name,base_unit_code,base_unit_cost,name,supplier_item_name,line_type,receiving_status,received_quantity,match_source,quantity,unit_cost,total,confirmed_at)
    VALUES (v_purchase_id,(v_item->>'product_id')::uuid,(v_item->>'unit_id')::uuid,(v_item->>'version')::integer,v_item->>'name',v_item->>'name_ar',v_item->>'code',(v_item->>'conversion')::numeric,(v_item->>'base_quantity')::numeric,v_item->>'base_name',v_item->>'base_code',(v_item->>'base_cost')::numeric,v_item->>'name',v_item->>'name','stock','confirmed',(v_item->>'base_quantity')::numeric,'manual',(v_item->>'quantity')::numeric,(v_item->>'unit_cost')::numeric,(v_item->>'total')::numeric,v_now) RETURNING id INTO v_line_id;
    v_receipt_id := gen_random_uuid(); v_receipt_key := v_operation_id::text || ':' || v_line_id::text;
    UPDATE public.products SET stock_quantity=coalesce(stock_quantity,0)+(v_item->>'base_quantity')::numeric,cost=round((v_item->>'base_cost')::numeric,2),updated_at=v_now WHERE id=(v_item->>'product_id')::uuid AND tenant_id=v_branch.tenant_id AND branch_id=v_branch_id;
    INSERT INTO public.product_stock_receipts (id,tenant_id,branch_id,product_id,supplier_id,quantity,unit_cost,total_cost,idempotency_key,note,reference,created_by,created_at,product_unit_id,product_unit_version,package_quantity,conversion_to_base,base_quantity,package_unit_name,base_unit_name,package_unit_code,base_unit_code,package_unit_cost,base_unit_cost,request_fingerprint,purchase_id,purchase_item_id)
    VALUES (v_receipt_id,v_branch.tenant_id,v_branch_id,(v_item->>'product_id')::uuid,v_supplier_id,(v_item->>'base_quantity')::numeric,round((v_item->>'base_cost')::numeric,2),(v_item->>'total')::numeric,v_receipt_key,NULL,NULLIF(btrim(p_payload->>'bill_number'),''),v_user_id,v_now,(v_item->>'unit_id')::uuid,(v_item->>'version')::integer,(v_item->>'quantity')::numeric,(v_item->>'conversion')::numeric,(v_item->>'base_quantity')::numeric,v_item->>'name',v_item->>'base_name',v_item->>'code',v_item->>'base_code',(v_item->>'unit_cost')::numeric,(v_item->>'base_cost')::numeric,v_fingerprint,v_purchase_id,v_line_id);
    INSERT INTO public.pos_stock_movements (tenant_id,branch_id,product_id,invoice_id,quantity_delta,reason,created_by,created_at,idempotency_key,product_unit_id,product_unit_version,package_quantity,conversion_to_base,base_quantity,selling_unit_name,base_unit_name,purchase_id,purchase_item_id)
    VALUES (v_branch.tenant_id,v_branch_id,(v_item->>'product_id')::uuid,NULL,(v_item->>'base_quantity')::numeric,'stock_receipt',v_user_id,v_now,v_receipt_key,(v_item->>'unit_id')::uuid,(v_item->>'version')::integer,(v_item->>'quantity')::numeric,(v_item->>'conversion')::numeric,(v_item->>'base_quantity')::numeric,v_item->>'name',v_item->>'base_name',v_purchase_id,v_line_id);
    PERFORM public.mark_product_unit_used((v_item->>'unit_id')::uuid);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'purchase_id',v_purchase_id,'subtotal',v_subtotal,'vat_amount',v_vat,'total_amount',v_total,'line_count',v_index,'idempotent_replay',false);
END
$function$;

REVOKE ALL ON FUNCTION public.create_simple_purchase_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_simple_purchase_v1(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_product_purchase_and_receive_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_purchase_and_receive_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_simple_purchase_v1(jsonb) IS 'Authenticated server-authoritative bill-only purchase creation with explicit payment and replay protection.';
COMMENT ON FUNCTION public.create_product_purchase_and_receive_v1(jsonb) IS 'Authenticated atomic catalogue-product purchase receiving. Product lines, base stock, receipts, movements, latest cost, and purchase totals commit together.';
NOTIFY pgrst, 'reload schema';
COMMIT;
