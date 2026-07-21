-- Phase 6A: separate protected ZATCA identity, presentation settings, and issued snapshots.
-- ADDITIVE ONLY. Do not backfill branch_compliance_profiles from ambiguous legacy columns.
-- ROLLOUT: every deployed branch starts in explicit legacy mode. This migration alone
-- must not block invoice creation. A branch may enter protected mode only through
-- activate_branch_compliance_identity() after an authoritative profile is verified.
BEGIN;

CREATE TABLE IF NOT EXISTS public.branch_compliance_profiles (
  branch_id UUID PRIMARY KEY REFERENCES public.branches(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  registered_seller_name TEXT,
  registered_seller_name_ar TEXT,
  vat_number TEXT,
  registration_scheme TEXT NOT NULL DEFAULT 'CRN' CHECK (registration_scheme IN ('CRN','MOM','MLS','SAG','OTH')),
  registration_identifier TEXT,
  building_number TEXT,
  street TEXT,
  district TEXT,
  city TEXT,
  postal_code TEXT,
  country CHAR(2) NOT NULL DEFAULT 'SA',
  validation_status TEXT NOT NULL DEFAULT 'draft' CHECK (validation_status IN ('draft','needs_review','verified','rejected','revalidation_required')),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id)
);

ALTER TABLE public.branch_compliance_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_compliance_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.branch_compliance_profiles TO authenticated;

DROP POLICY IF EXISTS branch_compliance_profiles_read_scope ON public.branch_compliance_profiles;
CREATE POLICY branch_compliance_profiles_read_scope ON public.branch_compliance_profiles
FOR SELECT TO authenticated USING (
  tenant_id = public.get_my_tenant_id()
  AND (public.get_my_role() IN ('owner','admin') OR branch_id = public.get_my_branch_id())
);

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS invoice_display_heading TEXT,
  ADD COLUMN IF NOT EXISTS invoice_display_subheading TEXT,
  ADD COLUMN IF NOT EXISTS show_company_display_name BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_branch_display_name BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thermal_density TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS a4_template_id TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS document_template_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS compliance_identity_mode TEXT NOT NULL DEFAULT 'legacy';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.branches'::regclass AND conname='branches_compliance_identity_mode_check') THEN
    ALTER TABLE public.branches ADD CONSTRAINT branches_compliance_identity_mode_check
      CHECK (compliance_identity_mode IN ('legacy','protected'));
  END IF;
END $$;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS identity_snapshot JSONB;
COMMENT ON COLUMN public.invoices.identity_snapshot IS
  'Immutable versioned issue-time compliance, presentation, and document configuration snapshot. NULL identifies legacy documents.';

