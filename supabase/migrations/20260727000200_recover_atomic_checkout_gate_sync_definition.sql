-- Recovery-only source control of the existing production function.
-- This migration intentionally preserves production behavior and does not
-- implement or enable final checkout eligibility consolidation.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(
  p_branch_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
  v_branch record;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_runtime_found boolean := false;
  v_readiness_status text;
  v_readiness_reason text;
  v_chain_head_exists boolean := false;
  v_production_connected boolean := false;
  v_acknowledged_user_id uuid;
  v_static_ready boolean := false;
  v_eligible boolean := false;
  v_blocking_reason text;
BEGIN
  SELECT
    b.id,
    b.tenant_id,
    b.name,
    b.is_active AS branch_active,
    COALESCE(t.is_active, true) AS tenant_active,
    t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_runtime
  FROM public.zatca_finalization_runtime r
  WHERE r.singleton = true;
  v_runtime_found := FOUND;

  SELECT r.readiness_status, r.reason
  INTO v_readiness_status, v_readiness_reason
  FROM public.zatca_branch_readiness_v2 r
  WHERE r.tenant_id = v_branch.tenant_id
    AND r.branch_id = v_branch.id;

  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_chain_heads_v2 h
    WHERE h.tenant_id = v_branch.tenant_id
      AND h.branch_id = v_branch.id
      AND h.last_committed_counter >= 0
      AND NULLIF(btrim(h.last_committed_hash), '') IS NOT NULL
  ) INTO v_chain_head_exists;

  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_production_credentials c
    WHERE c.tenant_id = v_branch.tenant_id
      AND c.branch_id = v_branch.id
      AND c.environment = 'production'
      AND c.onboarding_status = 'production_connected'
      AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
      AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
  ) INTO v_production_connected;

  IF v_runtime_found THEN
    SELECT c.user_id
    INTO v_acknowledged_user_id
    FROM public.zatca_client_capabilities_v2 c
    JOIN public.user_profiles p ON p.id = c.user_id
    WHERE c.branch_id = v_branch.id
      AND (p_actor_user_id IS NULL OR c.user_id = p_actor_user_id)
      AND p.is_active = true
      AND p.tenant_id = v_branch.tenant_id
      AND (
        p.role::text IN ('owner', 'admin')
        OR (p.role::text = 'branch' AND p.branch_id = v_branch.id)
      )
      AND c.client_version = v_runtime.minimum_client_version
      AND c.edge_version = v_runtime.minimum_edge_version
      AND c.schema_version = v_runtime.schema_version
      AND c.expires_at > clock_timestamp()
    ORDER BY c.expires_at DESC, c.user_id
    LIMIT 1;
  END IF;

  v_static_ready :=
    v_branch.branch_active IS TRUE
    AND v_branch.tenant_active IS TRUE
    AND v_branch.suspended_at IS NULL
    AND v_runtime_found
    AND COALESCE(v_runtime.immutable_finalization_enabled, false)
    AND COALESCE(v_runtime.simplified_enabled, false)
    AND COALESCE(v_runtime.atomic_simplified_checkout_enabled, false)
    AND v_runtime.schema_version = 2
    AND v_runtime.minimum_edge_version = '2.1.0'
    AND v_runtime.minimum_client_version = '2.1.0'
    AND v_readiness_status = 'ready'
    AND v_chain_head_exists
    AND v_production_connected;

  v_eligible := v_static_ready AND v_acknowledged_user_id IS NOT NULL;

  v_blocking_reason := CASE
    WHEN v_branch.branch_active IS NOT TRUE THEN 'inactive_branch'
    WHEN v_branch.tenant_active IS NOT TRUE THEN 'inactive_tenant'
    WHEN v_branch.suspended_at IS NOT NULL THEN 'tenant_suspended'
    WHEN NOT v_runtime_found THEN 'runtime_missing'
    WHEN NOT COALESCE(v_runtime.immutable_finalization_enabled, false)
      THEN 'immutable_finalization_disabled'
    WHEN NOT COALESCE(v_runtime.simplified_enabled, false)
      THEN 'simplified_finalization_disabled'
    WHEN NOT COALESCE(v_runtime.atomic_simplified_checkout_enabled, false)
      THEN 'atomic_global_disabled'
    WHEN v_runtime.schema_version IS DISTINCT FROM 2
      THEN 'schema_version_incompatible'
    WHEN v_runtime.minimum_edge_version IS DISTINCT FROM '2.1.0'
      THEN 'edge_version_incompatible'
    WHEN v_runtime.minimum_client_version IS DISTINCT FROM '2.1.0'
      THEN 'client_version_incompatible'
    WHEN v_readiness_status = 'blocked' THEN 'explicitly_blocked'
    WHEN v_readiness_status IS NULL THEN 'readiness_missing'
    WHEN v_readiness_status IS DISTINCT FROM 'ready' THEN 'branch_not_ready'
    WHEN NOT v_chain_head_exists THEN 'missing_chain_head'
    WHEN NOT v_production_connected THEN 'missing_production_credentials'
    WHEN v_acknowledged_user_id IS NULL THEN 'missing_client_acknowledgement'
    ELSE 'eligible'
  END;

  RETURN jsonb_build_object(
    'tenantId', v_branch.tenant_id,
    'branchId', v_branch.id,
    'branchName', v_branch.name,
    'branchActive', v_branch.branch_active IS TRUE,
    'tenantActive', v_branch.tenant_active IS TRUE,
    'tenantSuspended', v_branch.suspended_at IS NOT NULL,
    'immutableFinalizationEnabled',
      v_runtime_found AND COALESCE(v_runtime.immutable_finalization_enabled, false),
    'simplifiedEnabled',
      v_runtime_found AND COALESCE(v_runtime.simplified_enabled, false),
    'atomicGlobalEnabled',
      v_runtime_found AND COALESCE(v_runtime.atomic_simplified_checkout_enabled, false),
    'standardEnabled',
      v_runtime_found AND COALESCE(v_runtime.standard_enabled, false),
    'schemaCompatible', v_runtime_found AND v_runtime.schema_version = 2,
    'edgeVersionCompatible',
      v_runtime_found AND v_runtime.minimum_edge_version = '2.1.0',
    'clientVersionCompatible',
      v_runtime_found AND v_runtime.minimum_client_version = '2.1.0',
    'readinessStatus', COALESCE(v_readiness_status, 'missing'),
    'readinessReason', v_readiness_reason,
    'branchReady', v_readiness_status = 'ready',
    'branchBlocked', v_readiness_status = 'blocked',
    'chainHeadExists', v_chain_head_exists,
    'productionConnected', v_production_connected,
    'clientAcknowledged', v_acknowledged_user_id IS NOT NULL,
    'acknowledgedUserId', v_acknowledged_user_id,
    'staticReady', v_static_ready,
    'eligible', v_eligible,
    'blockingReason', v_blocking_reason
  );
