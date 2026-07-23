-- ZATCA Phase 2 immutable finalization v2
-- 06_verification.sql
-- READ/PROBE ONLY. Every mandatory check emits exactly one row; final ROLLBACK.

BEGIN;

CREATE TEMP TABLE zatca_v2_verification_results (
  check_name text PRIMARY KEY,
  observed_value text,
  expected_value text,
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'REVIEW'))
) ON COMMIT DROP;

DO $verification$
DECLARE
  v_runtime_exists boolean := to_regclass('public.zatca_finalization_runtime') IS NOT NULL;
  v_runtime_shape_ok boolean := false;
  v_runtime_total bigint := 0;
  v_runtime_count bigint := 0;
  v_master boolean;
  v_simplified boolean;
  v_standard boolean;
  v_schema_version integer;
  v_edge_version text;
  v_client_version text;
  v_count bigint;
  v_total bigint;
  v_missing bigint;
  v_oid oid;
  v_definition text;
  v_search_path_ok boolean;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_execute boolean;
  v_safe_output_contract boolean;
  v_trigger record;
  v_function record;
  v_relation record;
  v_protected_columns constant text[] := ARRAY[
    'zatca_qr_code', 'zatca_xml', 'zatca_xml_hash', 'zatca_signature',
    'zatca_uuid', 'zatca_counter_number', 'zatca_prev_invoice_hash',
    'zatca_finalization_version', 'zatca_artifact_provenance',
    'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
    'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash',
    'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash',
    'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash',
    'zatca_cleared_signature', 'zatca_cleared_qr',
    'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
    'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
    'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
    'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
    'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
    'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
    'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
    'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
    'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2'
  ];
  v_raw_v2_columns constant text[] := ARRAY[
    'zatca_uuid', 'zatca_type_code', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_xml', 'zatca_xml_hash',
    'zatca_signature', 'zatca_qr_code', 'zatca_submission_id',
    'zatca_clearance_status', 'zatca_clearance_response',
    'zatca_reporting_response', 'zatca_warnings',
    'checkout_idempotency_key', 'credit_note_idempotency_key',
    'zatca_finalization_version', 'zatca_artifact_provenance',
    'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
    'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash',
    'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash',
    'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash',
    'zatca_cleared_signature', 'zatca_cleared_qr',
    'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
    'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
    'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
    'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
    'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
    'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
    'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
    'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
    'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2'
  ];
  v_safe_invoice_columns constant text[] := ARRAY[
    'id', 'tenant_id', 'branch_id', 'customer_id', 'created_by',
    'invoice_number', 'invoice_reference', 'zatca_invoice_type',
    'zatca_status', 'zatca_submitted_at', 'subtotal', 'discount_amount',
    'taxable_amount', 'tax_amount', 'total_amount', 'currency_code',
    'invoice_date', 'supply_date', 'due_date', 'status', 'payment_status',
    'notes', 'notes_ar', 'cancelled_at', 'cancellation_reason',
    'created_at', 'updated_at', 'session_id', 'payment_method',
    'original_invoice_id', 'credit_reason', 'document_language'
  ];
