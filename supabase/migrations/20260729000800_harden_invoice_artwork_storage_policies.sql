BEGIN;

-- Forward-only hardening for the private A4 derivative bucket introduced by
-- 20260729000700. Every operation uses the same exact canonical path contract:
-- tenant/<tenant>/branch/<branch>/invoice-artwork/<asset>/<region>.<extension>
DO $invoice_artwork_policies$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS a4_invoice_artwork_insert ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_select ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_update ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_delete ON storage.objects;

  CREATE POLICY a4_invoice_artwork_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/invoice-artwork/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND (storage.foldername(storage.objects.name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(storage.objects.name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR (
              public.get_my_role()::TEXT = 'branch'
              AND b.id = public.get_my_branch_id()
            )
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/invoice-artwork/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND (storage.foldername(storage.objects.name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(storage.objects.name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR (
              public.get_my_role()::TEXT = 'branch'
              AND b.id = public.get_my_branch_id()
            )
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/invoice-artwork/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND (storage.foldername(storage.objects.name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(storage.objects.name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR (
              public.get_my_role()::TEXT = 'branch'
              AND b.id = public.get_my_branch_id()
            )
          )
      )
    )
    WITH CHECK (
      bucket_id = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/invoice-artwork/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND (storage.foldername(storage.objects.name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(storage.objects.name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR (
              public.get_my_role()::TEXT = 'branch'
              AND b.id = public.get_my_branch_id()
            )
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/invoice-artwork/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND (storage.foldername(storage.objects.name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(storage.objects.name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR (
              public.get_my_role()::TEXT = 'branch'
              AND b.id = public.get_my_branch_id()
            )
          )
      )
    );
END;
$invoice_artwork_policies$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_artwork_object_relocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $prevent_relocation$
BEGIN
  IF OLD.bucket_id = 'invoice-artwork'
    AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'Invoice artwork object paths are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$prevent_relocation$;

DO $invoice_artwork_relocation_trigger$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  DROP TRIGGER IF EXISTS storage_invoice_artwork_prevent_relocation ON storage.objects;
  CREATE TRIGGER storage_invoice_artwork_prevent_relocation
    BEFORE UPDATE OF bucket_id, name ON storage.objects
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_invoice_artwork_object_relocation();
END;
$invoice_artwork_relocation_trigger$;

REVOKE ALL ON FUNCTION public.prevent_invoice_artwork_object_relocation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prevent_invoice_artwork_object_relocation() IS
  'Prevents UPDATE from moving a private invoice-artwork derivative to another object path or bucket.';

COMMIT;
