-- ============================================================
-- Dafra — Super Admin Seed
-- Creates the platform super admin in Supabase Auth + user_profiles.
--
-- BEFORE RUNNING:
--   Replace REPLACE_WITH_YOUR_PASSWORD below with a strong password.
--
-- This script is idempotent: safe to run more than once.
-- Must be run as the postgres (service-role) user — not anon.
-- ============================================================

DO $$
DECLARE
  v_email    TEXT := 'vvmshahi@gmail.com';
  v_password TEXT := 'REPLACE_WITH_YOUR_PASSWORD';   -- ← change this
  v_name     TEXT := 'Super Admin';
  v_user_id  UUID;
BEGIN

  -- ── 1. Create the auth.users row (only if email doesn't exist) ──────────

  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object(
        'full_name', v_name,
        'role',      'super_admin'
      ),
      FALSE,
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Created auth user: % (id: %)', v_email, v_user_id;
  ELSE
    RAISE NOTICE 'Auth user already exists: % (id: %)', v_email, v_user_id;
  END IF;

  -- ── 2. Create the auth.identities row (only if missing) ─────────────────
  --
  -- Required for email/password sign-in to work.
  -- Without this row the account exists but login is rejected by GoTrue.

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      v_email,
      jsonb_build_object(
        'sub',   v_user_id::TEXT,
        'email', v_email
      ),
      'email',
      NOW(),
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Created identity for: %', v_email;
  END IF;

  -- ── 3. Upsert user_profile with role = super_admin ──────────────────────
  --
  -- The handle_new_user trigger creates the profile automatically on INSERT.
  -- This upsert handles both cases:
  --   a) trigger already ran (new user)   → updates role to super_admin
  --   b) user pre-existed, no profile     → inserts it fresh

  INSERT INTO public.user_profiles (id, full_name, role)
  VALUES (v_user_id, v_name, 'super_admin')
  ON CONFLICT (id) DO UPDATE
    SET role      = 'super_admin',
        full_name = EXCLUDED.full_name,
        is_active = TRUE;

  RAISE NOTICE 'Super admin ready — email: %, id: %', v_email, v_user_id;

END $$;
