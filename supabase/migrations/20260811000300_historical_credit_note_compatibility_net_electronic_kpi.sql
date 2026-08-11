-- Stage 6G.5: historical Simplified credit-note eligibility and net electronic KPI.
--
-- Function-only. This migration deliberately does not alter invoices, payment
-- rows, ZATCA artifacts, branch gates, or RLS. The definition hashes make the
-- narrowly reviewed replacements fail closed if an upstream function changed.

BEGIN;
-- A reported Simplified original is eligible for the Atomic credit-note path
-- only when it has either the complete accepted V2 reporting record or the
-- complete legacy reporting record. Legacy records stay immutable and are not
-- backfilled into the V2 model.
CREATE OR REPLACE FUNCTION public.is_authoritatively_reported_simplified_original_v1(
  p_original public.invoices
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_original.id IS NULL
     OR p_original.status::text IS DISTINCT FROM 'posted'
     OR p_original.zatca_invoice_type::text IS DISTINCT FROM 'simplified'
     OR p_original.zatca_status IS DISTINCT FROM 'reported'
     OR p_original.zatca_lifecycle_state = 'reconciliation_required'
     OR p_original.zatca_network_ack_state_v2 = 'reconciliation_required' THEN
    RETURN false;
  END IF;

  -- Current V2 evidence is accepted only when the immutable artifact, the
  -- accepted reporting outbox row, and accepted append-only response evidence
  -- all agree on this exact invoice and artifact hash.
  IF p_original.zatca_finalization_version = 2
     AND p_original.zatca_artifact_provenance = 'server_v2'
     AND p_original.zatca_document_kind = 'simplified'
     AND p_original.zatca_lifecycle_state = 'reported'
     AND p_original.zatca_artifact_stage = 'simplified_final'
     AND NULLIF(BTRIM(p_original.zatca_simplified_xml), '') IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_simplified_xml_hash), '') IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_simplified_signature), '') IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_simplified_qr), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.zatca_reporting_outbox_v2 o
       WHERE o.tenant_id = p_original.tenant_id
         AND o.branch_id = p_original.branch_id
         AND o.invoice_id = p_original.id
         AND o.operation = 'report'
         AND o.status = 'accepted'
         AND o.last_outcome = 'accepted'
         AND o.artifact_hash = p_original.zatca_simplified_xml_hash
     )
     AND EXISTS (
       SELECT 1
       FROM public.zatca_reporting_response_evidence_v2 e
       JOIN public.zatca_reporting_outbox_v2 o ON o.id = e.outbox_id
       WHERE e.tenant_id = p_original.tenant_id
         AND e.branch_id = p_original.branch_id
         AND e.invoice_id = p_original.id
         AND e.classified_outcome = 'accepted'
         AND COALESCE(cardinality(e.error_codes), 0) = 0
         AND o.tenant_id = p_original.tenant_id
         AND o.branch_id = p_original.branch_id
         AND o.invoice_id = p_original.id
         AND o.operation = 'report'
         AND o.status = 'accepted'
         AND o.last_outcome = 'accepted'
         AND o.artifact_hash = p_original.zatca_simplified_xml_hash
     ) THEN
    RETURN true;
  END IF;

  -- Legacy means no V2 lifecycle/provenance/artifact stage. A legacy status
  -- string alone is never enough: require the original signed artifact and a
  -- durable, successful legacy reporting response with an explicit empty error
  -- array. PASS and WARNING are both accepted ZATCA validation outcomes.
  IF p_original.zatca_finalization_version IS NULL
     AND p_original.zatca_artifact_provenance IS NULL
     AND p_original.zatca_lifecycle_state IS NULL
     AND p_original.zatca_artifact_stage IS NULL
     AND p_original.zatca_submitted_at IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_xml), '') IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_xml_hash), '') IS NOT NULL
     AND NULLIF(BTRIM(p_original.zatca_qr_code), '') IS NOT NULL
     AND jsonb_typeof(p_original.zatca_reporting_response) = 'object'
     AND UPPER(COALESCE(p_original.zatca_reporting_response ->> 'reportingStatus', '')) = 'REPORTED'
     AND UPPER(COALESCE(p_original.zatca_reporting_response #>> '{validationResults,status}', ''))
       IN ('PASS', 'WARNING')
     AND (
       CASE
         WHEN jsonb_typeof(p_original.zatca_reporting_response #> '{validationResults,errorMessages}') = 'array'
           THEN jsonb_array_length(p_original.zatca_reporting_response #> '{validationResults,errorMessages}') = 0
         ELSE false
       END
     ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;
ALTER FUNCTION public.is_authoritatively_reported_simplified_original_v1(public.invoices)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_authoritatively_reported_simplified_original_v1(public.invoices)
  FROM PUBLIC, anon, authenticated, service_role;
-- Keep every Atomic preparation rule intact and replace only the original
-- eligibility guard. The exact live definition hash is verified before the
-- replacement, so this can never silently overwrite a later checkout change.
DO $patch_atomic_credit_note_guard$
DECLARE
  v_definition text;
  v_expected_guard text := $old$
    IF v_original.zatca_document_kind IS DISTINCT FROM 'simplified'
       OR v_original.zatca_status IS DISTINCT FROM 'reported' THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_NOTE_REQUIRES_REPORTED_SIMPLIFIED_ORIGINAL';
    END IF;$old$;
  v_replacement_guard text := $new$
    IF NOT public.is_authoritatively_reported_simplified_original_v1(v_original) THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_NOTE_REQUIRES_REPORTED_SIMPLIFIED_ORIGINAL';
    END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.prepare_zatca_atomic_checkout_base_v2(uuid,text,jsonb,text,integer)'::regprocedure
  ) INTO v_definition;

  IF md5(v_definition) IS DISTINCT FROM '451e653564a50ed1eb1aa0c491604db5' THEN
    RAISE EXCEPTION 'ATOMIC_CREDIT_NOTE_GUARD_DEFINITION_DRIFT';
  END IF;
  IF strpos(v_definition, v_expected_guard) = 0 THEN
    RAISE EXCEPTION 'ATOMIC_CREDIT_NOTE_GUARD_NOT_FOUND';
  END IF;

  EXECUTE replace(v_definition, v_expected_guard, v_replacement_guard);
END
$patch_atomic_credit_note_guard$;
ALTER FUNCTION public.prepare_zatca_atomic_checkout_base_v2(
  uuid, text, jsonb, text, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_zatca_atomic_checkout_base_v2(
  uuid, text, jsonb, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_zatca_atomic_checkout_base_v2(
  uuid, text, jsonb, text, integer
) TO service_role;
-- Preserve totalCard/card_total for existing consumers and add a separate
-- net-electronic field. Payment rows already mirror credit-note movements, so
-- no payment_refunds join is needed or permitted here.
DO $patch_dashboard_net_electronic$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_dashboard_summary(uuid,date,date)'::regprocedure
  ) INTO v_definition;
  IF md5(v_definition) IS DISTINCT FROM 'af77e4a7c317fbdad1ee945888dfedd6' THEN
    RAISE EXCEPTION 'DASHBOARD_SUMMARY_DEFINITION_DRIFT';
  END IF;

  v_old := $old$
  v_total_card NUMERIC := 0;
  v_total_vat NUMERIC := 0;$old$;
  v_new := $new$
  v_total_card NUMERIC := 0;
  v_total_net_electronic NUMERIC := 0;
  v_total_vat NUMERIC := 0;$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_VARIABLES_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card$old$;
  v_new := $new$
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method IN ('card', 'bank_transfer') THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card, v_total_net_electronic$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_TOTALS_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
      END), 0) AS card_total
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
    GROUP BY inv.branch_id$old$;
  v_new := $new$
      END), 0) AS card_total,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.invoice_payment_method, 'other') IN ('card', 'bank_transfer')
          THEN CASE
            WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
            ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
          END
        ELSE 0
      END), 0) AS net_electronic_total
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
    GROUP BY inv.branch_id$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_BRANCH_TOTALS_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
      COALESCE(bpt.cash_total, 0) AS cash_total,
      COALESCE(bpt.card_total, 0) AS card_total,
      os.opened_at IS NOT NULL AS session_open,$old$;
  v_new := $new$
      COALESCE(bpt.cash_total, 0) AS cash_total,
      COALESCE(bpt.card_total, 0) AS card_total,
      COALESCE(bpt.net_electronic_total, 0) AS net_electronic_total,
      os.opened_at IS NOT NULL AS session_open,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_BRANCH_ROWS_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
      'todayCard', card_total,
      'card_total', card_total,
      'sessionOpen', session_open,$old$;
  v_new := $new$
      'todayCard', card_total,
      'card_total', card_total,
      'todayNetElectronic', net_electronic_total,
      'net_electronic_total', net_electronic_total,
      'sessionOpen', session_open,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_BRANCH_JSON_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
    'totalCard', v_total_card,
    'card_total', v_total_card,
    'totalVat', v_total_vat,$old$;
  v_new := $new$
    'totalCard', v_total_card,
    'card_total', v_total_card,
    'totalNetElectronic', v_total_net_electronic,
    'net_electronic_total', v_total_net_electronic,
    'totalVat', v_total_vat,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'DASHBOARD_SUMMARY_RETURN_JSON_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  EXECUTE v_definition;
