import { supabase } from '@/lib/supabase'

export type OwnerSetupCompletionSource = 'password_update' | 'owner_profile_load'

export interface OwnerSetupCompletionResult {
  tenant_id: string
  onboarding_status: string
  owner_setup_status: string
  owner_setup_completed_at: string | null
  already_completed: boolean
}

interface MarkOwnerSetupCompleteOptions {
  knownOwner?: boolean
}

export async function markOwnerSetupCompleteSilently(
  source: OwnerSetupCompletionSource,
  options: MarkOwnerSetupCompleteOptions = {}
) {
  try {
    if (!options.knownOwner) {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) return null

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role, tenant_id, is_active')
        .eq('id', userData.user.id)
        .maybeSingle()

      if (profileError) {
        console.warn('[ownerSetupCompletion] profile check failed', {
          source,
          code: profileError.code,
        })
        return null
      }

      if (profile?.role !== 'owner' || !profile.tenant_id || profile.is_active === false) {
        return null
      }
    }

    const { data, error } = await (supabase as any).rpc('mark_owner_setup_complete')
    if (error) {
      console.warn('[ownerSetupCompletion] tracking update failed', {
        source,
        code: error.code,
      })
      return null
    }

    return ((data ?? [])[0] ?? null) as OwnerSetupCompletionResult | null
  } catch {
    console.warn('[ownerSetupCompletion] tracking request failed safely', { source })
    return null
  }
}
