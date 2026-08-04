-- Payload-compatibility hardening for the already deployed AR RPC surface.
--
-- This migration is additive: it neither reads nor rewrites business rows. Each
-- original implementation remains security-definer internal code, while the
-- public function of the same signature catches only PostgreSQL conversion
-- errors (malformed UUID/date/number/boolean input) and emits the existing
-- stable AR validation vocabulary. A PL/pgSQL exception block is transactional,
-- so an invalid payload cannot retain a partially-created AR record.

ALTER FUNCTION public.set_customer_credit_policy_v1(jsonb) RENAME TO set_customer_credit_policy_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.set_customer_credit_policy_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.set_customer_credit_policy_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb) RENAME TO post_customer_credit_checkout_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.post_customer_credit_checkout_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.post_customer_credit_checkout_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.record_customer_payment_receipt_v1(jsonb) RENAME TO record_customer_payment_receipt_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.record_customer_payment_receipt_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.record_customer_payment_receipt_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_RECEIPT_VALUE_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.create_customer_credit_note_settlement_v1(jsonb) RENAME TO create_customer_credit_note_settlement_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.create_customer_credit_note_settlement_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.create_customer_credit_note_settlement_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CREDIT_NOTE_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.reverse_customer_payment_receipt_v1(jsonb) RENAME TO reverse_customer_payment_receipt_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.reverse_customer_payment_receipt_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.reverse_customer_payment_receipt_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_REVERSAL_FIELDS_REQUIRED' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.get_customer_receivable_workspace_v1(jsonb) RENAME TO get_customer_receivable_workspace_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.get_customer_receivable_workspace_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.get_customer_receivable_workspace_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_WORKSPACE_FILTER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.reallocate_customer_payment_v1(jsonb) RENAME TO reallocate_customer_payment_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.reallocate_customer_payment_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.reallocate_customer_payment_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_REALLOCATION_PAYLOAD_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.post_customer_receivable_adjustment_v1(jsonb) RENAME TO post_customer_receivable_adjustment_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.post_customer_receivable_adjustment_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.post_customer_receivable_adjustment_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_ADJUSTMENT_PAYLOAD_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.link_customer_receivable_account_v1(jsonb) RENAME TO link_customer_receivable_account_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.link_customer_receivable_account_v1(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.link_customer_receivable_account_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_ACCOUNT_LINK_PAYLOAD_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.get_customer_receivables_report_v1(jsonb) RENAME TO get_customer_receivables_report_v1_raw_20260803;
CREATE OR REPLACE FUNCTION public.get_customer_receivables_report_v1(p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $function$
BEGIN
  RETURN public.get_customer_receivables_report_v1_raw_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_REPORT_FILTER_INVALID' USING ERRCODE = '22023';
END
$function$;

DO $ownership$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'set_customer_credit_policy_v1', 'post_customer_credit_checkout_v1',
    'record_customer_payment_receipt_v1', 'create_customer_credit_note_settlement_v1',
    'reverse_customer_payment_receipt_v1', 'get_customer_receivable_workspace_v1',
    'reallocate_customer_payment_v1', 'post_customer_receivable_adjustment_v1',
    'link_customer_receivable_account_v1', 'get_customer_receivables_report_v1'
  ] LOOP
    EXECUTE format('ALTER FUNCTION public.%I(jsonb) OWNER TO postgres', v_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(jsonb) FROM PUBLIC, anon', v_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(jsonb) TO authenticated', v_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(jsonb) FROM PUBLIC, anon, authenticated, service_role', v_name || '_raw_20260803');
  END LOOP;
END
$ownership$;
