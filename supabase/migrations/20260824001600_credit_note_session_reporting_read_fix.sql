-- Production hotfix: keep a posted Credit Note in the same reporting/register
-- session as its immutable parent invoice without rewriting either row.
--
-- Generation notes intentionally have no independent POS session. Reporting
-- must resolve their effective session from original_invoice_id instead of
-- silently dropping them from register/dashboard aggregates.

BEGIN;

CREATE OR REPLACE FUNCTION public.reporting_effective_invoice_session_id(
  p_invoice_id uuid,
  p_session_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_parent_session_id uuid;
BEGIN
  IF p_session_id IS NOT NULL THEN
    RETURN p_session_id;
  END IF;

  SELECT parent.session_id
    INTO v_parent_session_id
  FROM public.invoices child
  JOIN public.invoices parent
    ON parent.id = child.original_invoice_id
   AND parent.tenant_id = child.tenant_id
   AND parent.branch_id = child.branch_id
  WHERE child.id = p_invoice_id
    AND child.zatca_invoice_type::text IN ('credit_note', 'debit_note');

  RETURN v_parent_session_id;
END;
$function$;

ALTER FUNCTION public.reporting_effective_invoice_session_id(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reporting_effective_invoice_session_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $patch_register_reporting_session$
DECLARE
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_register_tender_netting(uuid[])'::regprocedure
  ) INTO v_definition;
  v_patched := replace(
    v_definition,
    E'      i.session_id,\n      i.zatca_invoice_type::text AS document_type,',
    E'      public.reporting_effective_invoice_session_id(i.id, i.session_id) AS session_id,\n      i.zatca_invoice_type::text AS document_type,'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'CREDIT_NOTE_SESSION_TENDER_TARGET_NOT_FOUND';
  END IF;
  EXECUTE v_patched;

  SELECT pg_get_functiondef(
    'public.get_register_session_summary_before_refund_netting(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  v_patched := replace(
    v_definition,
    '    JOIN public.invoices i ON i.session_id = s.session_id',
    '    JOIN public.invoices i ON public.reporting_effective_invoice_session_id(i.id, i.session_id) = s.session_id'
  );
  v_patched := replace(
    v_patched,
    '            WHERE i.session_id = rows.session_id',
    '            WHERE public.reporting_effective_invoice_session_id(i.id, i.session_id) = rows.session_id'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'CREDIT_NOTE_SESSION_SUMMARY_TARGET_NOT_FOUND';
  END IF;
  EXECUTE v_patched;

  SELECT pg_get_functiondef(
    'public.get_register_session_summary(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  v_patched := replace(
    v_definition,
    '        WHERE i.session_id = NULLIF(lb.branch_summary ->> ''session_id'', '''')::uuid',
    '        WHERE public.reporting_effective_invoice_session_id(i.id, i.session_id) = NULLIF(lb.branch_summary ->> ''session_id'', '''')::uuid'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'CREDIT_NOTE_SESSION_OVERLAY_TARGET_NOT_FOUND';
  END IF;
  EXECUTE v_patched;
END;
$patch_register_reporting_session$;

COMMENT ON FUNCTION public.reporting_effective_invoice_session_id(uuid, uuid) IS
  'Read-only effective register session for posted notes whose parent owns the POS session.';

COMMIT;
