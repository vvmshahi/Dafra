-- Auth signup metadata is presentation input, never an authorization source.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    tenant_id,
    branch_id,
    is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    LEFT(BTRIM(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), 255),
    'owner'::public.user_role,
    NULL,
    NULL,
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates an active, unassigned owner profile; Auth metadata cannot assign authority.';
