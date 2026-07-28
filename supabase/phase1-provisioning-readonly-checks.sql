BEGIN READ ONLY;

SELECT 'auth_users_without_profiles' AS check_name, count(*) AS affected
FROM auth.users u LEFT JOIN public.user_profiles p ON p.id = u.id WHERE p.id IS NULL
UNION ALL
SELECT 'profiles_without_auth_users', count(*)
FROM public.user_profiles p LEFT JOIN auth.users u ON u.id = p.id WHERE u.id IS NULL
UNION ALL
SELECT 'owners_without_tenants', count(*)
FROM public.user_profiles WHERE role = 'owner' AND tenant_id IS NULL
UNION ALL
SELECT 'tenants_without_active_owner', count(*)
FROM public.tenants t WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles p WHERE p.tenant_id = t.id AND p.role = 'owner' AND p.is_active IS TRUE
)
UNION ALL
SELECT 'tenants_with_multiple_active_owners', count(*) FROM (
  SELECT tenant_id FROM public.user_profiles
  WHERE role = 'owner' AND is_active IS TRUE AND tenant_id IS NOT NULL
  GROUP BY tenant_id HAVING count(*) > 1
) x
UNION ALL
SELECT 'orphan_subscriptions', count(*)
FROM public.tenant_subscriptions s LEFT JOIN public.tenants t ON t.id = s.tenant_id WHERE t.id IS NULL
UNION ALL
SELECT 'multiple_live_subscriptions', count(*) FROM (
  SELECT tenant_id FROM public.tenant_subscriptions
  WHERE status IN ('trial','active') AND cancelled_at IS NULL
  GROUP BY tenant_id HAVING count(*) > 1
) x
UNION ALL
SELECT 'branch_users_without_branches', count(*)
FROM public.user_profiles p LEFT JOIN public.branches b ON b.id = p.branch_id
WHERE p.role = 'branch' AND b.id IS NULL
UNION ALL
SELECT 'profile_branch_tenant_mismatches', count(*)
FROM public.user_profiles p JOIN public.branches b ON b.id = p.branch_id
WHERE p.tenant_id IS DISTINCT FROM b.tenant_id
UNION ALL
SELECT 'multiple_main_branches', count(*) FROM (
  SELECT tenant_id FROM public.branches WHERE is_main_branch IS TRUE
  GROUP BY tenant_id HAVING count(*) > 1
) x
UNION ALL
SELECT 'main_branches_without_active_tenant', count(*)
FROM public.branches b LEFT JOIN public.tenants t ON t.id = b.tenant_id
WHERE b.is_main_branch IS TRUE AND (t.id IS NULL OR t.is_active IS NOT TRUE)
UNION ALL
SELECT 'branches_without_tenants', count(*)
FROM public.branches b LEFT JOIN public.tenants t ON t.id = b.tenant_id
WHERE t.id IS NULL
UNION ALL
SELECT 'branches_without_active_login_mapping', count(*)
FROM public.branches b WHERE NOT EXISTS (
  SELECT 1 FROM public.branch_login_usernames m
  WHERE m.branch_id = b.id AND m.tenant_id = b.tenant_id AND m.is_active IS TRUE
)
UNION ALL
SELECT 'duplicate_branch_usernames', count(*) FROM (
  SELECT normalized_username FROM public.branch_login_usernames
  GROUP BY normalized_username HAVING count(*) > 1
) x
UNION ALL
SELECT 'eligible_unassigned_owners', count(*)
FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
WHERE p.role = 'owner' AND p.tenant_id IS NULL;

DO $$
DECLARE v_count bigint;
BEGIN
  IF to_regclass('public.owner_provisioning_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.owner_provisioning_requests WHERE state <> ''complete'''
      INTO v_count;
    RAISE NOTICE 'incomplete_owner_provisioning=%', v_count;
  ELSE
    RAISE NOTICE 'incomplete_owner_provisioning=0 (state table not installed)';
  END IF;
  IF to_regclass('public.first_branch_provisioning_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.first_branch_provisioning_requests WHERE state <> ''complete'''
      INTO v_count;
    RAISE NOTICE 'incomplete_first_branch_provisioning=%', v_count;
  ELSE
    RAISE NOTICE 'incomplete_first_branch_provisioning=0 (state table not installed)';
  END IF;
END
$$;

-- Mandatory ACL/search-path review. Any browser EXECUTE privilege on the seven
-- server-only functions blocks deployment. The status function is the sole
-- authenticated provisioning RPC.
SELECT
  p.oid::regprocedure AS function_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'acquire_owner_provisioning', 'attach_owner_provisioning_auth',
    'complete_owner_provisioning_core', 'set_owner_provisioning_result',
    'prepare_first_branch_provisioning', 'complete_first_branch_access',
    'set_first_branch_provisioning_result', 'get_first_branch_provisioning_status'
  )
ORDER BY p.proname;

-- Trigger inventory for the affected Auth/profile/subscription/branch surfaces.
SELECT event_object_schema, event_object_table, trigger_name,
       action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema IN ('auth', 'public')
  AND event_object_table IN (
    'users', 'user_profiles', 'tenant_subscriptions', 'branches',
    'branch_login_usernames', 'owner_provisioning_requests',
    'first_branch_provisioning_requests'
  )
ORDER BY event_object_schema, event_object_table, trigger_name, event_manipulation;

ROLLBACK;
