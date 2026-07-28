BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- New branches are prepared deterministically for the existing readiness
-- synchronizer, but remain fail-closed until production onboarding completes.
CREATE OR REPLACE FUNCTION public.provision_new_branch_zatca_checkout_defaults_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  INSERT INTO public.zatca_atomic_checkout_branch_gates_v2 (
    tenant_id,
    branch_id,
    enabled,
    enabled_at,
    enabled_by,
    updated_at
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    false,
    NULL,
    NULL,
    clock_timestamp()
  )
  ON CONFLICT (tenant_id, branch_id) DO NOTHING;

  INSERT INTO public.zatca_branch_readiness_v2 (
    tenant_id,
    branch_id,
    readiness_status,
    readiness_source,
    reason,
    approved_by,
    approved_at,
    created_at,
    updated_at
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    'blocked',
    'operator_block',
    'awaiting_production_onboarding',
    NULL,
    NULL,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (tenant_id, branch_id) DO NOTHING;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.provision_new_branch_zatca_checkout_defaults_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_new_branch_zatca_checkout_defaults_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS branches_20_provision_zatca_checkout_defaults_v1
  ON public.branches;
CREATE TRIGGER branches_20_provision_zatca_checkout_defaults_v1
AFTER INSERT ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.provision_new_branch_zatca_checkout_defaults_v1();

-- The authoritative additional-owner branch RPC contains a historical
-- PL/pgSQL token typo that is parsed only when the role guard executes.
-- Repair that exact reviewed token so this provisioning path can reach the new
-- branch trigger; do not otherwise redefine its commercial contract.
DO $repair_additional_branch_role_guard$
DECLARE
  v_function regprocedure :=
    to_regprocedure('public.create_branch_for_tenant(jsonb)');
  v_definition text;
  v_repaired text;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'CREATE_BRANCH_FOR_TENANT_MISSING';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF v_definition LIKE '%v_profile.role NOT = ''owner''%' THEN
    v_repaired := replace(
      v_definition,
      'v_profile.role NOT = ''owner''',
      'v_profile.role <> ''owner'''
    );
    EXECUTE v_repaired;
  ELSIF v_definition LIKE
      '%v_profile.role NOT IN (''owner'', ''admin'')%' THEN
    -- Production already has the reviewed owner/admin authorization guard.
    -- Preserve that newer contract verbatim.
    NULL;
  ELSIF v_definition NOT LIKE '%v_profile.role <> ''owner''%' THEN
    RAISE EXCEPTION 'CREATE_BRANCH_FOR_TENANT_ROLE_GUARD_UNREVIEWED';
  END IF;
END
$repair_additional_branch_role_guard$;

-- Private authoritative classifier. The actor identity is supplied only by
-- trusted server contracts. Browser callers use the auth.uid()-bound wrapper
-- below and cannot supply an actor, tenant, capability, or document kind.
CREATE OR REPLACE FUNCTION public.resolve_pos_checkout_document_internal_v1(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_profile record;
  v_branch record;
  v_customer record;
  v_credentials record;
  v_readiness record;
  v_eligibility jsonb;
  v_document_type text;
  v_classification_reason text;
  v_atomic_eligible boolean := false;
  v_atomic_reason text := 'not_evaluated';
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'AUTHENTICATION_REQUIRED'
    );
  END IF;

  SELECT
    p.id,
    p.tenant_id,
    p.branch_id,
    p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = p_actor_user_id
    AND p.is_active = true;

  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'admin', 'branch') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'CHECKOUT_PROFILE_NOT_ACTIVE'
    );
  END IF;

  SELECT
    b.id,
    b.tenant_id,
    b.is_active AS branch_active,
    COALESCE(t.is_active, true) AS tenant_active,
    t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (
       v_profile.role = 'branch'
       AND v_profile.branch_id IS DISTINCT FROM v_branch.id
     ) THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'CHECKOUT_BRANCH_FORBIDDEN'
    );
  END IF;

  IF v_branch.branch_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'CHECKOUT_BRANCH_NOT_ACTIVE'
    );
  END IF;

  SELECT
    c.functionality_map,
    c.onboarding_status,
    NULLIF(c.encrypted_production_csid, '') IS NOT NULL AS has_csid,
    NULLIF(c.encrypted_production_secret, '') IS NOT NULL AS has_secret
  INTO v_credentials
  FROM public.zatca_production_credentials c
  WHERE c.tenant_id = v_branch.tenant_id
    AND c.branch_id = v_branch.id
    AND c.environment = 'production';

  IF NOT FOUND OR v_credentials.functionality_map IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'INVOICE_CAPABILITY_NOT_CONFIGURED'
    );
  END IF;

  IF v_credentials.onboarding_status IS DISTINCT FROM 'production_connected'
     OR v_credentials.has_csid IS NOT TRUE
     OR v_credentials.has_secret IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'ZATCA_CONNECTION_REQUIRED',
      'capability', v_credentials.functionality_map
    );
  END IF;

  IF p_customer_id IS NULL THEN
    v_document_type := 'simplified';
    v_classification_reason := 'walk_in_retail';
  ELSE
    SELECT
      c.id,
      c.customer_type,
      c.vat_number
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.tenant_id = v_branch.tenant_id
      AND c.branch_id = v_branch.id
      AND c.is_active = true;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'code', 'CHECKOUT_CUSTOMER_NOT_AVAILABLE'
      );
    END IF;

    IF v_customer.customer_type = 'business'
       AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$' THEN
      v_document_type := 'standard';
      v_classification_reason := 'vat_qualified_business';
    ELSIF v_customer.customer_type = 'business' THEN
      -- Product policy: a non-VAT-qualified Business buyer receives the same
      -- Simplified retail document as a consumer. This is deliberate, not a
      -- regex fall-through.
      v_document_type := 'simplified';
      v_classification_reason := 'business_without_qualifying_vat';
    ELSE
      v_document_type := 'simplified';
      v_classification_reason := 'individual_customer';
    END IF;
  END IF;

  IF v_credentials.functionality_map = '0100'
     AND v_document_type = 'standard' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'BRANCH_SIMPLIFIED_ONLY',
      'capability', v_credentials.functionality_map,
      'classificationReason', v_classification_reason
    );
  END IF;

  IF v_credentials.functionality_map = '1000'
     AND v_document_type = 'simplified' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'BRANCH_STANDARD_ONLY',
      'capability', v_credentials.functionality_map,
      'classificationReason', v_classification_reason
    );
  END IF;

  IF v_credentials.functionality_map NOT IN ('0100', '1000', '1100') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'INVOICE_CAPABILITY_NOT_CONFIGURED'
    );
  END IF;

  SELECT r.readiness_status, r.reason
  INTO v_readiness
  FROM public.zatca_branch_readiness_v2 r
  WHERE r.tenant_id = v_branch.tenant_id
    AND r.branch_id = v_branch.id;

  IF v_document_type = 'simplified' THEN
    v_eligibility := public.get_zatca_atomic_checkout_eligibility_v2(
      v_branch.id,
      p_actor_user_id
    );
    v_atomic_eligible :=
      COALESCE((v_eligibility->>'eligible')::boolean, false);
    v_atomic_reason :=
      COALESCE(v_eligibility->>'blockingReason', 'eligibility_unknown');
  ELSE
    v_atomic_reason := 'standard_uses_legacy_clearance';
  END IF;

  RETURN jsonb_build_object(
    'status', 'allowed',
    'documentType', v_document_type,
    'checkoutPath', CASE
      WHEN v_document_type = 'simplified' AND v_atomic_eligible
        THEN 'atomic'
      ELSE 'legacy'
    END,
    'capability', v_credentials.functionality_map,
    'classificationReason', v_classification_reason,
    'atomicEligible', v_atomic_eligible,
    'atomicEligibilityReason', v_atomic_reason,
    'readinessStatus', COALESCE(v_readiness.readiness_status, 'missing'),
    'readinessReason', v_readiness.reason,
    'productionConnected', true
  );
