#!/usr/bin/env node

/**
 * One-time, backend-only provisioning for Kubri's permanent ZATCA Sandbox demo.
 *
 * This script creates only the Auth owner, profile, tenant, and two Sandbox
 * branches. It never accepts an OTP, creates ZATCA credentials, calls a ZATCA
 * endpoint, or invokes zatca-onboard-sandbox-demo.
 *
 * The repository's internal scripts use .mjs so this file can run directly on
 * the supported Node.js runtime without adding a TypeScript runner dependency.
 */

import { createClient } from '@supabase/supabase-js'

const IDENTITY = Object.freeze({
  owner: Object.freeze({
    email: 'demo@kubri.shop',
    displayName: 'Kubri Demo Owner',
  }),
  tenant: Object.freeze({
    workspaceName: 'Kubri Demo',
    legalNameAr: 'مؤسسة كوبري التجريبية للتجارة والخدمات',
    legalNameEn: 'Kubri Demo Establishment for Trading and Services',
  }),
  seller: Object.freeze({
    vatNumber: '310000000000003',
    crNumber: '1010000000',
    buildingNumber: '1234',
    streetAr: 'شارع الاختبار',
    streetEn: 'Test Street',
    districtAr: 'حي التجربة',
    districtEn: 'Demo District',
    cityAr: 'الرياض',
    cityEn: 'Riyadh',
    postalCode: '12345',
    countryCode: 'SA',
  }),
  branches: Object.freeze([
    Object.freeze({
      kind: 'trading',
      name: 'Kubri Trading Demo',
      nameAr: 'فرع كوبري التجريبي للتجارة',
      code: 'KUBRI-TRADING-DEMO',
      invoicePrefix: 'TRD',
      isMain: true,
      stockEnabled: true,
    }),
    Object.freeze({
      kind: 'service',
      name: 'Kubri Service Demo',
      nameAr: 'فرع كوبري التجريبي للخدمات',
      code: 'KUBRI-SERVICE-DEMO',
      invoicePrefix: 'SRV',
      isMain: false,
      stockEnabled: false,
    }),
  ]),
})

const REQUIRED_CONFIRMATION = 'KUBRI_DEMO_SANDBOX_ONLY'
const DRY_RUN = parseDryRun(process.env.DRY_RUN)
const SUPABASE_URL = requireEnvironment('SUPABASE_URL')
const SERVICE_ROLE_KEY = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY')
const OWNER_PASSWORD = requireEnvironment('KUBRI_DEMO_OWNER_PASSWORD')

validateConfiguration()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})

const created = {
  authUserId: null,
  tenantId: null,
  branchIds: [],
}

let ownerSessionClient = null

try {
  await validateRemoteSchema()
  await validatePreconditions()

  if (DRY_RUN) {
    printDryRunPlan()
  } else {
    requireRealRunConfirmation()
    await provision()
  }
} catch (error) {
  if (!DRY_RUN && hasCreatedRecords()) {
    await cleanupCreatedRecords()
  }
  console.error(`[provision-zatca-demo-tenant] FAILED: ${safeErrorMessage(error)}`)
  process.exitCode = 1
} finally {
  if (ownerSessionClient) {
    await ownerSessionClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}

function parseDryRun(value) {
  if (value === undefined || value.trim() === '') return true
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('DRY_RUN must be true or false')
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function validateConfiguration() {
  let parsedUrl
  try {
    parsedUrl = new URL(SUPABASE_URL)
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL')
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must use HTTPS')
  }
  if (SERVICE_ROLE_KEY.length < 20) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is malformed')
  }
  if (OWNER_PASSWORD.length < 8) {
    throw new Error('KUBRI_DEMO_OWNER_PASSWORD must contain at least 8 characters')
  }
  if (!/^3\d{13}3$/.test(IDENTITY.seller.vatNumber)) {
    throw new Error('The Sandbox VAT fixture must be 15 digits, starting and ending with 3')
  }
  if (!/^\d{10}$/.test(IDENTITY.seller.crNumber)) throw new Error('The CR/license fixture is invalid')
  if (!/^\d{4}$/.test(IDENTITY.seller.buildingNumber)) throw new Error('The building number is invalid')
  if (!/^\d{5}$/.test(IDENTITY.seller.postalCode)) throw new Error('The postal code is invalid')
  if (!/^[A-Z]{2}$/.test(IDENTITY.seller.countryCode)) throw new Error('The country code is invalid')
  if (new Set(IDENTITY.branches.map(branch => branch.code)).size !== IDENTITY.branches.length) {
    throw new Error('Branch codes must be unique')
  }
}

async function validateRemoteSchema() {
  await assertQuery('tenants schema', admin.from('tenants').select(`
    id,name,name_ar,vat_number,cr_number,email,business_type,address,address_ar,
    building_number,street,street_ar,district,district_ar,city,city_ar,country,
    postal_code,is_active,is_demo,max_branches
  `).limit(0))

  await assertQuery('branches schema', admin.from('branches').select(`
    id,tenant_id,name,name_ar,branch_code,business_name,business_name_ar,
    vat_number,cr_number,email,address,address_ar,building_number,street,street_ar,
    district,district_ar,city,city_ar,country,postal_code,is_main_branch,is_active,
    vat_mode,invoice_prefix,invoice_language,zatca_phase,zatca_environment,
    pos_mode,stock_enabled,allow_split_payments,show_pos_scroll_buttons
  `).limit(0))

  await assertQuery('user_profiles schema', admin.from('user_profiles').select(
    'id,tenant_id,branch_id,role,email,full_name,is_active',
  ).limit(0))
  await assertQuery('production credential schema', admin.from('zatca_production_credentials').select(
    'id,tenant_id,branch_id',
  ).limit(0))
  await assertQuery('Sandbox credential schema', admin.from('zatca_sandbox_credentials').select(
    'id,tenant_id,branch_id',
  ).limit(0))

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: 'application/openapi+json',
    },
  })
  if (!response.ok) throw new Error(`PostgREST schema discovery failed with HTTP ${response.status}`)
  const openApi = await response.json()
  if (!openApi?.paths?.['/rpc/mark_demo_tenant_secure']) {
    throw new Error('Required Phase 5Q RPC mark_demo_tenant_secure is not available')
  }
}

