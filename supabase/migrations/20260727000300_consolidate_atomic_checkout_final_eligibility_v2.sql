BEGIN;

CREATE OR REPLACE FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(
  p_branch_id uuid,
  p_client_version text,
  p_edge_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security TO off
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_expected_schema_version constant integer := 2;
  v_expected_client_version constant text := '2.1.0';
  v_expected_edge_version constant text := '2.1.0';
  v_profile record;
  v_branch record;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_runtime_found boolean := false;
  v_sync record;
  v_sync_count integer := 0;
  v_reason text;
  v_legacy_reason text;
BEGIN
  -- Deterministic lock order: authenticated actor profile, requested branch,
  -- then the recovered synchronizer's advisory lock and gate-row lock. The
  -- checkout prepare RPC runs in a later network transaction, so its
  -- idempotency/chain locks cannot overlap this order.
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'unauthenticated'
    );
  END IF;

  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'branch_access_denied'
    );
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = v_actor_user_id
    AND p.is_active = true
  FOR UPDATE;

  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'admin', 'branch') THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'caller_profile_not_found'
    );
  END IF;

  SELECT b.id, b.tenant_id
  INTO v_branch
  FROM public.branches b
  WHERE b.id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (
       v_profile.role = 'branch'
       AND v_profile.branch_id IS DISTINCT FROM v_branch.id
     ) THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'branch_access_denied'
    );
  END IF;

  SELECT *
  INTO v_runtime
  FROM public.zatca_finalization_runtime r
  WHERE r.singleton = true;
  v_runtime_found := FOUND;

  IF p_client_version IS DISTINCT FROM v_expected_client_version
     OR p_edge_version IS DISTINCT FROM v_expected_edge_version THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'version_incompatible'
    );
  END IF;

  IF v_runtime_found AND (
    v_runtime.schema_version IS DISTINCT FROM v_expected_schema_version
    OR v_runtime.minimum_client_version IS DISTINCT FROM v_expected_client_version
    OR v_runtime.minimum_edge_version IS DISTINCT FROM v_expected_edge_version
  ) THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'version_incompatible'
    );
  END IF;

  -- The locked rows prevent profile reassignment/deactivation and branch
  -- reassignment between authorization and the privileged gate write.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles p
    JOIN public.branches b ON b.id = p_branch_id
    WHERE p.id = v_actor_user_id
      AND p.is_active = true
      AND p.tenant_id = v_profile.tenant_id
      AND p.role::text = v_profile.role
      AND b.tenant_id = v_branch.tenant_id
      AND (
        p.role::text IN ('owner', 'admin')
        OR (
          p.role::text = 'branch'
          AND p.branch_id = v_branch.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_AUTHORIZATION_CHANGED'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_sync IN
    SELECT *
    FROM public.sync_zatca_atomic_checkout_branch_gates_v2(
      p_branch_id,
      v_actor_user_id
    )
  LOOP
    v_sync_count := v_sync_count + 1;
  END LOOP;

  IF v_sync_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_CARDINALITY_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.branch_id IS DISTINCT FROM p_branch_id
     OR v_sync.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR v_sync.action NOT IN ('inserted', 'updated', 'unchanged')
     OR v_sync.resulting_gate_state IS NULL
     OR v_sync.readiness_result IS NULL
     OR NULLIF(btrim(v_sync.blocking_reason), '') IS NULL THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_CONTRACT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.blocking_reason NOT IN (
    'eligible',
    'inactive_branch',
    'inactive_tenant',
    'tenant_suspended',
    'runtime_missing',
    'immutable_finalization_disabled',
    'simplified_finalization_disabled',
    'atomic_global_disabled',
    'schema_version_incompatible',
    'edge_version_incompatible',
    'client_version_incompatible',
    'explicitly_blocked',
    'readiness_missing',
    'branch_not_ready',
    'missing_chain_head',
    'missing_production_credentials',
    'missing_client_acknowledgement'
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_REASON_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.readiness_result IS TRUE THEN
    IF v_sync.resulting_gate_state IS NOT TRUE
       OR v_sync.blocking_reason <> 'eligible' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_sync.resulting_gate_state IS FALSE THEN
    IF v_sync.blocking_reason = 'eligible' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_sync.resulting_gate_state IS TRUE THEN
    IF v_sync.blocking_reason <> 'missing_client_acknowledgement' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.readiness_result IS TRUE
     AND v_sync.resulting_gate_state IS TRUE
     AND v_sync.blocking_reason = 'eligible' THEN
    RETURN jsonb_build_object(
      'status', 'eligible',
      'branchId', v_sync.branch_id,
      'blockingReason', NULL,
      'gateSyncAction', v_sync.action
    );
  END IF;

  v_reason := v_sync.blocking_reason;
  v_legacy_reason := CASE
    WHEN v_reason IN (
      'runtime_missing',
      'immutable_finalization_disabled',
      'simplified_finalization_disabled',
      'atomic_global_disabled',
      'schema_version_incompatible',
      'edge_version_incompatible',
      'client_version_incompatible'
    ) THEN 'atomic_rollout_disabled'
    ELSE 'atomic_branch_not_ready'
  END;

  RETURN jsonb_build_object(
    'status', 'legacy_required',
    'branchId', v_sync.branch_id,
    'reason', v_legacy_reason,
    'blockingReason', v_reason,
    'gateSyncAction', v_sync.action
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'dependency_failed',
    'reason', 'final_eligibility_dependency_failed'
  );
END
$function$;

ALTER FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid, text, text)
  FROM PUBLIC;
DO $reset_acl$
DECLARE
  v_role record;
BEGIN
  -- CREATE OR REPLACE preserves historical ACL entries. Remove every explicit
  -- non-owner grant, including roles unknown to this migration.
  FOR v_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname <> 'postgres'
    ORDER BY oid
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid, text, text) FROM %I',
      v_role.rolname
    );
  END LOOP;
