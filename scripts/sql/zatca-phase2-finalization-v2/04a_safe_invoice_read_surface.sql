-- ZATCA Phase 2 immutable finalization v2
-- 04a_safe_invoice_read_surface.sql
-- Replace browser table-wide invoice SELECT with an explicit safe allowlist.
-- RLS policies and invoice rows are intentionally unchanged.

BEGIN;

DO $invoice_read_contract$
DECLARE
  v_safe_columns constant text[] := ARRAY[
    'id', 'tenant_id', 'branch_id', 'customer_id', 'created_by',
    'invoice_number', 'invoice_reference', 'zatca_invoice_type',
    'zatca_status', 'zatca_submitted_at', 'subtotal', 'discount_amount',
    'taxable_amount', 'tax_amount', 'total_amount', 'currency_code',
    'invoice_date', 'supply_date', 'due_date', 'status', 'payment_status',
    'notes', 'notes_ar', 'cancelled_at', 'cancellation_reason',
    'created_at', 'updated_at', 'session_id', 'payment_method',
    'original_invoice_id', 'credit_reason', 'document_language'
  ];
  v_server_only_columns constant text[] := ARRAY[
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
  v_reviewed_legacy_columns constant text[] := ARRAY[
    'checkout_idempotency_key', 'credit_note_idempotency_key',
    'zatca_clearance_status', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_qr_code', 'zatca_submission_id',
    'zatca_type_code', 'zatca_uuid', 'zatca_warnings', 'zatca_xml_hash'
  ];
  v_missing text[];
  v_unsafe_grants text[];
  v_count bigint;
  v_table_select boolean;
  v_column_list text;
BEGIN
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_SUPABASE_ROLE_MISSING'
      USING HINT = 'Stop. This patch requires anon, authenticated, and service_role.';
  END IF;

  IF to_regclass('public.invoices') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_TABLE_MISSING:public.invoices';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass) THEN
    RAISE EXCEPTION 'INVOICE_RLS_NOT_ENABLED'
      USING HINT = 'Stop. This grant patch assumes the existing invoice RLS policies remain authoritative.';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM unnest(v_safe_columns || v_server_only_columns) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attname = required.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
  );
  IF COALESCE(cardinality(v_missing), 0) <> 0 THEN
    RAISE EXCEPTION 'INVOICE_READ_CONTRACT_COLUMNS_MISSING:%', v_missing
      USING HINT = 'Apply this file only after 01-04 and resolve schema drift explicitly.';
  END IF;

  -- PUBLIC is a pseudo-role (ACL grantee 0), so inspect relation and column
  -- ACLs directly instead of pretending it is a pg_roles row.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid = 'public.invoices'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type = 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND acl.grantee = 0
      AND acl.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_PUBLIC_INVOICE_SELECT_GRANT'
      USING HINT = 'Stop. Resolve PUBLIC privilege drift before applying the reviewed browser allowlist.';
  END IF;

  SELECT has_table_privilege('anon', 'public.invoices', 'SELECT') INTO v_table_select;
  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('anon', 'public.invoices', a.attname, 'SELECT');
  IF v_table_select OR v_count <> 0 THEN
    RAISE EXCEPTION 'UNEXPECTED_ANON_INVOICE_SELECT_GRANT:table=%,columns=%', v_table_select, v_count
      USING HINT = 'Stop. The reviewed hosted contract gives anon no invoice read privilege.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.invoices', 'SELECT') THEN
    RAISE EXCEPTION 'SERVICE_ROLE_INVOICE_TABLE_SELECT_MISSING'
      USING HINT = 'Stop. The service-role compliance path must retain table-wide invoice reads.';
  END IF;

  SELECT has_table_privilege('authenticated', 'public.invoices', 'SELECT') INTO v_table_select;
  IF NOT v_table_select THEN
    SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing
    FROM unnest(v_safe_columns) required(column_name)
    WHERE NOT has_column_privilege(
      'authenticated', 'public.invoices', required.column_name, 'SELECT'
    );
    IF COALESCE(cardinality(v_missing), 0) <> 0
       AND v_missing IS DISTINCT FROM ARRAY['document_language']::text[] THEN
      RAISE EXCEPTION 'UNEXPECTED_AUTHENTICATED_INVOICE_SELECT_STATE:safe_missing=%', v_missing
        USING HINT = 'Expected table-wide legacy access, the complete 04a allowlist, or the reviewed pre-04a allowlist missing only document_language.';
    END IF;

    SELECT array_agg(a.attname ORDER BY a.attname)
    INTO v_unsafe_grants
    FROM pg_attribute a
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT (a.attname = ANY(v_safe_columns))
      AND has_column_privilege('authenticated', 'public.invoices', a.attname, 'SELECT');
    IF COALESCE(cardinality(v_unsafe_grants), 0) <> 0
       AND v_unsafe_grants IS DISTINCT FROM v_reviewed_legacy_columns THEN
      RAISE EXCEPTION 'UNEXPECTED_AUTHENTICATED_UNSAFE_COLUMN_GRANTS:%', v_unsafe_grants
        USING HINT = 'Expected no unsafe column grants or the exact reviewed legacy set that this migration revokes.';
    END IF;
  END IF;

  -- Removing the table grant is what makes column privileges authoritative.
  -- The named server-only revoke also clears any historical direct grants.
  REVOKE SELECT ON TABLE public.invoices FROM authenticated, anon;

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinality)
  INTO v_column_list
  FROM unnest(v_server_only_columns) WITH ORDINALITY columns(column_name, ordinality);
  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.invoices FROM authenticated, anon',
    v_column_list
  );

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinality)
  INTO v_column_list
  FROM unnest(v_safe_columns) WITH ORDINALITY columns(column_name, ordinality);
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.invoices TO authenticated',
    v_column_list
  );

  IF has_table_privilege('authenticated', 'public.invoices', 'SELECT')
     OR has_table_privilege('anon', 'public.invoices', 'SELECT') THEN
    RAISE EXCEPTION 'BROWSER_INVOICE_TABLE_SELECT_REMAINS'
      USING HINT = 'An inherited or PUBLIC table grant remains; the transaction will roll back.';
  END IF;

  SELECT count(*) INTO v_count
  FROM unnest(v_safe_columns) required(column_name)
  WHERE NOT has_column_privilege(
    'authenticated', 'public.invoices', required.column_name, 'SELECT'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AUTHENTICATED_SAFE_INVOICE_COLUMNS_MISSING:%', v_count;
  END IF;

  -- This intentionally covers all non-safe current and future columns, not
  -- only the known raw-v2 list. Adding a column never expands browser access.
  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT (a.attname = ANY(v_safe_columns))
    AND has_column_privilege('authenticated', 'public.invoices', a.attname, 'SELECT');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AUTHENTICATED_NON_SAFE_INVOICE_COLUMNS_REMAIN:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('anon', 'public.invoices', a.attname, 'SELECT');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ANON_INVOICE_COLUMNS_REMAIN:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT has_column_privilege('service_role', 'public.invoices', a.attname, 'SELECT');
  IF NOT has_table_privilege('service_role', 'public.invoices', 'SELECT') OR v_count <> 0 THEN
    RAISE EXCEPTION 'SERVICE_ROLE_INVOICE_READ_CONTRACT_BROKEN:missing_columns=%', v_count;
  END IF;
END
$invoice_read_contract$;

COMMIT;