END
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_pos_checkout_document_v1(
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT public.resolve_pos_checkout_document_internal_v1(
    auth.uid(),
    p_branch_id,
    p_customer_id
  )
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid) IS
  'Authenticated, read-only POS document classifier. Stored production capability and authoritative customer data decide Simplified, Standard, or blocked.';

-- Refuse to replace an unreviewed commercial dispatcher, then preserve its OID
-- and full implementation under a private name.
DO $verify_checkout_dispatcher$
DECLARE
  v_registered_hash text;
  v_actual_hash text;
BEGIN
  SELECT definition_md5
  INTO v_registered_hash
  FROM public.product_units_commercial_function_contracts_v1
  WHERE function_signature = 'public.pos_checkout(jsonb)'
  FOR UPDATE;

  v_actual_hash := md5(pg_get_functiondef(
    'public.pos_checkout(jsonb)'::regprocedure
  ));
  IF v_registered_hash IS NULL
     OR v_registered_hash IS DISTINCT FROM v_actual_hash THEN
    RAISE EXCEPTION 'POS_CHECKOUT_CLASSIFICATION_BASE_UNREVIEWED';
  END IF;
END
$verify_checkout_dispatcher$;

ALTER FUNCTION public.pos_checkout(jsonb)
  RENAME TO pos_checkout_capability_base_v1;
