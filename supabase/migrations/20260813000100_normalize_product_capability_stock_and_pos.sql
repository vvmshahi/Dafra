BEGIN;

-- Business type selects a recommended workflow. Stock eligibility is a
-- branch capability applied to the product's own physical/service capability.
CREATE OR REPLACE FUNCTION public.branch_effective_stock_enabled(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(b.stock_enabled, true)
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.tenant_id = p_tenant_id
  ), false)
$function$;

ALTER FUNCTION public.branch_effective_stock_enabled(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.branch_effective_stock_enabled(uuid, uuid) IS
  'Canonical stock rule: an in-scope branch defaults NULL stock_enabled to enabled and may explicitly disable stock. Product eligibility is checked by each authoritative stock operation.';

COMMENT ON COLUMN public.branches.stock_enabled IS
  'Nullable branch Stock module override. NULL defaults Stock to enabled; TRUE enables Stock; FALSE disables Stock. Product capability, not tenant business type, controls whether a product can track quantities.';

-- This remains a narrow, audited setting. A branch user can now change only
-- its own branch setting, matching the Mobile Branch Settings workspace.
CREATE OR REPLACE FUNCTION public.update_branch_module_settings(
  p_branch_id uuid,
  p_stock_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_updated_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, stock_enabled, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET stock_enabled = p_stock_enabled,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_module_settings_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'stock_enabled_before', v_branch.stock_enabled,
        'stock_enabled_after', p_stock_enabled
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'stock_enabled', p_stock_enabled,
    'updated_at', v_updated_at
  );
END
$function$;

ALTER FUNCTION public.update_branch_module_settings(uuid, boolean) OWNER TO postgres;
COMMENT ON FUNCTION public.update_branch_module_settings(uuid, boolean) IS
  'Safely updates the scoped branch stock-module setting without broad browser UPDATE access to branches.';
REVOKE ALL ON FUNCTION public.update_branch_module_settings(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_module_settings(uuid, boolean) TO authenticated;

-- The remaining function bodies are preserved verbatim except for their
-- business-type predicates. Each patch refuses an unknown deployed shape.
DO $normalize_product_capability_guards$
DECLARE
  v_definition text;
  v_patched text;
  v_signature regprocedure;
  v_old text;
  v_new text;
BEGIN
  v_signature := 'public.update_product_stock_settings(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$    IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
      RAISE EXCEPTION 'Product stock tracking is not available for service businesses'
        USING ERRCODE = '23514';
    END IF;

$needle$;
  v_patched := replace(v_definition, v_old, '');
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%Product stock tracking is not available for service businesses%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_STOCK_SETTINGS_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;

  v_signature := 'public.receive_product_stock_legacy_base_v1(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$  IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
    RAISE EXCEPTION 'Product stock receiving is not available for service businesses'
      USING ERRCODE = '23514';
  END IF;

$needle$;
  v_patched := replace(v_definition, v_old, '');
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%Product stock receiving is not available for service businesses%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_RECEIVING_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;

  v_signature := 'public.resolve_product_commercial_unit(uuid,uuid,numeric,integer,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$  IF p_operation = 'receive'
     AND (
       v_product.business_type = 'service'
       OR COALESCE(v_product.is_service, false)
     )
  THEN
    RAISE EXCEPTION 'Service products cannot receive stock'
      USING ERRCODE = '23514';
  END IF;
$needle$;
  v_new := $replacement$  IF p_operation = 'receive'
     AND COALESCE(v_product.is_service, false)
  THEN
    RAISE EXCEPTION 'Service products cannot receive stock'
      USING ERRCODE = '23514';
  END IF;
$replacement$;
  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%v_product.business_type = ''service''%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_UNIT_RESOLVER_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;

  v_signature := 'public.create_product_unit(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$  IF v_product.business_type = 'service'
     OR COALESCE(v_product.is_service, false) IS TRUE
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;
$needle$;
  v_new := $replacement$  IF COALESCE(v_product.is_service, false) IS TRUE THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;
$replacement$;
  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%Product packages are not available for service products%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_CREATE_UNIT_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;

  FOR v_signature IN SELECT unnest(ARRAY[
    'public.update_product_unit(jsonb)'::regprocedure,
    'public.reactivate_product_unit(uuid,integer)'::regprocedure
  ])
  LOOP
    v_definition := pg_get_functiondef(v_signature);
    v_old := $needle$  IF v_unit.is_base IS FALSE
     AND (
       v_product.business_type = 'service'
       OR COALESCE(v_product.is_service, false) IS TRUE
     )
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;
$needle$;
    v_new := $replacement$  IF v_unit.is_base IS FALSE
     AND COALESCE(v_product.is_service, false) IS TRUE
  THEN
    RAISE EXCEPTION 'Product packages are not available for service products'
      USING ERRCODE = '23514';
  END IF;
$replacement$;
    v_patched := replace(v_definition, v_old, v_new);
    IF v_patched IS NOT DISTINCT FROM v_definition
       AND v_definition LIKE '%Product packages are not available for service products%'
    THEN
      RAISE EXCEPTION 'BUSINESS_CAPABILITY_UPDATE_UNIT_PATCH_TARGET_MISSING:%', v_signature;
    ELSIF v_patched IS DISTINCT FROM v_definition THEN
      EXECUTE v_patched;
    END IF;
  END LOOP;

  -- Legacy quantity-only credit notes remain atomic. They now use the same
  -- branch gate as package-aware credit notes, while each line still excludes
  -- service products before any stock restoration.
  v_signature := 'public.create_partial_credit_note_legacy_base_v1(jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$  v_effective_return_stock :=
    v_return_stock
    AND COALESCE(v_tenant_business_type, 'trading') <> 'service'
    AND public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id);$needle$;
  v_new := $replacement$  v_effective_return_stock :=
    v_return_stock
    AND public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id);$replacement$;
  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%v_tenant_business_type%'
     AND v_definition LIKE '%branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_CREDIT_NOTE_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;

  -- The refundable-item surface is advisory, but make it accurately report
  -- only a currently eligible physical tracked product.
  v_signature := 'public.get_invoice_refundable_items(uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_old := $needle$    (
      public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)
      AND COALESCE(p.track_stock, FALSE)
    ) AS track_stock,$needle$;
  v_new := $replacement$    (
      public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)
      AND COALESCE(p.track_stock, FALSE)
      AND COALESCE(p.is_service, FALSE) IS FALSE
    ) AS track_stock,$replacement$;
  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched IS NOT DISTINCT FROM v_definition
     AND v_definition LIKE '%branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)%'
     AND v_definition NOT LIKE '%COALESCE(p.is_service, FALSE) IS FALSE%'
  THEN
    RAISE EXCEPTION 'BUSINESS_CAPABILITY_REFUNDABLE_ITEMS_PATCH_TARGET_MISSING';
  ELSIF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;
END
$normalize_product_capability_guards$;

-- Reassert the existing public execution surface after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.update_product_stock_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_stock_settings(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_product_stock_legacy_base_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_product_stock_legacy_base_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.receive_product_stock(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_product_unit(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_unit(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_product_unit(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_product_unit(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reactivate_product_unit(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_product_unit(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_legacy_base_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_legacy_base_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_invoice_refundable_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
