import { isUuid } from './config.ts'

export interface OwnerContext {
  userId: string
  tenantId: string
}

export interface TenantUserContext extends OwnerContext {
  role: string
  branchId: string | null
}

export async function requireTenantUser(db: any, req: Request): Promise<TenantUserContext> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) throw new Error('Unauthorized')

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !user) throw new Error('Unauthorized')

  const { data: profile, error: profileErr } = await db
    .from('user_profiles')
    .select('id, tenant_id, branch_id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr || !profile?.tenant_id || profile.is_active === false) {
    throw new Error('Forbidden: active tenant user required')
  }

  return {
    userId: user.id,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id ?? null,
    role: profile.role,
  }
}

export async function requireTenantOwner(db: any, req: Request): Promise<OwnerContext> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) throw new Error('Unauthorized')

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !user) throw new Error('Unauthorized')

  const { data: profile, error: profileErr } = await db
    .from('user_profiles')
    .select('id, tenant_id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr || !profile?.tenant_id || profile.role !== 'owner' || profile.is_active === false) {
    throw new Error('Forbidden: tenant owner role required')
  }

  return { userId: user.id, tenantId: profile.tenant_id }
}

export async function loadOwnedBranch(db: any, branchId: string, tenantId: string, userBranchId?: string | null): Promise<any> {
  if (!isUuid(branchId)) throw new Error('Invalid branch')
  if (userBranchId && branchId !== userBranchId) throw new Error('Branch not found or access denied')

  const { data: branch, error } = await db
    .from('branches')
    .select(`
      id, tenant_id, name, business_name, vat_number, cr_number,
      building_number, street, district, city, postal_code, country,
      zatca_phase, is_active
    `)
    .eq('id', branchId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error || !branch || branch.is_active === false) {
    throw new Error('Branch not found or access denied')
  }

  return branch
}

export async function loadTenant(db: any, tenantId: string): Promise<any> {
  const { data: tenant, error } = await db
    .from('tenants')
    .select(`
      id, name, vat_number, cr_number,
      building_number, street, district, city, postal_code, country
    `)
    .eq('id', tenantId)
    .maybeSingle()

  if (error || !tenant) throw new Error('Tenant not found')
  return tenant
}