END
$function$;

ALTER FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(uuid, uuid)
  IS 'Service-only, read-only Atomic Simplified eligibility evaluation with exact blocking reason.';

DO $eligibility_catalog_assertions$
DECLARE
  v_function_oid oid :=
    to_regprocedure('public.get_zatca_atomic_checkout_eligibility_v2(uuid,uuid)');
  v_owner_oid oid;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_function pg_proc%ROWTYPE;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_SIGNATURE_MISSING';
  END IF;

  SELECT oid INTO v_owner_oid FROM pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated_oid FROM pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_service_role_oid FROM pg_roles WHERE rolname = 'service_role';
  IF v_owner_oid IS NULL
     OR v_anon_oid IS NULL
     OR v_authenticated_oid IS NULL
     OR v_service_role_oid IS NULL THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_REQUIRED_ROLE_MISSING';
  END IF;

  SELECT * INTO v_function FROM pg_proc WHERE oid = v_function_oid;

  IF v_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.provolatile IS DISTINCT FROM 's'
     OR v_function.proparallel IS DISTINCT FROM 'u'
     OR v_function.prokind IS DISTINCT FROM 'f'
     OR v_function.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
     OR v_function.proretset IS DISTINCT FROM false
     OR v_function.pronargdefaults IS DISTINCT FROM 1
     OR v_function.proargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid,
       'uuid'::regtype::oid
     ]::oidvector
     OR v_function.proargnames IS DISTINCT FROM ARRAY[
       'p_branch_id',
       'p_actor_user_id'
     ]::text[] THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_CONTRACT_OR_METADATA_MISMATCH';
  END IF;

  IF v_function.proconfig IS NULL
     OR cardinality(v_function.proconfig) IS DISTINCT FROM 2
     OR NOT ('search_path=public, pg_temp' = ANY(v_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_function.proconfig)) THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_RUNTIME_CONFIGURATION_MISMATCH';
  END IF;

  IF has_function_privilege(0, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_anon_oid, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_authenticated_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_service_role_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_owner_oid, v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_ACL_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      v_function.proacl,
      acldefault('f', v_function.proowner)
    )) acl
    WHERE acl.privilege_type IS DISTINCT FROM 'EXECUTE'
       OR acl.grantee NOT IN (v_owner_oid, v_service_role_oid)
       OR acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_ACL_ENTRY_MISMATCH';
  END IF;

  IF obj_description(v_function_oid, 'pg_proc') IS DISTINCT FROM
     'Service-only, read-only Atomic Simplified eligibility evaluation with exact blocking reason.' THEN
    RAISE EXCEPTION 'RECOVERED_ELIGIBILITY_COMMENT_MISMATCH';
  END IF;
