-- SUPERSEDED / UNSAFE / DO NOT EXECUTE. See ../zatca-phase2-finalization-v2/.
-- Transactional verification for the Phase 2 finalization contract.
-- This file is SELECT-only against persistent data. It ends with ROLLBACK.

BEGIN;

CREATE TEMP TABLE verification_results (
  check_name text,
  observed_value text,
  expected_value text,
  result text CHECK (result IN ('PASS', 'REVIEW'))
) ON COMMIT DROP;

INSERT INTO verification_results
SELECT 'finalization_type',
       CASE WHEN to_regtype('public.zatca_finalization_status') IS NULL THEN 'missing'
            ELSE 'present' END,
       'present',
       CASE WHEN to_regtype('public.zatca_finalization_status') IS NOT NULL THEN 'PASS' ELSE 'REVIEW' END;

INSERT INTO verification_results
SELECT 'finalization_enum_values',
       COALESCE((
         SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typname = 'zatca_finalization_status'
       ), 'missing'),
       'not_started,finalizing,finalized,failed',
       CASE WHEN (
         SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typname = 'zatca_finalization_status'
       ) = ARRAY['not_started','finalizing','finalized','failed']::text[] THEN 'PASS' ELSE 'REVIEW' END;

INSERT INTO verification_results
SELECT 'finalization_columns', count(*)::text,
       '4 columns', CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'REVIEW' END
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoices'
  AND column_name IN ('zatca_finalization_status','zatca_finalized_at','zatca_finalization_error','zatca_finalization_version');

INSERT INTO verification_results
SELECT 'compliance_guard_trigger', count(*)::text,
       '1 trigger', CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'REVIEW' END
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'invoices'
  AND trigger_name = 'invoices_zatca_compliance_write_guard';

INSERT INTO verification_results
SELECT 'compliance_guard_security',
       COALESCE(max(p.prosecdef::text) || ':' || max(p.proconfig::text), 'missing'),
       'SECURITY DEFINER with search_path=public',
       CASE WHEN count(*) = 1 AND bool_and(p.prosecdef)
                  AND bool_and(p.proconfig @> ARRAY['search_path=public']::text[])
            THEN 'PASS' ELSE 'REVIEW' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'assert_zatca_compliance_write';

INSERT INTO verification_results
SELECT 'authenticated_compliance_update',
       concat_ws(',',
         CASE WHEN has_column_privilege('authenticated','public.invoices','zatca_qr_code','UPDATE') THEN 'qr' END,
         CASE WHEN has_column_privilege('authenticated','public.invoices','zatca_xml','UPDATE') THEN 'xml' END,
         CASE WHEN has_column_privilege('authenticated','public.invoices','zatca_xml_hash','UPDATE') THEN 'hash' END,
         CASE WHEN has_column_privilege('authenticated','public.invoices','zatca_signature','UPDATE') THEN 'signature' END,
         CASE WHEN has_column_privilege('authenticated','public.invoices','zatca_finalization_status','UPDATE') THEN 'finalization' END
       ),
       'none',
       CASE WHEN NOT has_column_privilege('authenticated','public.invoices','zatca_qr_code','UPDATE')
                  AND NOT has_column_privilege('authenticated','public.invoices','zatca_xml','UPDATE')
                  AND NOT has_column_privilege('authenticated','public.invoices','zatca_xml_hash','UPDATE')
                  AND NOT has_column_privilege('authenticated','public.invoices','zatca_signature','UPDATE')
                  AND NOT has_column_privilege('authenticated','public.invoices','zatca_finalization_status','UPDATE')
            THEN 'PASS' ELSE 'REVIEW' END;

INSERT INTO verification_results
SELECT 'legacy_qr_backfill_policy', count(*)::text, '0',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'invoices'
  AND policyname = 'phase3a_invoices_qr_backfill_update';

INSERT INTO verification_results
SELECT 'complete_final_rows', count(*)::text,
       'all finalized rows complete',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM public.invoices
WHERE zatca_finalization_status = 'finalized'
  AND (
    NULLIF(BTRIM(zatca_qr_code), '') IS NULL
    OR NULLIF(BTRIM(zatca_xml), '') IS NULL
    OR NULLIF(BTRIM(zatca_xml_hash), '') IS NULL
    OR NULLIF(BTRIM(zatca_signature), '') IS NULL
  );

INSERT INTO verification_results
SELECT 'pos_checkout_hash',
       CASE WHEN to_regprocedure('public.pos_checkout(jsonb)') IS NULL THEN 'missing'
            ELSE md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) END,
       'bdc4ee5a02be05aa8b1d7378ebb84c0f',
       CASE WHEN to_regprocedure('public.pos_checkout(jsonb)') IS NOT NULL
                  AND md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) = 'bdc4ee5a02be05aa8b1d7378ebb84c0f'
            THEN 'PASS' ELSE 'REVIEW' END;

INSERT INTO verification_results
SELECT 'snapshot_language_hash',
       CASE WHEN to_regprocedure('public.snapshot_invoice_document_language()') IS NULL THEN 'missing'
            ELSE md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)) END,
       '7f9b093d4a68d315868dadc9ce1f2c58',
       CASE WHEN to_regprocedure('public.snapshot_invoice_document_language()') IS NOT NULL
                  AND md5(pg_get_functiondef('public.snapshot_invoice_document_language()'::regprocedure)) = '7f9b093d4a68d315868dadc9ce1f2c58'
            THEN 'PASS' ELSE 'REVIEW' END;

INSERT INTO verification_results
SELECT 'phase6a_objects_absent', count(*)::text, '0',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END
FROM (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='identity_snapshot'
  UNION ALL
  SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='branch_compliance_profiles'
  UNION ALL
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='branches' AND column_name='compliance_identity_mode'
) x;

INSERT INTO verification_results VALUES
('runtime_finalization_fixture', 'requires isolated service-role fixture', 'complete row is reusable and concurrent claim is single-writer', 'REVIEW'),
('runtime_output_gating', 'requires isolated application fixture', 'simplified finalized/pending-report printable; standard pending-clearance blocked', 'REVIEW'),
('storage_ddl', 'not executed by this package', 'unchanged', 'PASS'),
('invoice_compliance_mutation', 'not executed by this package', 'no QR/XML/hash/signature rewrite', 'PASS'),
('pos_checkout_mutation', 'not executed by this package', 'unchanged', 'PASS');

SELECT check_name, observed_value, expected_value, result
FROM verification_results
ORDER BY check_name;

ROLLBACK;
