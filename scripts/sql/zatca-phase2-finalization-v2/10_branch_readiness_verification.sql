-- ZATCA Phase 2 immutable finalization v2
-- 10_branch_readiness_verification.sql
-- READ/PROBE ONLY. Verifies the per-branch gate before reviewed seeding.

BEGIN TRANSACTION READ ONLY;

CREATE TEMP TABLE zatca_branch_gate_results (
  check_name text PRIMARY KEY,
  observed_value text,
  expected_value text,
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL'))
) ON COMMIT DROP;

DO $verification$
DECLARE
  v_oid oid;
  v_definition text;
  v_count bigint;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
BEGIN
  INSERT INTO zatca_branch_gate_results VALUES (
    'readiness_table_exists',
    to_regclass('public.zatca_branch_readiness_v2')::text,
    'zatca_branch_readiness_v2',
    CASE WHEN to_regclass('public.zatca_branch_readiness_v2') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  );

  INSERT INTO zatca_branch_gate_results
  SELECT 'readiness_rls_enabled', relrowsecurity::text, 'true',
    CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END
  FROM pg_class WHERE oid = 'public.zatca_branch_readiness_v2'::regclass;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'zatca_branch_readiness_v2'
    AND grantee IN ('anon', 'authenticated');
  INSERT INTO zatca_branch_gate_results VALUES (
    'browser_readiness_table_privileges', v_count::text, '0',
    CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT count(*) INTO v_count
  FROM (VALUES
    ('public.get_zatca_branch_readiness_v2(uuid,uuid)'),
    ('public.approve_zatca_branch_readiness_v2(uuid,text,text,uuid)'),
    ('public.block_zatca_branch_v2(uuid,text,uuid)'),
    ('public.initialize_zatca_new_branch_chain_v2(uuid,text,uuid)'),
    ('public.claim_zatca_finalization_v2(uuid,text,integer)'),
    ('public.allocate_zatca_chain_v2(uuid,uuid)')
  ) required(signature)
  WHERE to_regprocedure(required.signature) IS NOT NULL;
  INSERT INTO zatca_branch_gate_results VALUES (
    'branch_gate_functions_exist', v_count::text, '6',
    CASE WHEN v_count = 6 THEN 'PASS' ELSE 'FAIL' END
  );

  INSERT INTO zatca_branch_gate_results VALUES (
    'unchecked_claim_not_service_executable',
    has_function_privilege(
      'service_role',
      'public.claim_zatca_finalization_v2_unchecked(uuid,text,integer)',
      'EXECUTE'
    )::text,
    'false',
    CASE WHEN NOT has_function_privilege(
      'service_role',
      'public.claim_zatca_finalization_v2_unchecked(uuid,text,integer)',
      'EXECUTE'
    ) THEN 'PASS' ELSE 'FAIL' END
  );

  INSERT INTO zatca_branch_gate_results VALUES (
    'unchecked_allocator_not_service_executable',
    has_function_privilege(
      'service_role',
      'public.allocate_zatca_chain_v2_unchecked(uuid,uuid)',
      'EXECUTE'
    )::text,
    'false',
    CASE WHEN NOT has_function_privilege(
      'service_role',
      'public.allocate_zatca_chain_v2_unchecked(uuid,uuid)',
      'EXECUTE'
    ) THEN 'PASS' ELSE 'FAIL' END
  );

  v_oid := to_regprocedure('public.initialize_zatca_finalization_v2_invoice()')::oid;
  v_definition := pg_get_functiondef(v_oid);
  INSERT INTO zatca_branch_gate_results VALUES (
    'invoice_initializer_branch_gate',
    CASE WHEN v_definition ILIKE '%get_zatca_branch_readiness_v2%'
      AND v_definition ILIKE '%clientAcknowledged%'
      AND v_definition ILIKE '%zatca_finalization_version := 2%'
    THEN 'present' ELSE 'missing' END,
    'present',
    CASE WHEN v_definition ILIKE '%get_zatca_branch_readiness_v2%'
      AND v_definition ILIKE '%clientAcknowledged%'
      AND v_definition ILIKE '%zatca_finalization_version := 2%'
    THEN 'PASS' ELSE 'FAIL' END
  );

  v_oid := to_regprocedure('public.claim_zatca_finalization_v2(uuid,text,integer)')::oid;
  v_definition := pg_get_functiondef(v_oid);
  INSERT INTO zatca_branch_gate_results VALUES (
    'claim_checks_readiness_before_unchecked_call',
    CASE WHEN position('readiness_status = ''ready''' IN v_definition) > 0
      AND position('readiness_status = ''ready''' IN v_definition)
      < position('claim_zatca_finalization_v2_unchecked' IN v_definition)
    THEN 'present' ELSE 'missing' END,
    'present',
    CASE WHEN position('readiness_status = ''ready''' IN v_definition) > 0
      AND position('readiness_status = ''ready''' IN v_definition)
      < position('claim_zatca_finalization_v2_unchecked' IN v_definition)
    THEN 'PASS' ELSE 'FAIL' END
  );

  v_oid := to_regprocedure('public.allocate_zatca_chain_v2(uuid,uuid)')::oid;
  v_definition := pg_get_functiondef(v_oid);
  INSERT INTO zatca_branch_gate_results VALUES (
    'allocator_checks_readiness_before_unchecked_call',
    CASE WHEN position('readiness_status = ''ready''' IN v_definition) > 0
      AND position('readiness_status = ''ready''' IN v_definition)
      < position('allocate_zatca_chain_v2_unchecked' IN v_definition)
    THEN 'present' ELSE 'missing' END,
    'present',
    CASE WHEN position('readiness_status = ''ready''' IN v_definition) > 0
      AND position('readiness_status = ''ready''' IN v_definition)
      < position('allocate_zatca_chain_v2_unchecked' IN v_definition)
    THEN 'PASS' ELSE 'FAIL' END
  );

  v_oid := to_regprocedure(
    'public.acknowledge_zatca_client_capability_v2(uuid,uuid,text,text,integer)'
  )::oid;
  v_definition := pg_get_functiondef(v_oid);
  INSERT INTO zatca_branch_gate_results VALUES (
    'acknowledgement_requires_structural_readiness',
    CASE WHEN v_definition ILIKE '%structurallyReady%'
      AND v_definition ILIKE '%branch_or_global_not_ready%'
    THEN 'present' ELSE 'missing' END,
    'present',
    CASE WHEN v_definition ILIKE '%structurallyReady%'
      AND v_definition ILIKE '%branch_or_global_not_ready%'
    THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT * INTO v_runtime
  FROM public.zatca_finalization_runtime WHERE singleton = true;
  INSERT INTO zatca_branch_gate_results VALUES (
    'runtime_edge_version', v_runtime.minimum_edge_version, '2.1.0',
    CASE WHEN v_runtime.minimum_edge_version = '2.1.0' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO zatca_branch_gate_results VALUES (
    'runtime_client_version', v_runtime.minimum_client_version, '2.1.0',
    CASE WHEN v_runtime.minimum_client_version = '2.1.0' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO zatca_branch_gate_results VALUES (
    'runtime_flags_false',
    format('master=%s;simplified=%s;standard=%s',
      v_runtime.immutable_finalization_enabled,
      v_runtime.simplified_enabled,
      v_runtime.standard_enabled),
    'master=false;simplified=false;standard=false',
    CASE WHEN NOT v_runtime.immutable_finalization_enabled
      AND NOT v_runtime.simplified_enabled
      AND NOT v_runtime.standard_enabled
    THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT count(*) INTO v_count
  FROM public.invoices i
  WHERE i.zatca_finalization_version = 2
    AND NOT EXISTS (
      SELECT 1
      FROM public.zatca_branch_readiness_v2 r
      JOIN public.zatca_chain_heads_v2 h USING (tenant_id, branch_id)
      WHERE r.tenant_id = i.tenant_id
        AND r.branch_id = i.branch_id
        AND r.readiness_status = 'ready'
    );
  INSERT INTO zatca_branch_gate_results VALUES (
    'no_v2_invoice_without_ready_head', v_count::text, '0',
    CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END
  );

  v_oid := to_regprocedure('public.initialize_zatca_finalization_v2_invoice()')::oid;
  v_definition := pg_get_functiondef(v_oid);
  INSERT INTO zatca_branch_gate_results VALUES (
    'standard_flag_remains_authoritative',
    CASE WHEN v_definition ILIKE '%v_kind = ''standard''%'
      AND v_definition ILIKE '%standard_enabled%'
    THEN 'present' ELSE 'missing' END,
    'present',
    CASE WHEN v_definition ILIKE '%v_kind = ''standard''%'
      AND v_definition ILIKE '%standard_enabled%'
    THEN 'PASS' ELSE 'FAIL' END
  );
END
$verification$;

DO $complete$
DECLARE v_total bigint; v_pass bigint; v_fail bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE result = 'PASS'),
    count(*) FILTER (WHERE result = 'FAIL')
  INTO v_total, v_pass, v_fail
  FROM zatca_branch_gate_results;
  IF v_total <> 15 OR v_pass <> 15 OR v_fail <> 0 THEN
    RAISE EXCEPTION 'BRANCH_GATE_VERIFICATION_FAILED:total=%,pass=%,fail=%',
      v_total, v_pass, v_fail;
  END IF;
END
$complete$;

SELECT check_name, observed_value, expected_value, result
FROM zatca_branch_gate_results
ORDER BY check_name;

ROLLBACK;
