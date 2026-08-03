-- Metadata-only preflight for 20260803000900.
-- It intentionally reads catalogs only and never reads or changes business rows.

SELECT jsonb_build_object(
  'migrationHistory', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version), '[]'::jsonb)
    FROM supabase_migrations.schema_migrations
    WHERE version >= '20260803000100'
  ),
  'requiredRelations', (
    SELECT coalesce(jsonb_object_agg(relation_name, to_regclass('public.' || relation_name)::text), '{}'::jsonb)
    FROM unnest(ARRAY[
      'tenants', 'branches', 'customers', 'user_profiles', 'audit_events',
      'customer_receivable_accounts', 'customer_credit_policies',
      'tenant_customer_credit_policies', 'invoices'
    ]) AS required(relation_name)
  ),
  'branchCreditColumn', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', column_name, 'type', data_type, 'nullable', is_nullable,
      'default', column_default
    )), '[]'::jsonb)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches'
      AND column_name = 'customer_credit_enabled'
  ),
  'requiredFunctions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature', p.oid::regprocedure::text,
      'securityDefiner', p.prosecdef,
      'config', p.proconfig,
      'owner', pg_get_userbyid(p.proowner)
    ) ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text IN (
        'ar_assert_scope_v1(uuid,uuid)',
        'ar_ensure_customer_account_v1(uuid)',
        'record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)',
        'resolve_pos_checkout_document_internal_v1(uuid,uuid,uuid)',
        'post_customer_credit_checkout_v1_hardened_20260803(jsonb)'
      )
  ),
  'targetFunctionsAlreadyPresent', (
    SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_branch_customer_credit_policy_v1',
        'set_branch_customer_credit_policy_v1',
        'ensure_customer_credit_account_v1',
        'set_customer_credit_access_v1'
      )
  ),
  'branchTableSecurity', (
    SELECT jsonb_build_object(
      'rls', c.relrowsecurity,
      'forceRls', c.relforcerowsecurity,
      'anonDirectDml', has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE'),
      'authenticatedDirectWrite', has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE')
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'branches'
  ),
  'creditTableSecurity', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'rls', c.relrowsecurity, 'forceRls', c.relforcerowsecurity,
      'anonDirectDml', has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE'),
      'authenticatedDirectWrite', has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE')
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('customer_credit_policies', 'tenant_customer_credit_policies')
  )
) AS simple_branch_customer_credit_preflight;
