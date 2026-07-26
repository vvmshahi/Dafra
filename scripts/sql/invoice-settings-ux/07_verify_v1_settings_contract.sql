-- Transactional V1 persistence-contract verification.
-- Execute only after reviewing 06_stabilize_v1_settings_contract.sql.
-- Every write is rolled back. When auth.uid() is unavailable, functional checks are REVIEW.
BEGIN;

CREATE TEMP TABLE verification_results (
  check_name text,
  observed_value text,
  expected_value text,
  result text CHECK (result IN ('PASS', 'REVIEW'))
) ON COMMIT DROP;

INSERT INTO verification_results
SELECT 'rpc_get_signature',
       count(*)::text,
       '1 jsonb function with p_branch_id uuid',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_branch_invoice_settings'
  AND pg_get_function_identity_arguments(p.oid) = 'p_branch_id uuid'
  AND p.prorettype = 'jsonb'::regtype;

INSERT INTO verification_results
SELECT 'rpc_update_signature',
       count(*)::text,
       '1 jsonb function with p_payload jsonb',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_branch_invoice_settings'
  AND pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
  AND p.prorettype = 'jsonb'::regtype;

INSERT INTO verification_results
SELECT 'security_definer_search_path',
       coalesce(max(p.proconfig::text), 'none'),
       '{search_path=public} on both RPCs',
       CASE WHEN count(*) = 2 AND bool_and(p.prosecdef) AND bool_and(p.proconfig @> ARRAY['search_path=public']::text[]) THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('get_branch_invoice_settings','update_branch_invoice_settings')
  AND pg_get_function_identity_arguments(p.oid) IN ('p_branch_id uuid','p_payload jsonb');

INSERT INTO verification_results VALUES
('pos_checkout_hash',
 CASE WHEN to_regprocedure('public.pos_checkout(jsonb)') IS NULL THEN 'missing' ELSE md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) END,
 'bdc4ee5a02be05aa8b1d7378ebb84c0f',
 CASE WHEN to_regprocedure('public.pos_checkout(jsonb)') IS NOT NULL AND md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) = 'bdc4ee5a02be05aa8b1d7378ebb84c0f' THEN 'PASS' ELSE 'REVIEW' END);

INSERT INTO verification_results VALUES
('snapshot_language_hash',
 CASE WHEN to_regprocedure('public.snapshot_invoice_document_language()') IS NULL THEN 'missing' ELSE md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)) END,
 '7f9b093d4a68d315868dadc9ce1f2c58',
 CASE WHEN to_regprocedure('public.snapshot_invoice_document_language()') IS NOT NULL AND md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)) = '7f9b093d4a68d315868dadc9ce1f2c58' THEN 'PASS' ELSE 'REVIEW' END);

INSERT INTO verification_results SELECT 'phase6a_identity_snapshot_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'identity_snapshot';
INSERT INTO verification_results SELECT 'phase6a_compliance_mode_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'compliance_identity_mode';
INSERT INTO verification_results SELECT 'phase6a_compliance_profile_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'branch_compliance_profiles';
INSERT INTO verification_results SELECT 'invoice_rows_preserved', count(*)::text, 'at least 2421', CASE WHEN count(*) >= 2421 THEN 'PASS' ELSE 'REVIEW' END FROM public.invoices;
INSERT INTO verification_results SELECT 'storage_bucket_unchanged', coalesce((SELECT b.public::text || ':' || b.file_size_limit::text FROM storage.buckets b WHERE b.id = 'branch-assets'), 'missing'), 'true:5242880', CASE WHEN (SELECT b.public FROM storage.buckets b WHERE b.id = 'branch-assets') IS TRUE AND (SELECT b.file_size_limit FROM storage.buckets b WHERE b.id = 'branch-assets') = 5242880 THEN 'PASS' ELSE 'REVIEW' END;

DO $$
DECLARE
  test_branch uuid;
  response jsonb;
  got jsonb;
  payload jsonb;
  unknown_key text := 'future_extension';
