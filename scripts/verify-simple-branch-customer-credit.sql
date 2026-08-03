-- Catalog-only verification for 20260803000900.
-- No tenant, customer, invoice, payment, stock or AR business rows are read.

DO $verify_simple_branch_credit$
DECLARE
  v_oid oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260803000900'
  ) THEN
    RAISE EXCEPTION 'SIMPLE_BRANCH_CREDIT_MIGRATION_NOT_APPLIED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches'
      AND column_name = 'customer_credit_enabled'
      AND is_nullable = 'YES' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'SIMPLE_BRANCH_CREDIT_COLUMN_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'branches' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BRANCH_RLS_NOT_ENABLED';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    'public.get_branch_customer_credit_policy_v1(uuid)'::regprocedure,
    'public.set_branch_customer_credit_policy_v1(jsonb)'::regprocedure,
    'public.ensure_customer_credit_account_v1(jsonb)'::regprocedure,
    'public.set_customer_credit_access_v1(jsonb)'::regprocedure,
    'public.get_customer_credit_checkout_eligibility_v1(jsonb)'::regprocedure,
    'public.post_customer_credit_checkout_v1(jsonb)'::regprocedure
  ]
  LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
       OR (SELECT proconfig FROM pg_proc WHERE oid = v_oid)
          IS DISTINCT FROM ARRAY['search_path=public, pg_temp', 'row_security=off']::text[]
       OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_oid)) <> 'postgres'
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'SIMPLE_BRANCH_CREDIT_FUNCTION_SECURITY_INVALID: %', v_oid::regprocedure;
    END IF;
  END LOOP;
END
$verify_simple_branch_credit$;

SELECT jsonb_build_object(
  'migrationHead', (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1),
  'branchColumn', (
    SELECT jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'customer_credit_enabled'
  ),
  'rls', (
    SELECT jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'branches'
  ),
  'functions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature', p.oid::regprocedure::text, 'owner', pg_get_userbyid(p.proowner),
      'securityDefiner', p.prosecdef, 'config', p.proconfig,
      'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_branch_customer_credit_policy_v1', 'set_branch_customer_credit_policy_v1',
      'ensure_customer_credit_account_v1', 'set_customer_credit_access_v1',
      'get_customer_credit_checkout_eligibility_v1', 'post_customer_credit_checkout_v1'
    )
  ),
  'creditIndexes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', indexname, 'definition', indexdef) ORDER BY indexname), '[]'::jsonb)
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('customer_credit_policies', 'tenant_customer_credit_policies')
  ),
  'creditConstraints', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid)) ORDER BY c.relname, con.conname), '[]'::jsonb)
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('customer_credit_policies', 'tenant_customer_credit_policies')
  ),
  'branchGatePresent', (
    SELECT pg_get_functiondef('public.get_customer_credit_checkout_eligibility_v1(jsonb)'::regprocedure) LIKE '%AR_CREDIT_BRANCH_DISABLED%'
      AND pg_get_functiondef('public.post_customer_credit_checkout_v1(jsonb)'::regprocedure) LIKE '%AR_CREDIT_BRANCH_DISABLED%'
  )
) AS simple_branch_customer_credit_verification;