async function validatePreconditions() {
  const { data: demos, error: demoError } = await admin
    .from('tenants')
    .select('id,name')
    .eq('is_demo', true)
    .limit(2)
  if (demoError) throw demoError
  if ((demos ?? []).length > 0) throw new Error('A permanent demo tenant already exists')

  const { data: vatRows, error: vatError } = await admin
    .from('tenants')
    .select('id')
    .eq('vat_number', IDENTITY.seller.vatNumber)
    .limit(1)
  if (vatError) throw vatError
  if ((vatRows ?? []).length > 0) throw new Error('The Sandbox VAT fixture is already assigned to a tenant')

  const { data: profiles, error: profileError } = await admin
    .from('user_profiles')
    .select('id')
    .ilike('email', IDENTITY.owner.email)
    .limit(1)
  if (profileError) throw profileError
  if ((profiles ?? []).length > 0) throw new Error('The demo owner email is already present in user_profiles')

  if (await authEmailExists(IDENTITY.owner.email)) {
    throw new Error('The demo owner email is already in use by Auth')
  }
}

async function authEmailExists(email) {
  const normalized = email.toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    if (users.some(user => user.email?.toLowerCase() === normalized)) return true
    if (users.length < perPage) return false
  }
  throw new Error('Auth email uniqueness scan exceeded the safe pagination limit')
}

function printDryRunPlan() {
  console.log('[provision-zatca-demo-tenant] DRY RUN PASSED — no records were changed.')
  console.log('[provision-zatca-demo-tenant] Validated: schema, Phase 5Q RPC, fixed fixture, demo uniqueness, VAT uniqueness, and owner email uniqueness.')
  console.log('[provision-zatca-demo-tenant] Planned order: Auth owner → tenant (zero branches) → demo marker RPC → two Sandbox branches → owner profile → access/isolation verification.')
  console.log('[provision-zatca-demo-tenant] Planned records: 1 Auth owner, 1 owner profile, 1 demo tenant, 2 Sandbox branches; 0 ZATCA credentials.')
}

function requireRealRunConfirmation() {
  if (process.env.PROVISION_ZATCA_DEMO_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(`Real provisioning requires PROVISION_ZATCA_DEMO_CONFIRM=${REQUIRED_CONFIRMATION}`)
  }
}

