import { useCallback, useEffect, useState } from 'react'
import {
  loadEffectiveBranchBillingConfig,
  type EffectiveBranchBillingConfig,
} from '@/lib/branches/billingProfile'

interface BranchBillingConfigState {
  config: EffectiveBranchBillingConfig | null
  loading: boolean
  error: Error | null
}

/**
 * Keeps branch configuration reads on the Phase 1 effective-config contract,
 * including the legacy NULL-profile precedence rules owned by the database.
 */
export function useBranchBillingConfig(branchId: string | null | undefined) {
  const [state, setState] = useState<BranchBillingConfigState>({
    config: null,
    loading: Boolean(branchId),
    error: null,
  })

  const reload = useCallback(async () => {
    if (!branchId) {
      setState({ config: null, loading: false, error: null })
      return null
    }

    setState(previous => ({ ...previous, loading: true, error: null }))
    try {
      const config = await loadEffectiveBranchBillingConfig(branchId)
      setState({ config, loading: false, error: null })
      return config
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      setState({ config: null, loading: false, error: normalizedError })
      return null
    }
  }, [branchId])

  useEffect(() => {
    let active = true
    if (!branchId) {
      setState({ config: null, loading: false, error: null })
      return undefined
    }

    setState(previous => ({ ...previous, loading: true, error: null }))
    void loadEffectiveBranchBillingConfig(branchId)
      .then(config => {
        if (active) setState({ config, loading: false, error: null })
      })
      .catch(error => {
        if (!active) return
        setState({
          config: null,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })

    return () => { active = false }
  }, [branchId])

  return { ...state, reload }
}