END
$eligibility_catalog_assertions$;

CREATE OR REPLACE FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  tenant_id uuid,
  branch_id uuid,
  branch_name text,
  previous_gate_state boolean,
  resulting_gate_state boolean,
  readiness_result boolean,
  blocking_reason text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
  v_branch record;
  v_evaluation jsonb;
  v_gate_exists boolean;
  v_previous boolean;
  v_desired boolean;
  v_eligible boolean;
  v_static_ready boolean;
  v_reason text;
  v_acknowledged_user_id uuid;
  v_action text;
BEGIN
  FOR v_branch IN
    SELECT b.id, b.tenant_id, b.name
    FROM public.branches b
    WHERE p_branch_id IS NULL OR b.id = p_branch_id
    ORDER BY b.tenant_id, b.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'atomic-simplified-gate:' || v_branch.tenant_id::text || ':' || v_branch.id::text,
      0
    ));

    SELECT g.enabled
    INTO v_previous
    FROM public.zatca_atomic_checkout_branch_gates_v2 g
    WHERE g.tenant_id = v_branch.tenant_id
      AND g.branch_id = v_branch.id
    FOR UPDATE;
    v_gate_exists := FOUND;

    v_evaluation := public.get_zatca_atomic_checkout_eligibility_v2(
      v_branch.id,
      p_actor_user_id
    );
    v_eligible := COALESCE((v_evaluation->>'eligible')::boolean, false);
    v_static_ready := COALESCE((v_evaluation->>'staticReady')::boolean, false);
    v_reason := COALESCE(v_evaluation->>'blockingReason', 'eligibility_unknown');
    v_acknowledged_user_id :=
      NULLIF(v_evaluation->>'acknowledgedUserId', '')::uuid;

    v_desired := v_eligible OR (
      v_gate_exists
      AND v_previous IS TRUE
      AND v_static_ready
      AND v_reason = 'missing_client_acknowledgement'
    );

    IF NOT v_gate_exists THEN
      INSERT INTO public.zatca_atomic_checkout_branch_gates_v2 (
        tenant_id,
        branch_id,
        enabled,
        enabled_at,
        enabled_by,
        updated_at
      ) VALUES (
        v_branch.tenant_id,
        v_branch.id,
        v_desired,
        CASE WHEN v_desired THEN clock_timestamp() ELSE NULL END,
        CASE WHEN v_desired THEN v_acknowledged_user_id ELSE NULL END,
        clock_timestamp()
      );
      v_action := 'inserted';
    ELSIF v_previous IS DISTINCT FROM v_desired THEN
      UPDATE public.zatca_atomic_checkout_branch_gates_v2 g
      SET enabled = v_desired,
          enabled_at = CASE WHEN v_desired THEN clock_timestamp() ELSE NULL END,
          enabled_by = CASE WHEN v_desired THEN v_acknowledged_user_id ELSE NULL END,
          updated_at = clock_timestamp()
      WHERE g.tenant_id = v_branch.tenant_id
        AND g.branch_id = v_branch.id;
      v_action := 'updated';
    ELSE
      v_action := 'unchanged';
    END IF;

    tenant_id := v_branch.tenant_id;
    branch_id := v_branch.id;
    branch_name := v_branch.name;
    previous_gate_state := CASE WHEN v_gate_exists THEN v_previous ELSE NULL END;
    resulting_gate_state := v_desired;
    readiness_result := v_eligible;
    blocking_reason := v_reason;
    action := v_action;
    RETURN NEXT;
  END LOOP;