REVOKE ALL ON FUNCTION public.pos_checkout_capability_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_capability_base_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_decision jsonb;
  v_result jsonb;
  v_code text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_branch_id :=
    NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
  v_customer_id :=
    NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
  v_decision := public.resolve_pos_checkout_document_internal_v1(
    auth.uid(),
    v_branch_id,
    v_customer_id
  );

  IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    v_code := COALESCE(v_decision->>'code', 'CHECKOUT_DOCUMENT_BLOCKED');
    RAISE EXCEPTION '%', v_code USING ERRCODE = 'P0001';
  END IF;
  IF v_decision->>'checkoutPath' = 'atomic'
     AND NULLIF(
       current_setting('app.atomic_checkout_intent_id', true),
       ''
     ) IS NULL THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.pos_checkout_capability_base_v1(p_payload);
  IF v_result->>'zatca_invoice_type'
     IS DISTINCT FROM v_decision->>'documentType' THEN
    RAISE EXCEPTION 'CHECKOUT_DOCUMENT_CLASSIFICATION_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_result || jsonb_build_object(
    'document_decision', v_decision->>'documentType',
    'checkout_path', v_decision->>'checkoutPath',
    'classification_reason', v_decision->>'classificationReason'
  );
END
$function$;

ALTER FUNCTION public.pos_checkout(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Capability-enforced POS checkout. Server identity, stored ZATCA functionality map, and authoritative customer data decide the document kind before commercial mutation.';

DO $update_checkout_contract$
BEGIN
  UPDATE public.product_units_commercial_function_contracts_v1
  SET definition_md5 = md5(pg_get_functiondef(
        'public.pos_checkout(jsonb)'::regprocedure
      )),
      registered_at = clock_timestamp()
  WHERE function_signature = 'public.pos_checkout(jsonb)';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_CHECKOUT_CLASSIFICATION_CONTRACT_UPDATE_FAILED';
  END IF;
END
$update_checkout_contract$;

-- Atomic preparation remains Simplified-only and now consumes the same
-- classifier before it allocates an intent or signs an artifact.
ALTER FUNCTION public.prepare_zatca_atomic_checkout_v2(
  uuid, text, jsonb, text, integer
) RENAME TO prepare_zatca_atomic_checkout_base_v2;

REVOKE ALL ON FUNCTION public.prepare_zatca_atomic_checkout_base_v2(
  uuid, text, jsonb, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_zatca_atomic_checkout_base_v2(
  uuid, text, jsonb, text, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_zatca_atomic_checkout_v2(
  p_actor_user_id uuid,
  p_document_type text,
  p_payload jsonb,
  p_cart_fingerprint text,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_decision jsonb;
  v_code text;
BEGIN
  IF p_document_type = 'invoice' THEN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_ATOMIC_CHECKOUT_REQUEST'
        USING ERRCODE = '22023';
    END IF;

    v_branch_id :=
      NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
    v_customer_id :=
      NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
    v_decision := public.resolve_pos_checkout_document_internal_v1(
      p_actor_user_id,
      v_branch_id,
      v_customer_id
    );

    IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
      v_code := COALESCE(v_decision->>'code', 'CHECKOUT_DOCUMENT_BLOCKED');
      RAISE EXCEPTION '%', v_code USING ERRCODE = 'P0001';
    END IF;
    IF v_decision->>'documentType' IS DISTINCT FROM 'simplified' THEN
      RAISE EXCEPTION 'STANDARD_DOCUMENT_REQUIRES_CLEARANCE_FLOW'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_decision->>'checkoutPath' IS DISTINCT FROM 'atomic' THEN
      RAISE EXCEPTION 'ATOMIC_NOT_READY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN public.prepare_zatca_atomic_checkout_base_v2(
    p_actor_user_id,
    p_document_type,
    p_payload,
    p_cart_fingerprint,
    p_ttl_seconds
  );
END
$function$;

ALTER FUNCTION public.prepare_zatca_atomic_checkout_v2(
  uuid, text, jsonb, text, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_zatca_atomic_checkout_v2(
  uuid, text, jsonb, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_zatca_atomic_checkout_v2(
  uuid, text, jsonb, text, integer
) TO service_role;

COMMENT ON FUNCTION public.prepare_zatca_atomic_checkout_v2(
  uuid, text, jsonb, text, integer
) IS
  'Service-only Atomic Simplified preparation guarded by the authoritative POS document classifier and current atomic eligibility.';

COMMIT;
