-- Fix get_sales_report_summary_v2 failing with PostgreSQL 42883 because
-- min(uuid) is not a supported aggregate. Keep the established RPC signature,
-- security mode, search_path, row-security setting, scope resolver and ACLs.
DO $fix_sales_report_uuid_aggregate$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.get_sales_report_summary_v2(date,date,uuid)'
  );
  v_definition text;
  v_anchor text := 'min(product_id) AS product_id';
  v_replacement text := 'min(product_id::text)::uuid AS product_id';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'SALES_REPORT_V2_FUNCTION_MISSING';
  END IF;

  v_definition := pg_get_functiondef(v_signature);

  IF v_definition LIKE '%' || v_replacement || '%' THEN
    RETURN;
  END IF;

  IF length(v_definition) - length(replace(v_definition, v_anchor, ''))
      <> length(v_anchor) THEN
    RAISE EXCEPTION 'SALES_REPORT_V2_UUID_AGGREGATE_ANCHOR_UNEXPECTED';
  END IF;

  v_definition := replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_definition;
END
$fix_sales_report_uuid_aggregate$;

COMMENT ON FUNCTION public.get_sales_report_summary_v2(date, date, uuid) IS
  'Package-aware sales report with UUID-safe stable product grouping, base-quantity totals, explicit selling-unit breakdown, and signed returns.';