CREATE OR REPLACE FUNCTION public.capture_invoice_identity_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_compliance RECORD; v_branch RECORD;
BEGIN
  SELECT * INTO v_branch FROM public.branches WHERE id = NEW.branch_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice branch does not match tenant' USING ERRCODE = '23503'; END IF;

  -- Explicit rollout gate: legacy branches remain identifiable by a NULL snapshot
  -- and retain their pre-migration issuance path. No ambiguous snapshot is fabricated.
  IF v_branch.compliance_identity_mode = 'legacy' THEN
    NEW.identity_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_compliance FROM public.branch_compliance_profiles
   WHERE branch_id = NEW.branch_id AND tenant_id = NEW.tenant_id AND validation_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Official seller profile is incomplete or unverified'
      USING ERRCODE = '23514', HINT = 'Verify the branch compliance identity before issuing an invoice.';
  END IF;
  IF btrim(v_compliance.registered_seller_name) = '' OR btrim(v_compliance.vat_number) = ''
     OR btrim(v_compliance.building_number) = '' OR btrim(v_compliance.street) = ''
     OR btrim(v_compliance.district) = '' OR btrim(v_compliance.city) = ''
     OR btrim(v_compliance.postal_code) = '' THEN
    RAISE EXCEPTION 'Official seller profile is incomplete' USING ERRCODE = '23514';
  END IF;
  NEW.identity_snapshot := jsonb_build_object(
    'version', 1,
    'legacy', false,
    'compliance', jsonb_build_object(
      'registeredSellerName', v_compliance.registered_seller_name,
      'registeredSellerNameAr', v_compliance.registered_seller_name_ar,
      'vatNumber', v_compliance.vat_number,
      'registrationScheme', v_compliance.registration_scheme,
      'registrationIdentifier', v_compliance.registration_identifier,
      'address', jsonb_build_object('buildingNumber',v_compliance.building_number,'street',v_compliance.street,'district',v_compliance.district,'city',v_compliance.city,'postalCode',v_compliance.postal_code,'country',v_compliance.country)
    ),
    'presentation', jsonb_build_object(
      'displayHeading', v_branch.invoice_display_heading,
      'displaySubheading', v_branch.invoice_display_subheading,
      'showCompanyDisplayName', v_branch.show_company_display_name,
      'showBranchDisplayName', v_branch.show_branch_display_name,
      'companyDisplayName', CASE WHEN v_branch.show_company_display_name THEN v_branch.display_name ELSE NULL END,
      'branchDisplayName', CASE WHEN v_branch.show_branch_display_name THEN v_branch.name ELSE NULL END,
      'branchDisplayNameAr', CASE WHEN v_branch.show_branch_display_name THEN v_branch.name_ar ELSE NULL END,
      'logoUrl', CASE WHEN v_branch.show_logo THEN v_branch.logo_url ELSE NULL END,
      'showLogo', v_branch.show_logo,
      'phone', v_branch.phone, 'email', v_branch.email, 'website', v_branch.website,
      'showEmail', v_branch.show_email, 'showWebsite', v_branch.show_website,
      'footer', v_branch.receipt_footer, 'showFooter', v_branch.show_footer
    ),
    'document', jsonb_build_object(
      'language', COALESCE(NEW.document_language, v_branch.invoice_language, 'both'),
      'thermalDensity', v_branch.thermal_density,
      'a4TemplateId', v_branch.a4_template_id,
      'templateVersion', v_branch.document_template_version
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_capture_identity_snapshot ON public.invoices;
CREATE TRIGGER invoices_capture_identity_snapshot BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_identity_snapshot();

CREATE OR REPLACE FUNCTION public.prevent_invoice_identity_snapshot_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot THEN
    RAISE EXCEPTION 'Issued invoice identity snapshot is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invoices_identity_snapshot_immutable ON public.invoices;
CREATE TRIGGER invoices_identity_snapshot_immutable BEFORE UPDATE OF identity_snapshot ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_snapshot_change();

CREATE OR REPLACE FUNCTION public.update_branch_compliance_profile(p_branch_id UUID, p_payload JSONB, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_uid UUID := auth.uid(); v_profile RECORD; v_branch RECORD; v_old JSONB; v_new JSONB; v_changed TEXT[];
BEGIN
  SELECT id,tenant_id,role::TEXT role,is_active INTO v_profile FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_profile.is_active OR v_profile.role <> 'owner' THEN RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id INTO v_branch FROM public.branches WHERE id=p_branch_id AND tenant_id=v_profile.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Change reason is required' USING ERRCODE='22023'; END IF;
  IF NULLIF(btrim(p_payload->>'registeredSellerName'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'vatNumber'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'registrationIdentifier'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'buildingNumber'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'street'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'district'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'city'),'') IS NULL
     OR NULLIF(btrim(p_payload->>'postalCode'),'') IS NULL THEN
    RAISE EXCEPTION 'Official seller profile is incomplete' USING ERRCODE='22023';
  END IF;
  SELECT to_jsonb(c)-ARRAY['created_at','updated_at','verified_by'] INTO v_old FROM public.branch_compliance_profiles c WHERE branch_id=p_branch_id;
  INSERT INTO public.branch_compliance_profiles(branch_id,tenant_id,registered_seller_name,registered_seller_name_ar,vat_number,registration_scheme,registration_identifier,building_number,street,district,city,postal_code,country,validation_status,verified_at,verified_by)
  VALUES(p_branch_id,v_branch.tenant_id,btrim(p_payload->>'registeredSellerName'),NULLIF(btrim(p_payload->>'registeredSellerNameAr'),''),btrim(p_payload->>'vatNumber'),COALESCE(NULLIF(btrim(p_payload->>'registrationScheme'),''),'CRN'),btrim(p_payload->>'registrationIdentifier'),btrim(p_payload->>'buildingNumber'),btrim(p_payload->>'street'),btrim(p_payload->>'district'),btrim(p_payload->>'city'),btrim(p_payload->>'postalCode'),COALESCE(NULLIF(btrim(p_payload->>'country'),''),'SA'),'needs_review',NULL,v_uid)
  ON CONFLICT(branch_id) DO UPDATE SET registered_seller_name=EXCLUDED.registered_seller_name,registered_seller_name_ar=EXCLUDED.registered_seller_name_ar,vat_number=EXCLUDED.vat_number,registration_scheme=EXCLUDED.registration_scheme,registration_identifier=EXCLUDED.registration_identifier,building_number=EXCLUDED.building_number,street=EXCLUDED.street,district=EXCLUDED.district,city=EXCLUDED.city,postal_code=EXCLUDED.postal_code,country=EXCLUDED.country,validation_status='needs_review',verified_at=NULL,verified_by=EXCLUDED.verified_by,updated_at=NOW();
  SELECT to_jsonb(c)-ARRAY['created_at','updated_at','verified_by'] INTO v_new FROM public.branch_compliance_profiles c WHERE branch_id=p_branch_id;
  SELECT array_agg(key ORDER BY key) INTO v_changed FROM jsonb_each(COALESCE(v_old,'{}')) o(key,value) FULL JOIN jsonb_each(v_new) n USING(key) WHERE o.value IS DISTINCT FROM n.value;
  IF to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    PERFORM public.record_audit_event('branch_compliance_identity_changed',v_branch.tenant_id,p_branch_id,v_uid,v_profile.role,'branch',p_branch_id,'warning','succeeded',jsonb_build_object('changed_fields',COALESCE(v_changed,ARRAY[]::TEXT[]),'reason',btrim(p_reason),'credential_impact','reverification_required'),NULL,NULL);
  END IF;
  RETURN jsonb_build_object('ok',true,'branch_id',p_branch_id,'validation_status','needs_review');
END;
$$;
REVOKE ALL ON FUNCTION public.update_branch_compliance_profile(UUID,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_compliance_profile(UUID,JSONB,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_branch_compliance_identity(p_branch_id UUID, p_reason TEXT, p_confirmation BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_profile RECORD; v_branch RECORD; v_compliance RECORD;
BEGIN
  SELECT id,tenant_id,role::TEXT role,is_active INTO v_profile FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_profile.is_active OR v_profile.role <> 'owner' OR p_confirmation IS NOT TRUE THEN RAISE EXCEPTION 'Explicit owner confirmation required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Activation reason is required' USING ERRCODE='22023'; END IF;
  SELECT id,tenant_id,compliance_identity_mode INTO v_branch FROM public.branches WHERE id=p_branch_id AND tenant_id=v_profile.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_compliance FROM public.branch_compliance_profiles WHERE branch_id=p_branch_id AND tenant_id=v_branch.tenant_id AND validation_status='verified';
  IF NOT FOUND OR NULLIF(btrim(v_compliance.registered_seller_name),'') IS NULL OR NULLIF(btrim(v_compliance.vat_number),'') IS NULL
     OR NULLIF(btrim(v_compliance.registration_identifier),'') IS NULL OR NULLIF(btrim(v_compliance.building_number),'') IS NULL
     OR NULLIF(btrim(v_compliance.street),'') IS NULL OR NULLIF(btrim(v_compliance.district),'') IS NULL
     OR NULLIF(btrim(v_compliance.city),'') IS NULL OR NULLIF(btrim(v_compliance.postal_code),'') IS NULL THEN
    RAISE EXCEPTION 'Verified official seller profile is required before activation' USING ERRCODE='23514';
  END IF;
  UPDATE public.branches SET compliance_identity_mode='protected',updated_at=NOW() WHERE id=p_branch_id;
  IF to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    PERFORM public.record_audit_event('branch_compliance_identity_activated',v_branch.tenant_id,p_branch_id,v_uid,v_profile.role,'branch',p_branch_id,'warning','succeeded',jsonb_build_object('reason',btrim(p_reason),'previous_mode',v_branch.compliance_identity_mode,'new_mode','protected'),NULL,NULL);
  END IF;
  RETURN jsonb_build_object('ok',true,'branch_id',p_branch_id,'compliance_identity_mode','protected');
END;
$$;
REVOKE ALL ON FUNCTION public.activate_branch_compliance_identity(UUID,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_branch_compliance_identity(UUID,TEXT,BOOLEAN) TO authenticated;

ALTER TABLE public.branch_compliance_profiles ADD COLUMN IF NOT EXISTS evidence_reference TEXT;

CREATE OR REPLACE FUNCTION public.get_compliance_identity_capability()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('available',true,'schema_version',1);
$$;
REVOKE ALL ON FUNCTION public.get_compliance_identity_capability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_compliance_identity_capability() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_branch_compliance_readiness(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_user RECORD; v_branch RECORD; v_profile RECORD;
BEGIN
  SELECT tenant_id,branch_id,role::TEXT role,is_active INTO v_user FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_user.is_active THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id,compliance_identity_mode INTO v_branch FROM public.branches WHERE id=p_branch_id AND tenant_id=v_user.tenant_id;
  IF NOT FOUND OR (v_user.role NOT IN ('owner','admin') AND v_user.branch_id IS DISTINCT FROM p_branch_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_profile FROM public.branch_compliance_profiles WHERE branch_id=p_branch_id AND tenant_id=v_branch.tenant_id;
  RETURN jsonb_build_object('available',true,'branchId',p_branch_id,'mode',v_branch.compliance_identity_mode,
    'status',COALESCE(v_profile.validation_status,'missing'),'profile',CASE WHEN v_profile.branch_id IS NULL THEN NULL ELSE jsonb_build_object(
      'branchId',v_profile.branch_id,'registeredSellerName',v_profile.registered_seller_name,'registeredSellerNameAr',v_profile.registered_seller_name_ar,
      'vatNumber',v_profile.vat_number,'registrationScheme',v_profile.registration_scheme,'registrationIdentifier',v_profile.registration_identifier,
      'buildingNumber',v_profile.building_number,'street',v_profile.street,'district',v_profile.district,'city',v_profile.city,
      'postalCode',v_profile.postal_code,'country',v_profile.country,'status',v_profile.validation_status,
      'evidenceReference',v_profile.evidence_reference,'verifiedAt',v_profile.verified_at,'verifiedBy',v_profile.verified_by,'updatedAt',v_profile.updated_at) END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_branch_compliance_readiness(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_compliance_readiness(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_branch_compliance_draft(p_branch_id UUID,p_payload JSONB,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_user RECORD; v_branch RECORD; v_old_status TEXT; v_new_status TEXT; v_changed TEXT[];
BEGIN
  SELECT tenant_id,role::TEXT role,is_active INTO v_user FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_user.is_active OR v_user.role<>'owner' THEN RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id INTO v_branch FROM public.branches WHERE id=p_branch_id AND tenant_id=v_user.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  SELECT validation_status INTO v_old_status FROM public.branch_compliance_profiles WHERE branch_id=p_branch_id;
  v_new_status:=CASE WHEN v_old_status='verified' THEN 'revalidation_required' ELSE 'draft' END;
  INSERT INTO public.branch_compliance_profiles(branch_id,tenant_id,registered_seller_name,registered_seller_name_ar,vat_number,registration_scheme,registration_identifier,building_number,street,district,city,postal_code,country,validation_status,evidence_reference,verified_at,verified_by)
  VALUES(p_branch_id,v_branch.tenant_id,NULLIF(btrim(p_payload->>'registeredSellerName'),''),NULLIF(btrim(p_payload->>'registeredSellerNameAr'),''),NULLIF(btrim(p_payload->>'vatNumber'),''),COALESCE(NULLIF(btrim(p_payload->>'registrationScheme'),''),'CRN'),NULLIF(btrim(p_payload->>'registrationIdentifier'),''),NULLIF(btrim(p_payload->>'buildingNumber'),''),NULLIF(btrim(p_payload->>'street'),''),NULLIF(btrim(p_payload->>'district'),''),NULLIF(btrim(p_payload->>'city'),''),NULLIF(btrim(p_payload->>'postalCode'),''),COALESCE(NULLIF(btrim(p_payload->>'country'),''),'SA'),v_new_status,NULLIF(btrim(p_payload->>'evidenceReference'),''),NULL,NULL)
  ON CONFLICT(branch_id) DO UPDATE SET registered_seller_name=EXCLUDED.registered_seller_name,registered_seller_name_ar=EXCLUDED.registered_seller_name_ar,vat_number=EXCLUDED.vat_number,registration_scheme=EXCLUDED.registration_scheme,registration_identifier=EXCLUDED.registration_identifier,building_number=EXCLUDED.building_number,street=EXCLUDED.street,district=EXCLUDED.district,city=EXCLUDED.city,postal_code=EXCLUDED.postal_code,country=EXCLUDED.country,evidence_reference=EXCLUDED.evidence_reference,validation_status=v_new_status,verified_at=NULL,verified_by=NULL,updated_at=NOW();
  v_changed:=ARRAY['registered_seller_name','registered_seller_name_ar','vat_number','registration_scheme','registration_identifier','registered_address','evidence_reference'];
  PERFORM public.record_audit_event('branch_compliance_draft_saved',v_branch.tenant_id,p_branch_id,v_uid,v_user.role,'branch',p_branch_id,'warning','succeeded',jsonb_build_object('changed_fields',v_changed,'previous_status',COALESCE(v_old_status,'missing'),'new_status',v_new_status,'reason',NULLIF(btrim(p_reason),''),'credential_impact',CASE WHEN v_old_status='verified' THEN 'revalidation_required' ELSE 'not_evaluated' END),NULL,NULL);
  RETURN jsonb_build_object('ok',true,'status',v_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_branch_compliance_profile(p_branch_id UUID,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_user RECORD; v RECORD;
BEGIN
  SELECT tenant_id,role::TEXT role,is_active INTO v_user FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_user.is_active OR v_user.role<>'owner' THEN RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.branch_compliance_profiles WHERE branch_id=p_branch_id AND tenant_id=v_user.tenant_id FOR UPDATE;
  IF NOT FOUND OR v.validation_status NOT IN ('draft','revalidation_required') THEN RAISE EXCEPTION 'Profile is not ready for submission' USING ERRCODE='23514'; END IF;
  IF NULLIF(btrim(v.registered_seller_name),'') IS NULL OR COALESCE(v.vat_number,'') !~ '^3[0-9]{13}3$' OR NULLIF(btrim(v.registration_identifier),'') IS NULL OR NULLIF(btrim(v.building_number),'') IS NULL OR NULLIF(btrim(v.street),'') IS NULL OR NULLIF(btrim(v.district),'') IS NULL OR NULLIF(btrim(v.city),'') IS NULL OR COALESCE(v.postal_code,'') !~ '^[0-9]{5}$' OR v.registration_scheme NOT IN ('CRN','MOM','MLS','SAG','OTH') THEN RAISE EXCEPTION 'Official seller profile is incomplete' USING ERRCODE='23514'; END IF;
  UPDATE public.branch_compliance_profiles SET validation_status='needs_review',updated_at=NOW() WHERE branch_id=p_branch_id;
  PERFORM public.record_audit_event('branch_compliance_submitted',v.tenant_id,p_branch_id,v_uid,v_user.role,'branch',p_branch_id,'warning','succeeded',jsonb_build_object('previous_status',v.validation_status,'new_status','needs_review','reason',btrim(p_reason)),NULL,NULL);
  RETURN jsonb_build_object('ok',true,'status','needs_review');
END;
$$;

CREATE OR REPLACE FUNCTION public.review_branch_compliance_profile(p_branch_id UUID,p_decision TEXT,p_reason TEXT,p_confirmation BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_user RECORD; v RECORD; v_status TEXT;
BEGIN
  SELECT tenant_id,role::TEXT role,is_active INTO v_user FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_user.is_active OR v_user.role<>'owner' OR p_confirmation IS NOT TRUE THEN RAISE EXCEPTION 'Explicit owner confirmation required' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('verify','reject') OR NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Decision and reason are required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.branch_compliance_profiles WHERE branch_id=p_branch_id AND tenant_id=v_user.tenant_id FOR UPDATE;
  IF NOT FOUND OR v.validation_status<>'needs_review' THEN RAISE EXCEPTION 'Profile is not awaiting review' USING ERRCODE='23514'; END IF;
  v_status:=CASE WHEN p_decision='verify' THEN 'verified' ELSE 'rejected' END;
  UPDATE public.branch_compliance_profiles SET validation_status=v_status,verified_at=CASE WHEN v_status='verified' THEN NOW() ELSE NULL END,verified_by=CASE WHEN v_status='verified' THEN v_uid ELSE NULL END,updated_at=NOW() WHERE branch_id=p_branch_id;
  PERFORM public.record_audit_event('branch_compliance_'||v_status,v.tenant_id,p_branch_id,v_uid,v_user.role,'branch',p_branch_id,'warning','succeeded',jsonb_build_object('previous_status','needs_review','new_status',v_status,'reason',btrim(p_reason),'independent_reviewer',false),NULL,NULL);
  RETURN jsonb_build_object('ok',true,'status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_protected_identity_mode(p_branch_id UUID,p_reason TEXT,p_confirmation BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE v_uid UUID:=auth.uid(); v_user RECORD; v_branch RECORD;
BEGIN
  SELECT tenant_id,role::TEXT role,is_active INTO v_user FROM public.user_profiles WHERE id=v_uid;
  IF NOT FOUND OR NOT v_user.is_active OR v_user.role<>'owner' OR p_confirmation IS NOT TRUE OR NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Explicit owner confirmation and reason required' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id,compliance_identity_mode INTO v_branch FROM public.branches WHERE id=p_branch_id AND tenant_id=v_user.tenant_id FOR UPDATE;
  IF NOT FOUND OR v_branch.compliance_identity_mode<>'protected' THEN RAISE EXCEPTION 'Branch is not in protected mode' USING ERRCODE='23514'; END IF;
  UPDATE public.branches SET compliance_identity_mode='legacy',updated_at=NOW() WHERE id=p_branch_id;
  PERFORM public.record_audit_event('branch_compliance_identity_recovery',v_branch.tenant_id,p_branch_id,v_uid,v_user.role,'branch',p_branch_id,'critical','succeeded',jsonb_build_object('previous_mode','protected','new_mode','legacy','reason',btrim(p_reason),'issued_artifacts_changed',false),NULL,NULL);
  RETURN jsonb_build_object('ok',true,'mode','legacy');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_compliance_audit(p_branch_id UUID)
RETURNS SETOF public.audit_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
  SELECT a.* FROM public.audit_events a JOIN public.user_profiles u ON u.id=auth.uid()
  WHERE a.branch_id=p_branch_id AND a.tenant_id=u.tenant_id AND u.is_active
    AND (u.role::TEXT IN ('owner','admin') OR u.branch_id=p_branch_id)
    AND a.action LIKE 'branch_compliance_%' ORDER BY a.created_at DESC LIMIT 100;
$$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['save_branch_compliance_draft(uuid,jsonb,text)','submit_branch_compliance_profile(uuid,text)','review_branch_compliance_profile(uuid,text,text,boolean)','deactivate_protected_identity_mode(uuid,text,boolean)','get_branch_compliance_audit(uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
  END LOOP;
END $$;

COMMIT;
