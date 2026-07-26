-- ZATCA Phase 2 immutable finalization v2
-- 04_lock_compliance_fields.sql
-- Browser ownership denial plus lifecycle-aware server immutability.

BEGIN;

-- Hosted preflight must be reviewed before this migration. If either legacy
-- policy still exists, accept only the exact historical QR-backfill contract:
-- permissive UPDATE, authenticated only, branch access, NULL QR, non-cancelled.
-- A reused name or altered predicate is a hard stop rather than a silent drop.
DO $policy_contract$
DECLARE
  v_policy record;
  v_authenticated oid := to_regrole('authenticated')::oid;
  v_using text;
  v_check text;
BEGIN
  IF v_authenticated IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_ROLE_MISSING:authenticated';
  END IF;

  FOR v_policy IN
    SELECT p.*
    FROM pg_policy p
    WHERE p.polrelid = 'public.invoices'::regclass
      AND p.polname IN (
        'phase3a_invoices_qr_backfill_update',
        'invoices_qr_backfill_update'
      )
  LOOP
    v_using := replace(replace(
      regexp_replace(lower(pg_get_expr(v_policy.polqual, v_policy.polrelid)),
        '[[:space:]"()]', '', 'g'),
      'public.', ''), '::text', '');
    v_check := replace(replace(
      regexp_replace(lower(pg_get_expr(v_policy.polwithcheck, v_policy.polrelid)),
        '[[:space:]"()]', '', 'g'),
      'public.', ''), '::text', '');

    IF v_policy.polpermissive IS DISTINCT FROM true
       OR v_policy.polcmd IS DISTINCT FROM 'w'
       OR v_policy.polroles IS DISTINCT FROM ARRAY[v_authenticated]::oid[]
       OR v_using IS DISTINCT FROM 'rls_can_access_branch(tenant_id,branch_id)andzatca_qr_codeisnullandstatus<>''cancelled'''
       OR v_check IS DISTINCT FROM 'rls_can_access_branch(tenant_id,branch_id)andstatus<>''cancelled''' THEN
      RAISE EXCEPTION 'POLICY_DEFINITION_DRIFT:%', v_policy.polname
        USING DETAIL = format(
          'permissive=%s command=%s roles=%s using=%s with_check=%s',
          v_policy.polpermissive, v_policy.polcmd, v_policy.polroles,
          pg_get_expr(v_policy.polqual, v_policy.polrelid),
          pg_get_expr(v_policy.polwithcheck, v_policy.polrelid)
        ),
        HINT = 'Stop. Compare 00_hosted_preflight.sql with the reviewed legacy policy contract.';
    END IF;
  END LOOP;
END
$policy_contract$;

DROP POLICY IF EXISTS phase3a_invoices_qr_backfill_update ON public.invoices;
DROP POLICY IF EXISTS invoices_qr_backfill_update ON public.invoices;

-- Expected pre-04 grants are either the current locked-down state (no browser
-- UPDATE) or the historical authenticated UPDATE(zatca_qr_code) grant only.
-- anon has no invoice UPDATE grant; service_role retains its existing trusted
-- table access. Reject broader hosted grants before revoking the named columns.
DO $privilege_contract$
DECLARE
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
  v_browser_grants text[];
