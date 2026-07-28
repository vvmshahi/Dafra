BEGIN READ ONLY;

-- Stop deployment unless this relation is an ordinary RLS-enabled table with
-- the exact prerequisite columns. Do not inspect customer invoice contents.
SELECT
  c.oid::regclass AS object_name,
  c.relkind AS object_kind,
  pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'zatca_finalization_runtime';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zatca_finalization_runtime'
ORDER BY ordinal_position;

SELECT
  has_table_privilege('public', 'public.zatca_finalization_runtime', 'SELECT') AS public_select,
  has_table_privilege('anon', 'public.zatca_finalization_runtime', 'SELECT') AS anon_select,
  has_table_privilege('authenticated', 'public.zatca_finalization_runtime', 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', 'public.zatca_finalization_runtime', 'SELECT') AS service_select;

SELECT immutable_finalization_enabled, simplified_enabled, standard_enabled,
       atomic_simplified_checkout_enabled, schema_version,
       minimum_edge_version, minimum_client_version
FROM public.zatca_finalization_runtime
WHERE singleton IS TRUE;

-- Required prerequisite objects and their browser/service access.
SELECT c.oid::regclass AS object_name, c.relkind, c.relrowsecurity,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('service_role', c.oid, 'SELECT') AS service_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'zatca_chain_heads_v2', 'zatca_chain_reservations_v2',
  'zatca_client_capabilities_v2', 'zatca_branch_readiness_v2',
  'zatca_reporting_outbox_v2'
)
ORDER BY c.relname;

SELECT p.oid::regprocedure AS function_name, p.prosecdef,
       p.proconfig, pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (
  p.proname LIKE '%zatca%v2%' OR
  p.proname IN ('get_zatca_output_state_v2', 'get_zatca_branch_readiness_v2')
)
ORDER BY p.oid::regprocedure::text;

-- The manually deployed prerequisite package may exist while the restored
-- historical migration is absent from migration history. Only after every
-- schema result above matches the reviewed repository contract may an operator
-- record version 20260723000000 as applied. Otherwise stop.
SELECT version, name, statements
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260723000000', '20260724000000', '20260724000100')
ORDER BY version;

-- Phase 1 production gates remain mandatory.
SELECT tenant_id, count(*) AS main_branch_count
FROM public.branches WHERE is_main_branch IS TRUE
GROUP BY tenant_id HAVING count(*) > 1;

SELECT tenant_id, count(*) AS live_subscription_count
FROM public.tenant_subscriptions
WHERE status IN ('trial','active') AND cancelled_at IS NULL
GROUP BY tenant_id HAVING count(*) > 1;

DO $$
DECLARE v_count bigint;
BEGIN
  IF to_regclass('public.owner_provisioning_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.owner_provisioning_requests WHERE state <> ''complete''' INTO v_count;
    RAISE NOTICE 'incomplete_owner_provisioning=%', v_count;
  END IF;
  IF to_regclass('public.first_branch_provisioning_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.first_branch_provisioning_requests WHERE state <> ''complete''' INTO v_count;
    RAISE NOTICE 'incomplete_first_branch_provisioning=%', v_count;
  END IF;
END
$$;

ROLLBACK;
