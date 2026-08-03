-- Metadata-only remote/local preflight for 20260803000800.
-- No business tables are read and no data is modified.

SELECT jsonb_build_object(
  'migrationHistory', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version), '[]'::jsonb)
    FROM supabase_migrations.schema_migrations
    WHERE version >= '20260803000100'
  ),
  'relations', (
    SELECT coalesce(jsonb_object_agg(relation_name, to_regclass('public.' || relation_name)::text), '{}'::jsonb)
    FROM unnest(ARRAY[
      'tenants', 'branches', 'customers', 'user_profiles',
      'customer_receivable_accounts', 'customer_credit_policies',
      'customer_receivable_operations', 'customer_payment_receipts',
      'customer_receivable_entries', 'invoices', 'audit_events',
      'tenant_customer_credit_policies'
    ]) AS required(relation_name)
  ),
  'customerPolicyColumns', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable) ORDER BY column_name), '[]'::jsonb)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_credit_policies'
      AND column_name IN (
        'tenant_id', 'receivable_account_id', 'credit_enabled', 'credit_limit',
        'terms', 'hold', 'hold_reason', 'overdue_block',
        'warn_threshold_percent', 'requires_owner_approval', 'updated_by'
      )
  ),
  'roles', (
    SELECT coalesce(jsonb_agg(enumlabel ORDER BY enumsortorder), '[]'::jsonb)
    FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype
  ),
  'functions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature', p.oid::regprocedure::text,
      'securityDefiner', p.prosecdef,
      'config', p.proconfig,
      'owner', pg_get_userbyid(p.proowner),
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'serviceRole', has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'ar_assert_scope_v1', 'ar_ensure_customer_account_v1',
        'set_customer_credit_policy_v1',
        'get_customer_receivable_workspace_v1',
        'get_customer_credit_checkout_eligibility_v1',
        'post_customer_credit_checkout_v1',
        'record_customer_payment_receipt_v1',
        'record_customer_payment_receipt_v1_raw_20260803',
        'get_tenant_customer_credit_policy_v1',
        'set_tenant_customer_credit_policy_v1',
        'ensure_customer_receivable_account_v1'
      )
  ),
  'tableSecurity', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'rls', c.relrowsecurity, 'forceRls', c.relforcerowsecurity,
      'anonDirectDml', has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE'),
      'authenticatedDirectWrite', has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE'),
      'serviceRoleAccess', has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('customer_credit_policies', 'tenant_customer_credit_policies')
  ),
  'policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'command', cmd, 'roles', roles) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('customer_credit_policies', 'tenant_customer_credit_policies')
  )
) AS customer_credit_policy_preflight;