BEGIN
  IF has_table_privilege('anon', 'public.invoices', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.invoices', 'UPDATE') THEN
    RAISE EXCEPTION 'UNEXPECTED_BROWSER_INVOICE_TABLE_UPDATE_GRANT'
      USING HINT = 'Stop. Review 00_hosted_preflight.sql; 04 revokes only named compliance columns.';
  END IF;

  SELECT COALESCE(array_agg(grantee || '.' || column_name ORDER BY grantee, column_name), ARRAY[]::text[])
  INTO v_browser_grants
  FROM information_schema.role_column_grants
  WHERE table_schema = 'public'
    AND table_name = 'invoices'
    AND privilege_type = 'UPDATE'
    AND grantee IN ('anon', 'authenticated')
    AND column_name = ANY(v_protected_columns);

  IF v_browser_grants <> ARRAY[]::text[]
     AND v_browser_grants <> ARRAY['authenticated.zatca_qr_code']::text[] THEN
    RAISE EXCEPTION 'UNEXPECTED_BROWSER_COMPLIANCE_UPDATE_GRANTS:%', v_browser_grants
      USING HINT = 'Stop. Review and resolve hosted privilege drift explicitly.';
  END IF;
END
$privilege_contract$;

REVOKE UPDATE (
  zatca_qr_code, zatca_xml, zatca_xml_hash, zatca_signature,
  zatca_uuid, zatca_counter_number, zatca_prev_invoice_hash,
  zatca_finalization_version, zatca_artifact_provenance,
  zatca_document_kind, zatca_lifecycle_state, zatca_artifact_stage,
  zatca_finalized_at_v2, zatca_finalization_error_v2,
  zatca_simplified_xml, zatca_simplified_xml_hash,
  zatca_simplified_signature, zatca_simplified_qr,
  zatca_provisional_xml, zatca_provisional_xml_hash,
  zatca_provisional_signature, zatca_provisional_qr,
  zatca_cleared_xml, zatca_cleared_xml_hash,
  zatca_cleared_signature, zatca_cleared_qr,
  zatca_clearance_metadata_v2, zatca_network_response_v2,
  zatca_finalization_claim_token_v2, zatca_finalization_claimed_at_v2,
  zatca_finalization_lease_expires_at_v2, zatca_finalization_claimed_by_v2,
  zatca_finalization_attempt_v2, zatca_network_claim_token_v2,
  zatca_network_claimed_at_v2, zatca_network_lease_expires_at_v2,
  zatca_network_claimed_by_v2, zatca_network_operation_v2,
  zatca_network_attempt_v2, zatca_network_idempotency_key_v2,
  zatca_network_request_hash_v2, zatca_network_request_started_at_v2,
  zatca_network_ack_state_v2, zatca_reconciliation_reason_v2
) ON TABLE public.invoices FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.assert_zatca_compliance_write_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_server boolean := v_role IN ('service_role', 'supabase_admin')
    OR current_user IN ('postgres', 'supabase_admin')
    OR session_user IN ('postgres', 'supabase_admin');
  v_protected_changed boolean;
BEGIN
  v_protected_changed :=
    NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
    OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
    OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
    OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature
    OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
    OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
    OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    OR NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
    OR NEW.zatca_artifact_provenance IS DISTINCT FROM OLD.zatca_artifact_provenance
    OR NEW.zatca_document_kind IS DISTINCT FROM OLD.zatca_document_kind
    OR NEW.zatca_lifecycle_state IS DISTINCT FROM OLD.zatca_lifecycle_state
    OR NEW.zatca_artifact_stage IS DISTINCT FROM OLD.zatca_artifact_stage
    OR NEW.zatca_finalized_at_v2 IS DISTINCT FROM OLD.zatca_finalized_at_v2
    OR NEW.zatca_simplified_xml IS DISTINCT FROM OLD.zatca_simplified_xml
    OR NEW.zatca_simplified_xml_hash IS DISTINCT FROM OLD.zatca_simplified_xml_hash
    OR NEW.zatca_simplified_signature IS DISTINCT FROM OLD.zatca_simplified_signature
    OR NEW.zatca_simplified_qr IS DISTINCT FROM OLD.zatca_simplified_qr
    OR NEW.zatca_provisional_xml IS DISTINCT FROM OLD.zatca_provisional_xml
    OR NEW.zatca_provisional_xml_hash IS DISTINCT FROM OLD.zatca_provisional_xml_hash
    OR NEW.zatca_provisional_signature IS DISTINCT FROM OLD.zatca_provisional_signature
    OR NEW.zatca_provisional_qr IS DISTINCT FROM OLD.zatca_provisional_qr
    OR NEW.zatca_cleared_xml IS DISTINCT FROM OLD.zatca_cleared_xml
    OR NEW.zatca_cleared_xml_hash IS DISTINCT FROM OLD.zatca_cleared_xml_hash
    OR NEW.zatca_cleared_signature IS DISTINCT FROM OLD.zatca_cleared_signature
    OR NEW.zatca_cleared_qr IS DISTINCT FROM OLD.zatca_cleared_qr
    OR NEW.zatca_clearance_metadata_v2 IS DISTINCT FROM OLD.zatca_clearance_metadata_v2
    OR NEW.zatca_finalization_claim_token_v2 IS DISTINCT FROM OLD.zatca_finalization_claim_token_v2
    OR NEW.zatca_finalization_claimed_at_v2 IS DISTINCT FROM OLD.zatca_finalization_claimed_at_v2
    OR NEW.zatca_finalization_lease_expires_at_v2 IS DISTINCT FROM OLD.zatca_finalization_lease_expires_at_v2
    OR NEW.zatca_finalization_claimed_by_v2 IS DISTINCT FROM OLD.zatca_finalization_claimed_by_v2
    OR NEW.zatca_finalization_attempt_v2 IS DISTINCT FROM OLD.zatca_finalization_attempt_v2
    OR NEW.zatca_network_claim_token_v2 IS DISTINCT FROM OLD.zatca_network_claim_token_v2
    OR NEW.zatca_network_claimed_at_v2 IS DISTINCT FROM OLD.zatca_network_claimed_at_v2
    OR NEW.zatca_network_lease_expires_at_v2 IS DISTINCT FROM OLD.zatca_network_lease_expires_at_v2
    OR NEW.zatca_network_claimed_by_v2 IS DISTINCT FROM OLD.zatca_network_claimed_by_v2
    OR NEW.zatca_network_operation_v2 IS DISTINCT FROM OLD.zatca_network_operation_v2
    OR NEW.zatca_network_attempt_v2 IS DISTINCT FROM OLD.zatca_network_attempt_v2
    OR NEW.zatca_network_idempotency_key_v2 IS DISTINCT FROM OLD.zatca_network_idempotency_key_v2
    OR NEW.zatca_network_request_hash_v2 IS DISTINCT FROM OLD.zatca_network_request_hash_v2
    OR NEW.zatca_network_request_started_at_v2 IS DISTINCT FROM OLD.zatca_network_request_started_at_v2
    OR NEW.zatca_network_ack_state_v2 IS DISTINCT FROM OLD.zatca_network_ack_state_v2
    OR NEW.zatca_reconciliation_reason_v2 IS DISTINCT FROM OLD.zatca_reconciliation_reason_v2;

  IF NOT v_server AND v_protected_changed THEN
    RAISE EXCEPTION 'ZATCA compliance fields are server-owned' USING ERRCODE = '42501';
  END IF;

  IF v_server AND OLD.zatca_finalization_version = 2 THEN
    -- The v2 path never writes the ambiguous legacy artifact columns. They are
    -- retained only so disabled old-code deployments remain additive.
    IF NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
       OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
       OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
       OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature THEN
      RAISE EXCEPTION 'V2 invoices cannot use legacy artifact columns' USING ERRCODE = '55000';
    END IF;

    IF NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
       OR NEW.zatca_artifact_provenance IS DISTINCT FROM OLD.zatca_artifact_provenance
       OR NEW.zatca_document_kind IS DISTINCT FROM OLD.zatca_document_kind
       OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid THEN
      RAISE EXCEPTION 'V2 invoice identity/provenance is immutable' USING ERRCODE = '55000';
    END IF;

    IF (OLD.zatca_artifact_stage, NEW.zatca_artifact_stage) NOT IN (
      ('none', 'none'), ('none', 'simplified_final'), ('none', 'standard_provisional'),
      ('simplified_final', 'simplified_final'),
      ('standard_provisional', 'standard_provisional'),
      ('standard_provisional', 'standard_cleared'),
      ('standard_cleared', 'standard_cleared')
    ) THEN
      RAISE EXCEPTION 'Illegal ZATCA artifact-stage transition' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage = 'simplified_final' AND (
      NEW.zatca_simplified_xml IS DISTINCT FROM OLD.zatca_simplified_xml
      OR NEW.zatca_simplified_xml_hash IS DISTINCT FROM OLD.zatca_simplified_xml_hash
      OR NEW.zatca_simplified_signature IS DISTINCT FROM OLD.zatca_simplified_signature
      OR NEW.zatca_simplified_qr IS DISTINCT FROM OLD.zatca_simplified_qr
      OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
      OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    ) THEN
      RAISE EXCEPTION 'Simplified final artifact is immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage IN ('standard_provisional', 'standard_cleared') AND (
      NEW.zatca_provisional_xml IS DISTINCT FROM OLD.zatca_provisional_xml
      OR NEW.zatca_provisional_xml_hash IS DISTINCT FROM OLD.zatca_provisional_xml_hash
      OR NEW.zatca_provisional_signature IS DISTINCT FROM OLD.zatca_provisional_signature
      OR NEW.zatca_provisional_qr IS DISTINCT FROM OLD.zatca_provisional_qr
      OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
      OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    ) THEN
      RAISE EXCEPTION 'Standard provisional request artifact is immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage = 'standard_cleared' AND (
      NEW.zatca_cleared_xml IS DISTINCT FROM OLD.zatca_cleared_xml
      OR NEW.zatca_cleared_xml_hash IS DISTINCT FROM OLD.zatca_cleared_xml_hash
      OR NEW.zatca_cleared_signature IS DISTINCT FROM OLD.zatca_cleared_signature
      OR NEW.zatca_cleared_qr IS DISTINCT FROM OLD.zatca_cleared_qr
      OR NEW.zatca_clearance_metadata_v2 IS DISTINCT FROM OLD.zatca_clearance_metadata_v2
    ) THEN
      RAISE EXCEPTION 'Standard cleared artifact is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_zatca_compliance_write_v2() FROM PUBLIC, anon, authenticated;

-- Replace the unsafe v1 guard if it was installed in a non-production review DB.
DROP TRIGGER IF EXISTS invoices_zatca_compliance_write_guard ON public.invoices;
DROP TRIGGER IF EXISTS invoices_zatca_compliance_write_guard_v2 ON public.invoices;
CREATE TRIGGER invoices_zatca_compliance_write_guard_v2
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.assert_zatca_compliance_write_v2();

COMMIT;
