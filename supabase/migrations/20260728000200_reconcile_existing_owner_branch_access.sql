-- Route established owners from authoritative active branch access rather than
-- requiring a historical first-branch request or username mapping.

CREATE OR REPLACE FUNCTION public.get_first_branch_provisioning_status()
RETURNS TABLE (
  state text,
  branch_id uuid,
  access_complete boolean,
  error_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH caller AS (
    SELECT p.tenant_id
    FROM public.user_profiles p
    JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active IS TRUE
    WHERE p.id = auth.uid()
      AND p.role = 'owner'
      AND p.is_active IS TRUE
  ),
  request AS (
    SELECT r.*
    FROM public.first_branch_provisioning_requests r
    JOIN caller c ON c.tenant_id = r.tenant_id
  ),
  accessible_branch AS (
    SELECT b.id
    FROM public.branches b
    JOIN caller c ON c.tenant_id = b.tenant_id
    WHERE b.is_active IS TRUE
      AND (
        EXISTS (
          SELECT 1
          FROM public.branch_login_usernames m
          JOIN public.user_profiles bp
            ON bp.id = m.user_id
           AND bp.tenant_id = b.tenant_id
           AND bp.branch_id = b.id
           AND bp.role = 'branch'
           AND bp.is_active IS TRUE
          JOIN auth.users au
            ON au.id = bp.id
           AND au.deleted_at IS NULL
           AND au.email_confirmed_at IS NOT NULL
           AND (au.banned_until IS NULL OR au.banned_until < now())
          WHERE m.tenant_id = b.tenant_id
            AND m.branch_id = b.id
            AND m.is_active IS TRUE
        )
        OR EXISTS (
          SELECT 1
          FROM public.user_profiles ep
          JOIN auth.users eu
            ON eu.id = ep.id
           AND eu.deleted_at IS NULL
           AND eu.email_confirmed_at IS NOT NULL
           AND (eu.banned_until IS NULL OR eu.banned_until < now())
          WHERE ep.tenant_id = b.tenant_id
            AND ep.branch_id = b.id
            AND ep.role = 'branch'
            AND ep.is_active IS TRUE
            AND lower(btrim(eu.email)) NOT LIKE '%@branch-login.kubri.internal'
        )
      )
    ORDER BY b.is_main_branch DESC, b.created_at, b.id
    LIMIT 1
  ),
  fallback_branch AS (
    SELECT b.id
    FROM public.branches b
    JOIN caller c ON c.tenant_id = b.tenant_id
    WHERE b.is_active IS TRUE
    ORDER BY b.is_main_branch DESC, b.created_at, b.id
    LIMIT 1
  )
  SELECT
    CASE
      WHEN ab.id IS NOT NULL THEN 'complete'
      WHEN r.state IS NOT NULL THEN r.state
      WHEN fb.id IS NOT NULL THEN 'branch_ready'
      ELSE 'requested'
    END,
    coalesce(ab.id, r.branch_id, fb.id),
    ab.id IS NOT NULL,
    CASE WHEN ab.id IS NOT NULL THEN NULL ELSE r.last_error_code END
  FROM caller c
  LEFT JOIN request r ON true
  LEFT JOIN accessible_branch ab ON true
  LEFT JOIN fallback_branch fb ON true
$$;

REVOKE ALL ON FUNCTION public.get_first_branch_provisioning_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_first_branch_provisioning_status() TO authenticated, service_role;
