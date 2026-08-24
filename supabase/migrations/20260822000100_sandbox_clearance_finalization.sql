-- Sandbox-only extension for profile 1100 document classes.
-- Production ZATCA functions, tables, and finalization contracts are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_zatca_sandbox_submission_v2(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID,
  p_invoice_id UUID, p_document_kind TEXT, p_outcome TEXT, p_http_status INTEGER,
  p_response_body JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_document_kind NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Invalid Sandbox document kind' USING ERRCODE = '22023';
  END IF;

  v_result := public.finalize_zatca_sandbox_submission(
    p_reservation_id, p_tenant_id, p_branch_id, p_device_id,
    p_invoice_id, p_outcome, p_http_status, p_response_body
  );

  UPDATE public.zatca_sandbox_submission_reservations
  SET endpoint_kind = CASE WHEN p_document_kind = 'standard' THEN 'clearance' ELSE 'reporting' END,
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND device_id = p_device_id
    AND invoice_id = p_invoice_id;

  IF p_document_kind = 'standard' AND p_outcome = 'accepted' THEN
    UPDATE public.invoices
    SET zatca_status = 'cleared',
        zatca_clearance_response = p_response_body,
        zatca_reporting_response = NULL
    WHERE id = p_invoice_id
      AND tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND zatca_status IN ('reported', 'cleared');

    v_result := jsonb_set(v_result, '{invoice_status}', '"cleared"'::jsonb, true);
  ELSIF p_document_kind = 'standard' AND p_outcome = 'rejected' THEN
    UPDATE public.invoices
    SET zatca_clearance_response = p_response_body,
        zatca_reporting_response = NULL
    WHERE id = p_invoice_id
      AND tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND zatca_status = 'failed';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_zatca_sandbox_submission_v2(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_zatca_sandbox_submission_v2(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER, JSONB) TO service_role;

COMMIT;
