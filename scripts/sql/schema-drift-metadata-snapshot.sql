-- Read-only, schema-only metadata snapshot. Execute with:
--   supabase db query --linked --file scripts/sql/schema-drift-metadata-snapshot.sql
-- No table rows are selected.
WITH application_schemas AS (
  SELECT oid, nspname
  FROM pg_namespace
  WHERE nspname !~ '^pg_'
    AND nspname <> 'information_schema'
),
relations AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname, c.relkind,
         c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.relacl
  FROM pg_class c
  JOIN application_schemas n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
),
functions AS (
  SELECT p.oid, n.nspname AS schema_name, p.proname, p.prokind,
         p.provolatile, p.prosecdef, p.proleakproof, p.proconfig,
         l.lanname AS language_name, p.proowner, p.proacl
  FROM pg_proc p
  JOIN application_schemas n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
)
SELECT jsonb_build_object(
  'schemas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', nspname) ORDER BY nspname)
    FROM application_schemas
  ), '[]'::jsonb),
  'extensions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', e.extname,
      'schema', n.nspname,
      'version', e.extversion
    ) ORDER BY e.extname)
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
  ), '[]'::jsonb),
  'relations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', r.schema_name,
      'name', r.relname,
      'kind', r.relkind,
      'rls_enabled', r.relrowsecurity,
      'rls_forced', r.relforcerowsecurity,
      'columns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'default', pg_get_expr(ad.adbin, ad.adrelid),
          'identity', a.attidentity,
          'generated', a.attgenerated
        ) ORDER BY a.attnum)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
      ), '[]'::jsonb),
      'constraints', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'type', con.contype,
          'definition', pg_get_constraintdef(con.oid, true),
          'deferrable', con.condeferrable,
          'deferred', con.condeferred,
          'validated', con.convalidated
        ) ORDER BY con.conname)
        FROM pg_constraint con WHERE con.conrelid = r.oid
      ), '[]'::jsonb),
      'indexes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', i.relname,
          'definition', pg_get_indexdef(i.oid)
        ) ORDER BY i.relname)
        FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
        WHERE ix.indrelid = r.oid
      ), '[]'::jsonb),
      'policies', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', pol.polname,
          'command', pol.polcmd::text,
          'roles', COALESCE((SELECT jsonb_agg(role.rolname ORDER BY role.rolname)
            FROM pg_roles role WHERE role.oid = ANY(pol.polroles)), '[]'::jsonb),
          'using', pg_get_expr(pol.polqual, pol.polrelid),
          'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)
        ) ORDER BY pol.polname)
        FROM pg_policy pol WHERE pol.polrelid = r.oid
      ), '[]'::jsonb),
      'triggers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', t.tgname,
          'enabled', t.tgenabled,
          'definition', pg_get_triggerdef(t.oid, true)
        ) ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid = r.oid AND NOT t.tgisinternal
      ), '[]'::jsonb),
      'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) ORDER BY COALESCE(grantee.rolname, 'PUBLIC'), acl.privilege_type)
        FROM aclexplode(COALESCE(r.relacl, acldefault('r', r.relowner))) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
      ), '[]'::jsonb)
    ) ORDER BY r.schema_name, r.relname)
    FROM relations r
  ), '[]'::jsonb),
  'functions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', f.schema_name,
      'name', f.proname,
      'identity_arguments', pg_get_function_identity_arguments(f.oid),
      'return_type', pg_get_function_result(f.oid),
      'kind', f.prokind,
      'volatility', f.provolatile,
      'security_definer', f.prosecdef,
      'leakproof', f.proleakproof,
      'language', f.language_name,
      'config', COALESCE(to_jsonb(f.proconfig), '[]'::jsonb),
      'definition', pg_get_functiondef(f.oid),
      'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) ORDER BY COALESCE(grantee.rolname, 'PUBLIC'), acl.privilege_type)
        FROM aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
      ), '[]'::jsonb)
    ) ORDER BY f.schema_name, f.proname, pg_get_function_identity_arguments(f.oid))
    FROM functions f
  ), '[]'::jsonb)
) AS schema_snapshot;
