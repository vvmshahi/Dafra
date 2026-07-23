-- SUPERSEDED / UNSAFE / DO NOT EXECUTE. See ../zatca-phase2-finalization-v2/.
-- Phase 2 compliance-field ownership lock.
-- Execute only after 01_add_finalization_state.sql has been reviewed.
-- This file is intentionally not executed by the repository.

BEGIN;

-- Remove the legacy browser QR backfill route. Existing objects are preserved.
DROP POLICY IF EXISTS phase3a_invoices_qr_backfill_update ON public.invoices;

REVOKE UPDATE (
  zatca_qr_code,
  zatca_xml,
  zatca_xml_hash,
  zatca_signature,
  zatca_uuid,
  zatca_counter_number,
  zatca_prev_invoice_hash,
  zatca_finalization_status,
  zatca_finalized_at,
  zatca_finalization_error,
  zatca_finalization_version
) ON TABLE public.invoices FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.assert_zatca_compliance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_server boolean := v_role IN ('service_role', 'supabase_admin')
    OR session_user IN ('postgres', 'supabase_admin');
BEGIN
  -- A finalized document is immutable even to later server status updates.
  IF OLD.zatca_finalization_status = 'finalized'::public.zatca_finalization_status
     AND (
       NEW.zatca_finalization_status IS DISTINCT FROM OLD.zatca_finalization_status
       OR NEW.zatca_finalized_at IS DISTINCT FROM OLD.zatca_finalized_at
       OR NEW.zatca_finalization_error IS DISTINCT FROM OLD.zatca_finalization_error
       OR NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
       OR NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
       OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
       OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
       OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature
       OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
       OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
       OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
     ) THEN
    RAISE EXCEPTION 'Finalized ZATCA compliance values are immutable' USING ERRCODE = '55000';
  END IF;

  -- No caller may mark a row finalized without all four final values.
  IF NEW.zatca_finalization_status = 'finalized'::public.zatca_finalization_status
     AND (
       NULLIF(BTRIM(NEW.zatca_qr_code), '') IS NULL
       OR NULLIF(BTRIM(NEW.zatca_xml), '') IS NULL
       OR NULLIF(BTRIM(NEW.zatca_xml_hash), '') IS NULL
       OR NULLIF(BTRIM(NEW.zatca_signature), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'A ZATCA document cannot be finalized without XML, hash, signature, and QR' USING ERRCODE = '23514';
  END IF;

  IF NOT v_server AND (
       NEW.zatca_finalization_status IS DISTINCT FROM OLD.zatca_finalization_status
       OR NEW.zatca_finalized_at IS DISTINCT FROM OLD.zatca_finalized_at
       OR NEW.zatca_finalization_error IS DISTINCT FROM OLD.zatca_finalization_error
       OR NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
       OR NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
       OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
       OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
       OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature
       OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
       OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
       OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
     ) THEN
    RAISE EXCEPTION 'ZATCA compliance fields are server-owned' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_zatca_compliance_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS invoices_zatca_compliance_write_guard ON public.invoices;
CREATE TRIGGER invoices_zatca_compliance_write_guard
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.assert_zatca_compliance_write();

COMMIT;