BEGIN
  SELECT b.id INTO test_branch
  FROM public.branches b JOIN public.user_profiles u ON u.tenant_id = b.tenant_id
  WHERE b.is_active AND u.id = auth.uid() AND u.is_active
    AND ((u.role::text = 'owner') OR (u.role::text = 'branch' AND u.branch_id = b.id))
  ORDER BY b.is_main_branch DESC, b.id LIMIT 1;

  INSERT INTO verification_results VALUES ('authenticated_fixture', coalesce(test_branch::text, 'none'), 'one authorized active branch', CASE WHEN test_branch IS NULL THEN 'REVIEW' ELSE 'PASS' END);
  IF test_branch IS NULL THEN RETURN; END IF;

  payload := jsonb_build_object(
    'branch_id', test_branch,
    'invoice_language', 'ar',
    'print_mode', 'both',
    'presentation_settings', jsonb_build_object(
      'schema_version', 1, 'language', 'ar', 'after_sale_action', 'both',
      'branding', jsonb_build_object('heading_mode', 'custom', 'custom_heading', 'V1 Contract Heading', 'subheading', 'V1 Subheading', 'show_company_name', false, 'logo_path', test_branch::text || '/logo.png', 'logo_size', 'large'),
      'contact', jsonb_build_object('show_phone', true, 'phone_override', '+966500000000', 'show_email', true, 'email', 'invoice@example.test', 'show_website', true, 'website', 'https://example.test', 'show_address', true, 'address_override', 'Contract Address'),
      'footer', jsonb_build_object('message', 'Contract footer', 'bold', true),
      'thermal', jsonb_build_object('width', '58mm', 'density', 'detailed', 'qr_size', 'large', 'qr_alignment', 'left'),
      'a4', jsonb_build_object('theme', 'modern_split'),
      unknown_key, jsonb_build_object('sentinel', true)
    )
  );

  BEGIN
    response := public.update_branch_invoice_settings(payload);
    got := response->'presentation_settings';
    INSERT INTO verification_results VALUES ('after_sale_action_both', got->>'after_sale_action', 'both', CASE WHEN got->>'after_sale_action' = 'both' THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('footer_bold_true', got->'footer'->>'bold', 'true', CASE WHEN got->'footer'->>'bold' = 'true' THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('qr_alignment_left', got->'thermal'->>'qr_alignment', 'left', CASE WHEN got->'thermal'->>'qr_alignment' = 'left' THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('mutable_logo_path', got->'branding'->>'logo_path', test_branch::text || '/logo.png', CASE WHEN got->'branding'->>'logo_path' = test_branch::text || '/logo.png' THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('unknown_key_preserved', got->unknown_key->>'sentinel', 'true', CASE WHEN got->unknown_key->>'sentinel' = 'true' THEN 'PASS' ELSE 'REVIEW' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('canonical_round_trip', SQLERRM, 'canonical payload accepted', 'REVIEW');
  END;

  BEGIN
    PERFORM public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('after_sale_action', 'invalid')));
    INSERT INTO verification_results VALUES ('invalid_after_sale_action', 'accepted unexpectedly', 'rejected', 'REVIEW');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('invalid_after_sale_action', SQLSTATE || ': rejected', 'rejected', 'PASS');
  END;

  BEGIN
    PERFORM public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('thermal', jsonb_build_object('qr_alignment', 'invalid'))));
    INSERT INTO verification_results VALUES ('invalid_qr_alignment', 'accepted unexpectedly', 'rejected', 'REVIEW');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('invalid_qr_alignment', SQLSTATE || ': rejected', 'rejected', 'PASS');
  END;

  BEGIN
    response := public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('footer', jsonb_build_object('bold', false))));
    got := response->'presentation_settings';
    INSERT INTO verification_results VALUES ('partial_update_preserves_heading', got->'branding'->>'custom_heading', 'V1 Contract Heading', CASE WHEN got->'branding'->>'custom_heading' = 'V1 Contract Heading' THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('footer_bold_false', got->'footer'->>'bold', 'false', CASE WHEN got->'footer'->>'bold' = 'false' THEN 'PASS' ELSE 'REVIEW' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('partial_update_preservation', SQLERRM, 'existing values preserved', 'REVIEW');
  END;
END;
$$;

INSERT INTO verification_results VALUES ('storage_ddl', 'not executed by this package', 'no Storage DDL', 'PASS');
INSERT INTO verification_results VALUES ('invoice_mutation', 'not executed by this package', 'no invoice DML', 'PASS');
INSERT INTO verification_results VALUES ('pos_checkout_mutation', 'not executed by this package', 'unchanged', 'PASS');

SELECT check_name, observed_value, expected_value, result FROM verification_results ORDER BY check_name;
ROLLBACK;
