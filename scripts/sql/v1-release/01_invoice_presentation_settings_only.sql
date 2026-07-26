-- V1 presentation-only migration. No Phase 6A, invoice snapshot, checkout, or Storage changes.
BEGIN;

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS presentation_settings jsonb;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='branches' AND column_name='presentation_settings' AND udt_name <> 'jsonb') THEN
    RAISE EXCEPTION 'branches.presentation_settings exists with an incompatible type';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.v1_default_invoice_presentation_settings(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id=p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('schema_version',1,
    'identity',jsonb_build_object('display_heading',b.display_name,'display_subheading',null,'custom_display_name',b.display_name,'show_company_name',true,'show_branch_name',true),
    'contact',jsonb_build_object('phone',b.phone,'email',b.email,'website',b.website,'show_phone',b.phone is not null,'show_email',coalesce(b.show_email,false),'show_website',coalesce(b.show_website,false),'show_address',true),
    'footer',jsonb_build_object('thank_you_message',null,'footer_note',b.receipt_footer,'refund_note',null,'show_thank_you',false,'show_footer',coalesce(b.show_footer,true),'show_refund_note',false),
    'logo',jsonb_build_object('visible',coalesce(b.show_logo,false),'asset_path',b.logo_url,'asset_version',1,'size','medium'),
    'thermal',jsonb_build_object('width','80mm','density','standard','qr_size','standard','qr_alignment','center','wrap_item_names',true,'show_cash_change',coalesce(b.show_cash_change,true)),
    'a4',jsonb_build_object('template_id','classic','template_version',1,'header_style','standard'));
END $$;

CREATE OR REPLACE FUNCTION public.get_branch_invoice_settings(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE u record; b record;
BEGIN
  SELECT tenant_id,branch_id,role::text role,is_active INTO u FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO b FROM public.branches WHERE id=p_branch_id AND is_active;
  IF NOT FOUND OR NOT u.is_active OR NOT ((u.role='owner' AND u.tenant_id=b.tenant_id) OR (u.role='branch' AND u.tenant_id=b.tenant_id AND u.branch_id=b.id)) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('branch_id',b.id,'presentation_settings',coalesce(b.presentation_settings,public.v1_default_invoice_presentation_settings(b.id)),'invoice_language',b.invoice_language,'print_mode',b.print_mode,'can_edit',true,'role',u.role);
END $$;

CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE u record; b record; lang text; mode text; settings jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid invoice settings payload' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('branch_id','invoice_language','print_mode','presentation_settings','display_name','phone','show_logo','logo_url','website','email','show_website','show_email','receipt_footer','show_footer','show_cash_change')) THEN RAISE EXCEPTION 'Unsupported presentation setting' USING ERRCODE='22023'; END IF;
  SELECT tenant_id,branch_id,role::text role,is_active INTO u FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO b FROM public.branches WHERE id=nullif(btrim(p_payload->>'branch_id'),'')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT u.is_active OR NOT ((u.role='owner' AND u.tenant_id=b.tenant_id) OR (u.role='branch' AND u.tenant_id=b.tenant_id AND u.branch_id=b.id)) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  lang:=coalesce(p_payload->>'invoice_language',b.invoice_language); mode:=coalesce(p_payload->>'print_mode',b.print_mode);
  IF lang NOT IN ('en','ar','both') OR mode NOT IN ('thermal','pdf','both') THEN RAISE EXCEPTION 'Invalid document mode or language' USING ERRCODE='22023'; END IF;
  settings:=coalesce(p_payload->'presentation_settings',b.presentation_settings,public.v1_default_invoice_presentation_settings(b.id));
  IF jsonb_typeof(settings)<>'object' OR settings ?| ARRAY['compliance','vatNumber','registrationIdentifier'] THEN RAISE EXCEPTION 'Invalid presentation settings' USING ERRCODE='22023'; END IF;
  UPDATE public.branches SET presentation_settings=settings,invoice_language=lang,print_mode=mode,updated_at=now() WHERE id=b.id;
  RETURN jsonb_build_object('branch_id',b.id,'presentation_settings',settings,'invoice_language',lang,'print_mode',mode,'can_edit',true);
END $$;

REVOKE ALL ON FUNCTION public.get_branch_invoice_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_invoice_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(jsonb) TO authenticated;
COMMIT;