BEGIN
  -- Runtime state. Dynamic SQL lets a missing runtime table produce FAIL rows
  -- instead of aborting or silently omitting checks.
  SELECT count(*) = 7 INTO v_runtime_shape_ok
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'zatca_finalization_runtime'
    AND column_name IN (
      'singleton', 'immutable_finalization_enabled', 'simplified_enabled',
      'standard_enabled', 'schema_version', 'minimum_edge_version',
      'minimum_client_version'
    );

  IF v_runtime_exists AND v_runtime_shape_ok THEN
    EXECUTE $sql$
      SELECT count(*), count(*) FILTER (WHERE singleton = true),
        bool_or(immutable_finalization_enabled) FILTER (WHERE singleton = true),
        bool_or(simplified_enabled) FILTER (WHERE singleton = true),
        bool_or(standard_enabled) FILTER (WHERE singleton = true),
        min(schema_version) FILTER (WHERE singleton = true),
        min(minimum_edge_version) FILTER (WHERE singleton = true),
        min(minimum_client_version) FILTER (WHERE singleton = true)
      FROM public.zatca_finalization_runtime
    $sql$ INTO v_runtime_total, v_runtime_count, v_master, v_simplified, v_standard,
      v_schema_version, v_edge_version, v_client_version;
  END IF;

  INSERT INTO zatca_v2_verification_results VALUES
    ('runtime_singleton_count',
      CASE WHEN v_runtime_exists
        THEN CASE WHEN v_runtime_shape_ok
          THEN format('rows=%s;singleton_true=%s', v_runtime_total, v_runtime_count)
          ELSE 'table_shape_invalid' END
        ELSE 'table_missing' END,
      'rows=1;singleton_true=1',
      CASE WHEN v_runtime_exists AND v_runtime_shape_ok
        AND v_runtime_total = 1 AND v_runtime_count = 1 THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_master_flag_false', COALESCE(v_master::text, 'missing'), 'false',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_master = false THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_simplified_flag_false', COALESCE(v_simplified::text, 'missing'), 'false',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_simplified = false THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_standard_flag_false', COALESCE(v_standard::text, 'missing'), 'false',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_standard = false THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_schema_version', COALESCE(v_schema_version::text, 'missing'), '2',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_schema_version = 2 THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_edge_version', COALESCE(v_edge_version, 'missing'), '2.0.0',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_edge_version = '2.0.0' THEN 'PASS' ELSE 'FAIL' END),
    ('runtime_client_version', COALESCE(v_client_version, 'missing'), '2.0.0',
      CASE WHEN v_runtime_total = 1 AND v_runtime_count = 1 AND v_client_version = '2.0.0' THEN 'PASS' ELSE 'FAIL' END);

  -- Policy state after 04.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'invoices'
    AND policyname IN ('phase3a_invoices_qr_backfill_update', 'invoices_qr_backfill_update');
  INSERT INTO zatca_v2_verification_results VALUES
    ('legacy_qr_backfill_policies_absent', v_count::text, '0',
      CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_count
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'invoices'
    AND p.cmd IN ('UPDATE', 'ALL')
    AND EXISTS (
      SELECT 1 FROM unnest(p.roles) role_name
      WHERE lower(role_name::text) IN ('public', 'anon', 'authenticated')
    );
  INSERT INTO zatca_v2_verification_results VALUES
    ('no_browser_invoice_update_policy_replacement', v_count::text, '0',
      CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- Browser update grants: check both table-wide and every named protected
  -- column without assuming a missing v2 column exists.
  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'invoices'
    AND grantee IN ('anon', 'authenticated') AND privilege_type = 'UPDATE';
  SELECT count(*) INTO v_total
  FROM information_schema.role_column_grants
  WHERE table_schema = 'public' AND table_name = 'invoices'
    AND grantee IN ('anon', 'authenticated') AND privilege_type = 'UPDATE'
    AND column_name = ANY(v_protected_columns);
  INSERT INTO zatca_v2_verification_results VALUES
    ('browser_protected_update_privileges',
      format('table=%s;protected_columns=%s', v_count, v_total),
      'table=0;protected_columns=0',
      CASE WHEN v_count = 0 AND v_total = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_count
  FROM unnest(ARRAY['anon', 'authenticated']::text[]) browser_role(role_name)
  CROSS JOIN unnest(v_raw_v2_columns) raw(column_name)
  WHERE has_column_privilege(
    browser_role.role_name, 'public.invoices', raw.column_name, 'SELECT'
  );
  INSERT INTO zatca_v2_verification_results VALUES
    ('browser_raw_v2_select_privileges', v_count::text, '0',
      CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END),
    ('frontend_safe_status_source_contract', 'not observable from PostgreSQL',
      'repository static audit confirms no authenticated invoices select(*) or direct server-only selector; permitted QR/status uses the safe status API', 'REVIEW');

  INSERT INTO zatca_v2_verification_results VALUES
    ('browser_invoice_table_select_absent',
      format('authenticated=%s;anon=%s',
        has_table_privilege('authenticated', 'public.invoices', 'SELECT'),
        has_table_privilege('anon', 'public.invoices', 'SELECT')),
      'authenticated=false;anon=false',
      CASE WHEN NOT has_table_privilege('authenticated', 'public.invoices', 'SELECT')
        AND NOT has_table_privilege('anon', 'public.invoices', 'SELECT')
      THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_count
  FROM unnest(v_safe_invoice_columns) required(column_name)
  WHERE NOT has_column_privilege(
    'authenticated', 'public.invoices', required.column_name, 'SELECT'
  );
  INSERT INTO zatca_v2_verification_results VALUES
    ('authenticated_safe_invoice_select_privileges', v_count::text, '0 missing',
      CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('anon', 'public.invoices', a.attname, 'SELECT');
  INSERT INTO zatca_v2_verification_results VALUES
    ('anon_invoice_select_privileges', v_count::text, '0',
      CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT has_column_privilege('service_role', 'public.invoices', a.attname, 'SELECT');
  INSERT INTO zatca_v2_verification_results VALUES
    ('service_role_invoice_read_privileges',
      format('table=%s;missing_columns=%s',
        has_table_privilege('service_role', 'public.invoices', 'SELECT'), v_count),
      'table=true;missing_columns=0',
      CASE WHEN has_table_privilege('service_role', 'public.invoices', 'SELECT')
        AND v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- Every v2 function is checked by exact signature. All are SECURITY DEFINER
  -- with a fixed search_path and browser execution denied. service_required is
  -- false only for trigger-only functions, which PostgreSQL invokes directly.
  FOR v_function IN
    SELECT * FROM (VALUES
      ('public.initialize_zatca_finalization_v2_invoice()', false),
      ('public.seed_zatca_chain_head_v2(uuid,bigint,text,text)', true),
      ('public.allocate_zatca_chain_v2(uuid,uuid)', true),
      ('public.commit_zatca_chain_v2(uuid,uuid,text)', true),
      ('public.zatca_v2_document_kind(public.invoices)', true),
      ('public.claim_zatca_finalization_v2(uuid,text,integer)', true),
      ('public.persist_zatca_simplified_final_v2(uuid,uuid,text,text,text,text)', true),
      ('public.persist_zatca_standard_provisional_v2(uuid,uuid,text,text,text,text)', true),
      ('public.fail_zatca_finalization_v2(uuid,uuid,jsonb)', true),
      ('public.claim_zatca_network_v2(uuid,text,integer)', true),
      ('public.mark_zatca_network_request_started_v2(uuid,uuid)', true),
      ('public.persist_zatca_reporting_result_v2(uuid,uuid,boolean,jsonb,jsonb)', true),
      ('public.adopt_zatca_cleared_artifact_v2(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb)', true),
      ('public.fail_zatca_network_v2(uuid,uuid,boolean,text,jsonb)', true),
      ('public.assert_zatca_compliance_write_v2()', false),
      ('public.get_zatca_finalization_capabilities_v2()', true),
      ('public.acknowledge_zatca_client_capability_v2(uuid,uuid,text,text,integer)', true),
      ('public.require_zatca_client_capability_v2()', false),
      ('public.get_zatca_output_state_v2(uuid,uuid)', true)
    ) AS expected(signature, service_required)
  LOOP
    v_oid := to_regprocedure(v_function.signature)::oid;
    v_search_path_ok := false;
    v_public_execute := false;
    v_anon_execute := false;
    v_authenticated_execute := false;
    v_service_execute := false;

    IF v_oid IS NOT NULL THEN
      SELECT COALESCE(p.proconfig @> ARRAY['search_path=public, pg_temp'], false),
        EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) privilege
          WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        )
      INTO v_search_path_ok, v_public_execute
      FROM pg_proc p WHERE p.oid = v_oid;

      v_anon_execute := has_function_privilege('anon', v_oid, 'EXECUTE');
      v_authenticated_execute := has_function_privilege('authenticated', v_oid, 'EXECUTE');
      v_service_execute := has_function_privilege('service_role', v_oid, 'EXECUTE');
    END IF;

    INSERT INTO zatca_v2_verification_results VALUES (
      'function_' || split_part(split_part(v_function.signature, '.', 2), '(', 1),
      format('exists=%s;security_definer=%s;search_path=%s;public=%s;anon=%s;authenticated=%s;service=%s',
        v_oid IS NOT NULL,
        COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false),
        v_search_path_ok, v_public_execute, v_anon_execute,
        v_authenticated_execute, v_service_execute),
      format('exists=true;security_definer=true;search_path=true;public=false;anon=false;authenticated=false;service=%s',
        v_function.service_required),
      CASE WHEN v_oid IS NOT NULL
        AND COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false)
        AND v_search_path_ok
        AND NOT v_public_execute AND NOT v_anon_execute AND NOT v_authenticated_execute
        AND v_service_execute = v_function.service_required
      THEN 'PASS' ELSE 'FAIL' END
    );
  END LOOP;

  v_oid := to_regprocedure('public.get_zatca_output_state_v2(uuid,uuid)')::oid;
  v_definition := CASE WHEN v_oid IS NULL THEN '' ELSE pg_get_functiondef(v_oid) END;
  v_safe_output_contract := v_oid IS NOT NULL
    AND v_definition LIKE '%''invoiceId''%'
    AND v_definition LIKE '%''documentKind''%'
    AND v_definition LIKE '%''finalizationStatus''%'
    AND v_definition LIKE '%''artifactStage''%'
    AND v_definition LIKE '%''canPrint''%'
    AND v_definition LIKE '%''canShare''%'
    AND v_definition LIKE '%''qrCode''%'
    AND v_definition NOT LIKE '%''xml''%'
    AND v_definition NOT LIKE '%''hash''%'
    AND v_definition NOT LIKE '%''signature''%'
    AND v_definition NOT LIKE '%''counter''%'
    AND v_definition NOT LIKE '%''claimToken''%'
    AND v_definition NOT LIKE '%''leaseExpiresAt''%'
    AND v_definition NOT LIKE '%''networkResponse''%';
  INSERT INTO zatca_v2_verification_results VALUES
    ('safe_status_rpc_service_path',
      CASE WHEN v_oid IS NULL THEN 'missing'
        ELSE format('service=%s;authenticated=%s;safe_contract=%s',
          has_function_privilege('service_role', v_oid, 'EXECUTE'),
          has_function_privilege('authenticated', v_oid, 'EXECUTE'),
          v_safe_output_contract) END,
      'service=true;authenticated=false;safe_contract=true',
      CASE WHEN v_oid IS NOT NULL
        AND has_function_privilege('service_role', v_oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
        AND v_safe_output_contract
      THEN 'PASS' ELSE 'FAIL' END);

  -- Required trigger identity, binding, enabled state, and timing.
  FOR v_trigger IN
    SELECT * FROM (VALUES
      ('zatca_v2_10_require_client_capability',
        'public.require_zatca_client_capability_v2()', 'BEFORE INSERT'),
      ('zatca_v2_20_initialize_invoice',
        'public.initialize_zatca_finalization_v2_invoice()', 'BEFORE INSERT'),
      ('invoices_zatca_compliance_write_guard_v2',
        'public.assert_zatca_compliance_write_v2()', 'BEFORE UPDATE')
    ) AS expected(trigger_name, function_signature, timing_event)
  LOOP
    SELECT t.oid, t.tgenabled, t.tgrelid, t.tgfoid,
      pg_get_triggerdef(t.oid, true) AS definition
    INTO v_relation
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.invoices'::regclass
      AND t.tgname = v_trigger.trigger_name
      AND NOT t.tgisinternal;

    INSERT INTO zatca_v2_verification_results VALUES (
      'trigger_' || v_trigger.trigger_name,
      CASE WHEN v_relation.oid IS NULL THEN 'missing'
        ELSE format('enabled=%s;table=%s;function=%s;definition=%s',
          v_relation.tgenabled, v_relation.tgrelid::regclass,
          v_relation.tgfoid::regprocedure, v_relation.definition) END,
      format('enabled=O;table=public.invoices;function=%s;%s;FOR EACH ROW',
        v_trigger.function_signature, v_trigger.timing_event),
      CASE WHEN v_relation.oid IS NOT NULL
        AND v_relation.tgenabled = 'O'
        AND v_relation.tgrelid = 'public.invoices'::regclass
        AND v_relation.tgfoid = to_regprocedure(v_trigger.function_signature)::oid
        AND upper(v_relation.definition) LIKE '%' || v_trigger.timing_event || '%'
        AND upper(v_relation.definition) LIKE '%FOR EACH ROW%'
      THEN 'PASS' ELSE 'FAIL' END
    );
  END LOOP;

  -- Allocator ownership is structurally inspectable; two-session behavior is
  -- deliberately REVIEW until the isolated PostgreSQL release fixture runs.
  v_oid := to_regprocedure('public.allocate_zatca_chain_v2(uuid,uuid)')::oid;
  v_definition := CASE WHEN v_oid IS NULL THEN '' ELSE pg_get_functiondef(v_oid) END;
  INSERT INTO zatca_v2_verification_results VALUES
    ('allocator_invoice_row_lock',
      CASE WHEN v_definition ~* 'WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*p_invoice_id[[:space:]]+FOR[[:space:]]+UPDATE' THEN 'present' ELSE 'missing' END,
      'target invoice SELECT ... FOR UPDATE',
      CASE WHEN v_definition ~* 'WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*p_invoice_id[[:space:]]+FOR[[:space:]]+UPDATE' THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_current_token_comparison',
      CASE WHEN v_definition LIKE '%v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token%' THEN 'present' ELSE 'missing' END,
      'current invoice token equals p_claim_token',
      CASE WHEN v_definition LIKE '%v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token%' THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_active_lease_validation',
      CASE WHEN v_definition LIKE '%v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp()%' THEN 'present' ELSE 'missing' END,
      'lease exists and is later than clock_timestamp()',
      CASE WHEN v_definition LIKE '%v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp()%' THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_lifecycle_validation',
      CASE WHEN v_definition LIKE $$%zatca_lifecycle_state NOT IN ('claiming', 'retrying')%$$ THEN 'present' ELSE 'missing' END,
      'allocation lifecycle is claiming or retrying',
      CASE WHEN v_definition LIKE $$%zatca_lifecycle_state NOT IN ('claiming', 'retrying')%$$ THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_deterministic_stale_rejection',
      CASE WHEN v_definition LIKE $$%RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN'%$$ THEN 'present' ELSE 'missing' END,
      'STALE_CHAIN_CLAIM_TOKEN',
      CASE WHEN v_definition LIKE $$%RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN'%$$ THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_first_head_serialization',
      CASE WHEN v_definition LIKE '%pg_advisory_xact_lock%'
        AND v_definition LIKE '%ON CONFLICT (tenant_id, branch_id) DO NOTHING%'
        AND v_definition LIKE '%FOR UPDATE%' THEN 'present' ELSE 'missing' END,
      'transaction advisory lock + conflict-safe insert + locked reread',
      CASE WHEN v_definition LIKE '%pg_advisory_xact_lock%'
        AND v_definition LIKE '%ON CONFLICT (tenant_id, branch_id) DO NOTHING%'
        AND v_definition LIKE '%FOR UPDATE%' THEN 'PASS' ELSE 'FAIL' END),
    ('allocator_two_session_behavior', 'not executed by this SQL session',
      'isolated two-session fixture passes', 'REVIEW'),
    ('allocator_stale_transfer_behavior', 'not executed by this SQL session',
      'old token rejected; new token reuses and commits', 'REVIEW');

  SELECT count(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'zatca_chain_reservations_v2'
    AND indexdef ILIKE '%UNIQUE%'
    AND indexdef ILIKE '%tenant_id, branch_id, counter_number%';
  INSERT INTO zatca_v2_verification_results VALUES
    ('allocator_unique_counter_index', v_count::text, '1',
      CASE WHEN v_count = 1 THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO zatca_v2_verification_results VALUES
    ('allocator_one_open_reservation_index',
      CASE WHEN to_regclass('public.zatca_chain_one_open_reservation_v2') IS NULL THEN 'missing' ELSE 'present' END,
      'present', CASE WHEN to_regclass('public.zatca_chain_one_open_reservation_v2') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- Historical checks are dynamic so missing columns/tables still emit FAIL.
  SELECT count(*) INTO v_missing
  FROM unnest(ARRAY[
    'zatca_finalization_version', 'zatca_artifact_provenance', 'zatca_artifact_stage',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash', 'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash', 'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash', 'zatca_cleared_signature', 'zatca_cleared_qr'
  ]::text[]) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'invoices'
      AND c.column_name = required.column_name
  );

  IF v_runtime_exists AND v_runtime_shape_ok
     AND v_runtime_total = 1 AND v_runtime_count = 1 AND v_missing = 0 THEN
    EXECUTE $sql$
      SELECT count(*)
      FROM public.invoices i
      CROSS JOIN public.zatca_finalization_runtime r
      WHERE r.singleton = true AND i.created_at < r.installed_at
        AND (i.zatca_finalization_version IS NOT NULL
          OR i.zatca_artifact_provenance IS NOT NULL
          OR i.zatca_artifact_stage IS NOT NULL)
    $sql$ INTO v_count;
    INSERT INTO zatca_v2_verification_results VALUES
      ('historical_v2_classification', v_count::text, '0',
        CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);

    EXECUTE $sql$
      SELECT count(*)
      FROM public.invoices i
      CROSS JOIN public.zatca_finalization_runtime r
      WHERE r.singleton = true AND i.created_at < r.installed_at
        AND COALESCE(
          i.zatca_simplified_xml, i.zatca_simplified_xml_hash,
          i.zatca_simplified_signature, i.zatca_simplified_qr,
          i.zatca_provisional_xml, i.zatca_provisional_xml_hash,
          i.zatca_provisional_signature, i.zatca_provisional_qr,
          i.zatca_cleared_xml, i.zatca_cleared_xml_hash,
          i.zatca_cleared_signature, i.zatca_cleared_qr
        ) IS NOT NULL
    $sql$ INTO v_count;
    INSERT INTO zatca_v2_verification_results VALUES
      ('historical_artifact_population', v_count::text, '0',
        CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);
  ELSE
    INSERT INTO zatca_v2_verification_results VALUES
      ('historical_v2_classification',
        format('runtime_ready=%s;missing_columns=%s', v_runtime_exists AND v_runtime_total = 1 AND v_runtime_count = 1, v_missing),
        'runtime_ready=true;missing_columns=0;classified_rows=0', 'FAIL'),
      ('historical_artifact_population',
        format('runtime_ready=%s;missing_columns=%s', v_runtime_exists AND v_runtime_total = 1 AND v_runtime_count = 1, v_missing),
        'runtime_ready=true;missing_columns=0;artifact_rows=0', 'FAIL');
  END IF;

  FOR v_relation IN
    SELECT * FROM (VALUES
      ('zatca_chain_heads_v2', 'public.zatca_chain_heads_v2'),
      ('zatca_chain_reservations_v2', 'public.zatca_chain_reservations_v2'),
      ('zatca_client_capabilities_v2', 'public.zatca_client_capabilities_v2')
    ) AS expected(check_suffix, relation_name)
  LOOP
    IF to_regclass(v_relation.relation_name) IS NULL THEN
      INSERT INTO zatca_v2_verification_results VALUES
        ('disabled_table_empty_' || v_relation.check_suffix, 'table_missing', '0', 'FAIL');
    ELSE
      EXECUTE format('SELECT count(*) FROM %s', v_relation.relation_name) INTO v_count;
      INSERT INTO zatca_v2_verification_results VALUES
        ('disabled_table_empty_' || v_relation.check_suffix, v_count::text, '0',
          CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END);
    END IF;
  END LOOP;

  -- Protected hosted definitions.
  FOR v_function IN
    SELECT * FROM (VALUES
      ('pos_checkout_hash', 'public.pos_checkout(jsonb)', 'bdc4ee5a02be05aa8b1d7378ebb84c0f'),
      ('snapshot_language_hash', 'public.snapshot_invoice_document_language()', '7f9b093d4a68d315868dadc9ce1f2c58')
    ) AS expected(check_name, signature, expected_hash)
  LOOP
    v_oid := to_regprocedure(v_function.signature)::oid;
    INSERT INTO zatca_v2_verification_results VALUES (
      v_function.check_name,
      CASE WHEN v_oid IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(v_oid)) END,
      v_function.expected_hash,
      CASE WHEN v_oid IS NOT NULL
        AND md5(pg_get_functiondef(v_oid)) = v_function.expected_hash
      THEN 'PASS' ELSE 'FAIL' END
    );
  END LOOP;

  INSERT INTO zatca_v2_verification_results VALUES
    ('no_invoice_calculation_changes',
      'covered by protected pos_checkout hash',
      'pos_checkout_hash PASS',
      CASE WHEN EXISTS (
        SELECT 1 FROM zatca_v2_verification_results
        WHERE check_name = 'pos_checkout_hash' AND result = 'PASS'
      ) THEN 'PASS' ELSE 'FAIL' END),
    ('no_storage_mutation', 'not observable from PostgreSQL package verifier',
      'repository SQL static audit passes', 'REVIEW'),
    ('no_phase6a_mutation', 'not observable from PostgreSQL package verifier',
      'repository SQL static audit passes', 'REVIEW');
END
$verification$;

DO $complete_result_set$
DECLARE
  v_total bigint;
  v_pass bigint;
  v_review bigint;
  v_fail bigint;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE result = 'PASS'),
    count(*) FILTER (WHERE result = 'REVIEW'),
    count(*) FILTER (WHERE result = 'FAIL')
  INTO v_total, v_pass, v_review, v_fail
  FROM zatca_v2_verification_results;

  IF v_total <> 59 OR v_pass <> 54 OR v_review <> 5 OR v_fail <> 0 THEN
    RAISE EXCEPTION
      'VERIFICATION_RESULT_SET_UNEXPECTED:total=%,pass=%,review=%,fail=%',
      v_total, v_pass, v_review, v_fail
      USING HINT = 'Expected exactly 59 named rows: 54 PASS, 5 REVIEW, and 0 FAIL.';
  END IF;
END
$complete_result_set$;

SELECT check_name, observed_value, expected_value, result
FROM zatca_v2_verification_results
ORDER BY CASE result WHEN 'FAIL' THEN 1 WHEN 'REVIEW' THEN 2 ELSE 3 END, check_name;

WITH expected(result, expected_checks) AS (
  VALUES ('FAIL', 0::bigint), ('PASS', 54::bigint), ('REVIEW', 5::bigint)
), observed AS (
  SELECT result, count(*) AS observed_checks
  FROM zatca_v2_verification_results
  GROUP BY result
)
SELECT
  expected.result,
  COALESCE(observed.observed_checks, 0) AS observed_checks,
  expected.expected_checks,
  COALESCE(observed.observed_checks, 0) = expected.expected_checks AS expected_result
FROM expected
LEFT JOIN observed USING (result)
ORDER BY expected.result;

ROLLBACK;