async function provision() {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: IDENTITY.owner.email,
    password: OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: IDENTITY.owner.displayName,
      role: 'owner',
      provisioning_source: 'kubri_zatca_sandbox_demo',
    },
  })
  if (authError || !authData?.user) throw authError ?? new Error('Auth owner was not created')
  created.authUserId = authData.user.id

  const tenantPayload = tenantInsertPayload()
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert(tenantPayload)
    .select('id,is_demo')
    .single()
  if (tenantError || !tenant) throw tenantError ?? new Error('Tenant was not created')
  created.tenantId = tenant.id

  const { count: initialBranchCount, error: initialBranchError } = await admin
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
  if (initialBranchError) throw initialBranchError
  if (initialBranchCount !== 0) throw new Error('The new tenant did not have zero branches before demo marking')

  const { data: marked, error: markError } = await admin.rpc('mark_demo_tenant_secure', {
    p_tenant_id: tenant.id,
    p_is_demo: true,
  })
  if (markError) throw markError
  if (marked?.ok !== true || marked?.tenant_id !== tenant.id || marked?.is_demo !== true) {
    throw new Error('Phase 5Q did not confirm the tenant demo marker')
  }

  for (const branchFixture of IDENTITY.branches) {
    const { data: branch, error: branchError } = await admin
      .from('branches')
      .insert(branchInsertPayload(tenant.id, branchFixture))
      .select('id,tenant_id,zatca_environment,vat_number')
      .single()
    if (branchError || !branch) throw branchError ?? new Error(`The ${branchFixture.kind} branch was not created`)
    created.branchIds.push(branch.id)
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .upsert({
      id: created.authUserId,
      tenant_id: tenant.id,
      branch_id: null,
      role: 'owner',
      email: IDENTITY.owner.email,
      full_name: IDENTITY.owner.displayName,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select('id,tenant_id,branch_id,role,email,is_active')
    .single()
  if (profileError || !profile) throw profileError ?? new Error('Owner profile was not linked')

  await verifyProvisionedState(tenant.id)
  await verifyOwnerRlsAccess()

  console.log('[provision-zatca-demo-tenant] Provisioning completed successfully.')
  console.log(`[provision-zatca-demo-tenant] Tenant: ${tenant.id}`)
  console.log(`[provision-zatca-demo-tenant] Branches: ${created.branchIds.join(', ')}`)
  console.log('[provision-zatca-demo-tenant] ZATCA credentials created: 0')
}

function tenantInsertPayload() {
  const seller = IDENTITY.seller
  return {
    name: IDENTITY.tenant.workspaceName,
    name_ar: IDENTITY.tenant.legalNameAr,
    vat_number: seller.vatNumber,
    cr_number: seller.crNumber,
    email: IDENTITY.owner.email,
    business_type: 'trading',
    address: `${seller.buildingNumber}, ${seller.streetEn}, ${seller.districtEn}, ${seller.cityEn} ${seller.postalCode}, ${seller.countryCode}`,
    address_ar: `${seller.buildingNumber}، ${seller.streetAr}، ${seller.districtAr}، ${seller.cityAr} ${seller.postalCode}، ${seller.countryCode}`,
    building_number: seller.buildingNumber,
    street: seller.streetEn,
    street_ar: seller.streetAr,
    district: seller.districtEn,
    district_ar: seller.districtAr,
    city: seller.cityEn,
    city_ar: seller.cityAr,
    country: seller.countryCode,
    postal_code: seller.postalCode,
    is_active: true,
    is_demo: false,
    max_branches: 2,
  }
}

function branchInsertPayload(tenantId, branch) {
  const seller = IDENTITY.seller
  return {
    tenant_id: tenantId,
    name: branch.name,
    name_ar: branch.nameAr,
    branch_code: branch.code,
    business_name: IDENTITY.tenant.legalNameEn,
    business_name_ar: IDENTITY.tenant.legalNameAr,
    vat_number: seller.vatNumber,
    cr_number: seller.crNumber,
    email: IDENTITY.owner.email,
    address: `${seller.buildingNumber}, ${seller.streetEn}, ${seller.districtEn}, ${seller.cityEn} ${seller.postalCode}, ${seller.countryCode}`,
    address_ar: `${seller.buildingNumber}، ${seller.streetAr}، ${seller.districtAr}، ${seller.cityAr} ${seller.postalCode}، ${seller.countryCode}`,
    building_number: seller.buildingNumber,
    street: seller.streetEn,
    street_ar: seller.streetAr,
    district: seller.districtEn,
    district_ar: seller.districtAr,
    city: seller.cityEn,
    city_ar: seller.cityAr,
    country: seller.countryCode,
    postal_code: seller.postalCode,
    is_main_branch: branch.isMain,
    is_active: true,
    vat_mode: 'exclusive',
    invoice_prefix: branch.invoicePrefix,
    invoice_language: 'both',
    zatca_phase: 2,
    zatca_environment: 'sandbox',
    pos_mode: 'touch',
    stock_enabled: branch.stockEnabled,
    allow_split_payments: false,
    show_pos_scroll_buttons: false,
  }
}

async function verifyProvisionedState(tenantId) {
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id,name,name_ar,vat_number,cr_number,is_demo,is_active,max_branches')
    .eq('id', tenantId)
    .single()
  if (tenantError || !tenant) throw tenantError ?? new Error('Provisioned tenant could not be verified')
  if (!tenant.is_demo || !tenant.is_active || tenant.vat_number !== IDENTITY.seller.vatNumber) {
    throw new Error('Provisioned tenant identity or demo state did not verify')
  }

  const { data: branches, error: branchError } = await admin
    .from('branches')
    .select(`
      id,tenant_id,name,name_ar,business_name,business_name_ar,vat_number,cr_number,
      building_number,street,street_ar,district,district_ar,city,city_ar,postal_code,
      country,zatca_phase,zatca_environment,is_active,stock_enabled
    `)
    .eq('tenant_id', tenantId)
    .order('name')
  if (branchError) throw branchError
  if ((branches ?? []).length !== 2) throw new Error('Exactly two demo branches were not found')
  for (const branch of branches) {
    if (
      branch.zatca_environment !== 'sandbox' || branch.zatca_phase !== 2 || !branch.is_active ||
      branch.vat_number !== IDENTITY.seller.vatNumber || branch.cr_number !== IDENTITY.seller.crNumber ||
      branch.business_name !== IDENTITY.tenant.legalNameEn ||
      branch.business_name_ar !== IDENTITY.tenant.legalNameAr ||
      branch.building_number !== IDENTITY.seller.buildingNumber ||
      branch.country !== IDENTITY.seller.countryCode
    ) {
      throw new Error('A demo branch failed identity or Sandbox verification')
    }
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id,tenant_id,branch_id,role,email,is_active')
    .eq('id', created.authUserId)
    .single()
  if (profileError || !profile) throw profileError ?? new Error('Owner profile could not be verified')
  if (
    profile.tenant_id !== tenantId || profile.branch_id !== null || profile.role !== 'owner' ||
    profile.email !== IDENTITY.owner.email || !profile.is_active
  ) {
    throw new Error('Owner tenant-wide access profile did not verify')
  }

  const [productionCredentials, sandboxCredentials] = await Promise.all([
    admin.from('zatca_production_credentials').select('id').eq('tenant_id', tenantId),
    admin.from('zatca_sandbox_credentials').select('id').eq('tenant_id', tenantId),
  ])
  if (productionCredentials.error) throw productionCredentials.error
  if (sandboxCredentials.error) throw sandboxCredentials.error
  if ((productionCredentials.data ?? []).length !== 0) throw new Error('Unexpected production credential exists')
  if ((sandboxCredentials.data ?? []).length !== 0) throw new Error('Unexpected Sandbox credential exists')
}

async function verifyOwnerRlsAccess() {
  ownerSessionClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data: signIn, error: signInError } = await ownerSessionClient.auth.signInWithPassword({
    email: IDENTITY.owner.email,
    password: OWNER_PASSWORD,
  })
  if (signInError || !signIn?.session) throw signInError ?? new Error('Owner session could not be verified')

  const { data: visibleBranches, error: accessError } = await ownerSessionClient
    .from('branches')
    .select('id')
    .eq('tenant_id', created.tenantId)
  if (accessError) throw accessError
  const visibleIds = new Set((visibleBranches ?? []).map(branch => branch.id))
  if (created.branchIds.some(branchId => !visibleIds.has(branchId))) {
    throw new Error('Owner RLS access did not include both demo branches')
  }

  await ownerSessionClient.auth.signOut({ scope: 'local' })
  ownerSessionClient = null
}

async function assertQuery(label, query) {
  const { error } = await query
  if (error) throw new Error(`${label} validation failed: ${error.message}`)
}

function hasCreatedRecords() {
  return Boolean(created.authUserId || created.tenantId || created.branchIds.length)
}

async function cleanupCreatedRecords() {
  console.error('[provision-zatca-demo-tenant] Provisioning failed; cleaning up only records created by this run.')
  const cleanupErrors = []

  if (created.tenantId && created.branchIds.length > 0) {
    const { error } = await admin
      .from('branches')
      .delete()
      .eq('tenant_id', created.tenantId)
      .in('id', created.branchIds)
    if (error) cleanupErrors.push(`branches: ${error.message}`)
  }

  if (created.tenantId) {
    const { error } = await admin.from('tenants').delete().eq('id', created.tenantId)
    if (error) cleanupErrors.push(`tenant: ${error.message}`)
  }

  if (created.authUserId) {
    const { error } = await admin.auth.admin.deleteUser(created.authUserId)
    if (error) cleanupErrors.push(`Auth owner: ${error.message}`)
  }

  if (cleanupErrors.length > 0) {
    console.error(`[provision-zatca-demo-tenant] CLEANUP INCOMPLETE: ${safeErrorMessage(cleanupErrors.join('; '))}`)
  } else {
    console.error('[provision-zatca-demo-tenant] Cleanup completed.')
  }
}

function safeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replaceAll(SERVICE_ROLE_KEY, '[REDACTED]')
    .replaceAll(OWNER_PASSWORD, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}