END
$function$;

ALTER FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid, uuid)
  IS 'Service-only idempotent Atomic Simplified branch-gate synchronization. Never changes Standard enablement.';

DO $catalog_assertions$
DECLARE
  v_function_oid oid :=
    to_regprocedure('public.sync_zatca_atomic_checkout_branch_gates_v2(uuid,uuid)');
  v_owner_oid oid;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_function pg_proc%ROWTYPE;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_SIGNATURE_MISSING';
  END IF;

  SELECT oid INTO v_owner_oid FROM pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated_oid FROM pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_service_role_oid FROM pg_roles WHERE rolname = 'service_role';
  IF v_owner_oid IS NULL
     OR v_anon_oid IS NULL
     OR v_authenticated_oid IS NULL
     OR v_service_role_oid IS NULL THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_REQUIRED_ROLE_MISSING';
  END IF;

  SELECT * INTO v_function FROM pg_proc WHERE oid = v_function_oid;

  IF v_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.provolatile IS DISTINCT FROM 'v'
     OR v_function.proparallel IS DISTINCT FROM 'u'
     OR v_function.prokind IS DISTINCT FROM 'f'
     OR v_function.prorettype IS DISTINCT FROM 'record'::regtype::oid
     OR v_function.proretset IS DISTINCT FROM true
     OR v_function.pronargdefaults IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_EXECUTION_METADATA_MISMATCH';
  END IF;

  IF v_function.proargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid,
       'uuid'::regtype::oid
     ]::oidvector
     OR v_function.proallargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid,
       'uuid'::regtype::oid,
       'uuid'::regtype::oid,
       'uuid'::regtype::oid,
       'text'::regtype::oid,
       'bool'::regtype::oid,
       'bool'::regtype::oid,
       'bool'::regtype::oid,
       'text'::regtype::oid,
       'text'::regtype::oid
     ]::oid[]
     OR v_function.proargmodes IS DISTINCT FROM ARRAY[
       'i'::"char", 'i'::"char",
       't'::"char", 't'::"char", 't'::"char", 't'::"char",
       't'::"char", 't'::"char", 't'::"char", 't'::"char"
     ]::"char"[]
     OR v_function.proargnames IS DISTINCT FROM ARRAY[
       'p_branch_id',
       'p_actor_user_id',
       'tenant_id',
       'branch_id',
       'branch_name',
       'previous_gate_state',
       'resulting_gate_state',
       'readiness_result',
       'blocking_reason',
       'action'
     ]::text[] THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_ARGUMENT_OR_RETURN_CONTRACT_MISMATCH';
  END IF;

  IF v_function.proconfig IS NULL
     OR cardinality(v_function.proconfig) IS DISTINCT FROM 2
     OR NOT ('search_path=public, pg_temp' = ANY(v_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_function.proconfig)) THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_RUNTIME_CONFIGURATION_MISMATCH';
  END IF;

  IF has_function_privilege(0, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_anon_oid, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_authenticated_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_service_role_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_owner_oid, v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_ACL_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      v_function.proacl,
      acldefault('f', v_function.proowner)
    )) acl
    WHERE acl.privilege_type IS DISTINCT FROM 'EXECUTE'
       OR acl.grantee NOT IN (v_owner_oid, v_service_role_oid)
       OR acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_ACL_ENTRY_MISMATCH';
  END IF;

  IF obj_description(v_function_oid, 'pg_proc') IS DISTINCT FROM
     'Service-only idempotent Atomic Simplified branch-gate synchronization. Never changes Standard enablement.' THEN
    RAISE EXCEPTION 'RECOVERED_GATE_SYNC_COMMENT_MISMATCH';
  END IF;
END
$catalog_assertions$;

COMMIT;