END
$patch_dashboard_net_electronic$;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid, date, date) TO authenticated;
COMMENT ON FUNCTION public.get_dashboard_summary(uuid, date, date) IS
  'Dashboard KPI summary using direct posted invoice/payment/expense aggregation. Credit notes are signed negative; cash is cash-only and net electronic is signed card plus bank-transfer payment rows.';
DO $patch_register_net_electronic$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_register_session_summary(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  IF md5(v_definition) IS DISTINCT FROM '1b58776280e1bdaac3d51d8e8937732d' THEN
    RAISE EXCEPTION 'REGISTER_SESSION_SUMMARY_DEFINITION_DRIFT';
  END IF;

  v_old := $old$
      COALESCE(SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN method = 'bank_transfer' THEN signed_amount ELSE 0 END), 0) AS bank_transfer_total,$old$;
  v_new := $new$
      COALESCE(SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN method IN ('card', 'bank_transfer') THEN signed_amount ELSE 0 END), 0) AS net_electronic_total,
      COALESCE(SUM(CASE WHEN method = 'bank_transfer' THEN signed_amount ELSE 0 END), 0) AS bank_transfer_total,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'REGISTER_SESSION_PAYMENT_TOTALS_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
      COALESCE(pt.cash_total, 0) AS cash_total,
      COALESCE(pt.card_total, 0) AS card_total,
      COALESCE(pt.bank_transfer_total, 0) AS bank_transfer_total,$old$;
  v_new := $new$
      COALESCE(pt.cash_total, 0) AS cash_total,
      COALESCE(pt.card_total, 0) AS card_total,
      COALESCE(pt.net_electronic_total, 0) AS net_electronic_total,
      COALESCE(pt.bank_transfer_total, 0) AS bank_transfer_total,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'REGISTER_SESSION_ROWS_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
        'card_total', card_total,
        'cardTotal', card_total,
        'other_total', other_total,$old$;
  v_new := $new$
        'card_total', card_total,
        'cardTotal', card_total,
        'net_electronic_total', net_electronic_total,
        'netElectronicTotal', net_electronic_total,
        'other_total', other_total,$new$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'REGISTER_SESSION_JSON_NOT_FOUND'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  EXECUTE v_definition;
END
$patch_register_net_electronic$;
REVOKE ALL ON FUNCTION public.get_register_session_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_session_summary(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.get_register_session_summary(uuid, uuid) IS
  'Register Session summary using signed posted invoice payment rows. Cash is cash-only and net electronic is signed card plus bank-transfer payment rows.';
NOTIFY pgrst, 'reload schema';
COMMIT;
