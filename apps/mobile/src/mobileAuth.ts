import { createClient, type Session } from '@supabase/supabase-js'

export type AuthRole = 'owner' | 'branch'
export interface MobileProfile {
  id: string
  role: AuthRole
  tenantId: string
  branchId: string | null
  fullName: string
  active: boolean
  branchName?: string
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const authConfigured = Boolean(url && key)
const client = authConfigured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'kubri-mobile-auth-v1' },
}) : null

const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

export async function signIn(identifier: string, password: string): Promise<MobileProfile> {
  if (!client) throw new Error('Mobile authentication is not configured for this build.')
  let email = identifier.trim()
  if (!email.includes('@')) {
    const { data, error } = await client.functions.invoke('resolve-branch-username', {
      body: { username: normalizeUsername(email) },
    })
    if (error || data?.ok !== true || typeof data.authEmail !== 'string') {
      throw new Error('The email, username, or password is incorrect.')
    }
    email = data.authEmail
  }
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error('The email, username, or password is incorrect.')
  return loadProfile(data.session)
}

export async function loadProfile(session: Session): Promise<MobileProfile> {
  if (!client) throw new Error('Authentication is unavailable.')
  const { data, error } = await client.from('user_profiles')
    .select('id,tenant_id,branch_id,role,full_name,is_active').eq('id', session.user.id).maybeSingle()
  if (error || !data) throw new Error('We could not verify this account.')
  if (data.is_active === false) throw new Error('This account is not active.')
  if (data.role === 'super_admin') throw new Error('Super Admin accounts must use the Kubri web workspace.')
  if (data.role !== 'owner' && data.role !== 'branch') throw new Error('This account type is unavailable on mobile.')
  if (!data.tenant_id) throw new Error('This account is not linked to a business.')
  const { data: tenant } = await client.from('tenants').select('is_active,suspended_at').eq('id', data.tenant_id).maybeSingle()
  if (!tenant?.is_active || tenant.suspended_at) throw new Error('This business account is suspended. Contact Kubri support.')
  let branchName: string | undefined
  if (data.role === 'branch') {
    if (!data.branch_id) throw new Error('Branch access could not be verified.')
    const { data: branch } = await client.from('branches').select('name,is_active').eq('id', data.branch_id).maybeSingle()
    if (!branch?.is_active) throw new Error('This branch is not active.')
    branchName = branch.name
  }
  return { id:data.id, role:data.role, tenantId:data.tenant_id, branchId:data.branch_id, fullName:data.full_name||'Kubri user', active:true, branchName }
}

export async function restoreSession() {
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session ? loadProfile(data.session) : null
}

export async function signOut() {
  await client?.auth.signOut()
}
