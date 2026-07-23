-- SUPERSEDED by 07_verify_v1_settings_contract.sql. Retained as historical review evidence only.
-- Execute as an authenticated owner/branch user in the SQL editor. The final ROLLBACK
-- guarantees that all RPC write tests are discarded.
BEGIN;

CREATE TEMP TABLE verification_results (
  check_name text,
  observed_value text,
  expected_value text,
  result text CHECK (result IN ('PASS', 'REVIEW'))
) ON COMMIT DROP;

DO $$
DECLARE
  test_branch uuid;
  original_settings jsonb;
  current_settings jsonb;
  response jsonb;
  action text;
  trimmed_address text := '  Verification Address  ';
  unknown_key text := 'verification_unknown_key';
BEGIN
  SELECT b.id, b.presentation_settings INTO test_branch, original_settings
  FROM public.branches b
  JOIN public.user_profiles u ON u.tenant_id = b.tenant_id
   AND ((u.role::text = 'owner') OR (u.role::text = 'branch' AND u.branch_id = b.id))
  WHERE b.is_active AND u.id = auth.uid() AND u.is_active
  ORDER BY b.is_main_branch DESC, b.id
  LIMIT 1;

  INSERT INTO verification_results VALUES ('authorized_test_branch', coalesce(test_branch::text, 'none'), 'one active branch authorized for auth.uid()', CASE WHEN test_branch IS NULL THEN 'REVIEW' ELSE 'PASS' END);
  IF test_branch IS NULL THEN RETURN; END IF;

  SELECT public.get_branch_invoice_settings(test_branch)->'presentation_settings' INTO current_settings;

  FOREACH action IN ARRAY ARRAY['ask','receipt','a4','none'] LOOP
    BEGIN
      response := public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('after_sale_action', action)));
      response := public.get_branch_invoice_settings(test_branch);
      INSERT INTO verification_results VALUES ('after_sale_action_' || action, response->'presentation_settings'->>'after_sale_action', action, CASE WHEN response->'presentation_settings'->>'after_sale_action' = action THEN 'PASS' ELSE 'REVIEW' END);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO verification_results VALUES ('after_sale_action_' || action, SQLERRM, action, 'REVIEW');
    END;
  END LOOP;

  BEGIN
    PERFORM public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('after_sale_action', 'invalid')));
    INSERT INTO verification_results VALUES ('invalid_after_sale_action', 'accepted unexpectedly', 'rejected', 'REVIEW');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('invalid_after_sale_action', SQLSTATE || ': rejected', 'rejected', 'PASS');
  END;

  BEGIN
    response := public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('contact', jsonb_build_object('address_override', trimmed_address, 'show_address', true))));
    response := public.get_branch_invoice_settings(test_branch);
    INSERT INTO verification_results VALUES ('address_override_trimmed', response->'presentation_settings'->'contact'->>'address_override', 'Verification Address', CASE WHEN response->'presentation_settings'->'contact'->>'address_override' = 'Verification Address' THEN 'PASS' ELSE 'REVIEW' END);
    response := public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('contact', jsonb_build_object('address_override', '', 'show_address', true))));
    response := public.get_branch_invoice_settings(test_branch);
    INSERT INTO verification_results VALUES ('address_override_clear', coalesce(response->'presentation_settings'->'contact'->>'address_override', 'null'), 'null or documented fallback', CASE WHEN response->'presentation_settings'->'contact'->>'address_override' IS NULL THEN 'PASS' ELSE 'REVIEW' END);
    INSERT INTO verification_results VALUES ('address_visibility_independent', response->'presentation_settings'->'contact'->>'show_address', 'true', CASE WHEN response->'presentation_settings'->'contact'->>'show_address' = 'true' THEN 'PASS' ELSE 'REVIEW' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('address_override_round_trip', SQLERRM, 'trim/save/clear', 'REVIEW');
  END;

  BEGIN
    current_settings := coalesce(original_settings, public.get_branch_invoice_settings(test_branch)->'presentation_settings');
    current_settings := current_settings || jsonb_build_object(unknown_key, jsonb_build_object('sentinel', true));
    PERFORM public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', current_settings));
    PERFORM public.update_branch_invoice_settings(jsonb_build_object('branch_id', test_branch, 'presentation_settings', jsonb_build_object('after_sale_action', 'a4')));
    response := public.get_branch_invoice_settings(test_branch);
    INSERT INTO verification_results VALUES ('unknown_json_key_preserved', response->'presentation_settings'->unknown_key->>'sentinel', 'true', CASE WHEN response->'presentation_settings'->unknown_key->>'sentinel' = 'true' THEN 'PASS' ELSE 'REVIEW' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verification_results VALUES ('unknown_json_key_preserved', SQLERRM, 'true', 'REVIEW');
  END;
END $$;

INSERT INTO verification_results
SELECT 'rpc_get_exists', count(*)::text, '1', CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_branch_invoice_settings'
  AND pg_get_function_identity_arguments(p.oid) = 'p_branch_id uuid' AND p.prorettype = 'jsonb'::regtype;

INSERT INTO verification_results
SELECT 'rpc_update_exists', count(*)::text, '1', CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_branch_invoice_settings'
  AND pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb' AND p.prorettype = 'jsonb'::regtype;

INSERT INTO verification_results
SELECT 'security_definer_and_search_path', coalesce(p.proconfig::text, 'none'), '{search_path=public}', CASE WHEN p.prosecdef AND p.proconfig @> ARRAY['search_path=public']::text[] THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_branch_invoice_settings' AND pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

INSERT INTO verification_results VALUES ('pos_checkout_hash', md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)), 'bdc4ee5a02be05aa8b1d7378ebb84c0f', CASE WHEN md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) = 'bdc4ee5a02be05aa8b1d7378ebb84c0f' THEN 'PASS' ELSE 'REVIEW' END);
INSERT INTO verification_results VALUES ('snapshot_language_hash', md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)), '7f9b093d4a68d315868dadc9ce1f2c58', CASE WHEN md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)) = '7f9b093d4a68d315868dadc9ce1f2c58' THEN 'PASS' ELSE 'REVIEW' END);
INSERT INTO verification_results SELECT 'identity_snapshot_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='identity_snapshot';
INSERT INTO verification_results SELECT 'compliance_identity_mode_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END FROM information_schema.columns WHERE table_schema='public' AND table_name='branches' AND column_name='compliance_identity_mode';
INSERT INTO verification_results SELECT 'branch_compliance_profiles_absent', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END FROM information_schema.tables WHERE table_schema='public' AND table_name='branch_compliance_profiles';
INSERT INTO verification_results SELECT 'branch_assets_bucket', coalesce((SELECT public FROM storage.buckets WHERE id='branch-assets')::text,'missing'), 'true', CASE WHEN (SELECT public FROM storage.buckets WHERE id='branch-assets') IS TRUE THEN 'PASS' ELSE 'REVIEW' END;
INSERT INTO verification_results SELECT 'branch_assets_size', coalesce((SELECT file_size_limit::text FROM storage.buckets WHERE id='branch-assets'),'missing'), '5242880', CASE WHEN (SELECT file_size_limit FROM storage.buckets WHERE id='branch-assets') = 5242880 THEN 'PASS' ELSE 'REVIEW' END;
INSERT INTO verification_results SELECT 'branch_assets_object_count', count(*)::text, '5', CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'REVIEW' END FROM storage.objects WHERE bucket_id='branch-assets';
INSERT INTO verification_results SELECT 'invoice_count_not_lower', count(*)::text, '>= 2421', CASE WHEN count(*) >= 2421 THEN 'PASS' ELSE 'REVIEW' END FROM public.invoices;
INSERT INTO verification_results VALUES ('cross_tenant_authorization', 'not exercised without a safe inaccessible branch fixture', 'rejected', 'REVIEW');

SELECT check_name, observed_value, expected_value, result FROM verification_results ORDER BY check_name;
ROLLBACK;