END
$reset_acl$;
GRANT EXECUTE ON FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid, text, text)
  IS 'Authenticated Atomic Simplified final eligibility evaluation and branch-gate synchronization. Returns no artifacts or secrets.';

DO $catalog_assertions$
DECLARE
  v_function_oid oid :=
    to_regprocedure('public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid,text,text)');
  v_owner_oid oid;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_plpgsql_oid oid;
  v_function pg_proc%ROWTYPE;
  v_sync_function pg_proc%ROWTYPE;
  v_eligibility_function pg_proc%ROWTYPE;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SIGNATURE_MISSING';
  END IF;

  SELECT oid INTO v_owner_oid FROM pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated_oid FROM pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_service_role_oid FROM pg_roles WHERE rolname = 'service_role';
  SELECT oid INTO v_plpgsql_oid FROM pg_language WHERE lanname = 'plpgsql';

  SELECT * INTO v_function FROM pg_proc WHERE oid = v_function_oid;

  IF v_owner_oid IS NULL
     OR v_anon_oid IS NULL
     OR v_authenticated_oid IS NULL
     OR v_service_role_oid IS NULL
     OR v_plpgsql_oid IS NULL
     OR v_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.prokind IS DISTINCT FROM 'f'
     OR v_function.prolang IS DISTINCT FROM v_plpgsql_oid
     OR v_function.provolatile IS DISTINCT FROM 'v'
     OR v_function.proparallel IS DISTINCT FROM 'u'
     OR v_function.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
     OR v_function.proretset IS DISTINCT FROM false
     OR v_function.pronargdefaults IS DISTINCT FROM 0
     OR v_function.proargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid,
       'text'::regtype::oid,
       'text'::regtype::oid
     ]::oidvector
     OR v_function.proargnames IS DISTINCT FROM ARRAY[
       'p_branch_id',
       'p_client_version',
       'p_edge_version'
     ]::text[] THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_CONTRACT_OR_METADATA_MISMATCH';
  END IF;

  IF v_function.proconfig IS NULL
     OR cardinality(v_function.proconfig) IS DISTINCT FROM 2
     OR NOT ('search_path=public, pg_temp' = ANY(v_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_function.proconfig)) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_RUNTIME_CONFIGURATION_MISMATCH';
  END IF;

  IF obj_description(v_function_oid, 'pg_proc') IS DISTINCT FROM
     'Authenticated Atomic Simplified final eligibility evaluation and branch-gate synchronization. Returns no artifacts or secrets.' THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_COMMENT_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE oid = v_owner_oid
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_OWNER_CANNOT_BYPASS_RLS';
  END IF;

  IF has_function_privilege(0, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_anon_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_authenticated_oid, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_service_role_oid, v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_ACL_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      v_function.proacl,
      acldefault('f', v_function.proowner)
    )) acl
    WHERE acl.privilege_type IS DISTINCT FROM 'EXECUTE'
       OR acl.grantee NOT IN (v_owner_oid, v_authenticated_oid)
       OR acl.is_grantable
  ) OR NOT EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      v_function.proacl,
      acldefault('f', v_function.proowner)
    )) acl
    WHERE acl.grantee = v_owner_oid
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) OR NOT EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(
      v_function.proacl,
      acldefault('f', v_function.proowner)
    )) acl
    WHERE acl.grantee = v_authenticated_oid
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_ACL_ENTRY_MISMATCH';
  END IF;

  SELECT * INTO v_sync_function
  FROM pg_proc
  WHERE oid = to_regprocedure(
    'public.sync_zatca_atomic_checkout_branch_gates_v2(uuid,uuid)'
  );
  IF NOT FOUND
     OR v_sync_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_sync_function.prosecdef IS DISTINCT FROM true
     OR v_sync_function.prokind IS DISTINCT FROM 'f'
     OR v_sync_function.prolang IS DISTINCT FROM v_plpgsql_oid
     OR v_sync_function.provolatile IS DISTINCT FROM 'v'
     OR v_sync_function.proparallel IS DISTINCT FROM 'u'
     OR v_sync_function.proretset IS DISTINCT FROM true
     OR v_sync_function.proconfig IS NULL
     OR NOT ('search_path=public, pg_temp' = ANY(v_sync_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_sync_function.proconfig)) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_DEPENDENCY_MISMATCH';
  END IF;

  SELECT * INTO v_eligibility_function
  FROM pg_proc
  WHERE oid = to_regprocedure(
    'public.get_zatca_atomic_checkout_eligibility_v2(uuid,uuid)'
  );
  IF NOT FOUND
     OR v_eligibility_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_eligibility_function.prosecdef IS DISTINCT FROM true
     OR v_eligibility_function.prokind IS DISTINCT FROM 'f'
     OR v_eligibility_function.prolang IS DISTINCT FROM v_plpgsql_oid
     OR v_eligibility_function.provolatile IS DISTINCT FROM 's'
     OR v_eligibility_function.proparallel IS DISTINCT FROM 'u'
     OR v_eligibility_function.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
     OR v_eligibility_function.proconfig IS NULL
     OR NOT ('search_path=public, pg_temp' = ANY(v_eligibility_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_eligibility_function.proconfig)) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_EVALUATION_DEPENDENCY_MISMATCH';
  END IF;
END
$catalog_assertions$;

COMMIT;
