/** Presentation names for the two commercial subscription tiers.
 * Database names remain Phase 1 / Phase 2 for billing and historical data.
 */
export function displayCommercialPlanName(name: string | null | undefined): string {
  if (name === 'Phase 1') return 'Plan A'
  if (name === 'Phase 2') return 'Plan B'
  return name ?? '—'
}

export function commercialPlanTone(name: string | null | undefined): string {
  return name === 'Phase 2' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'
}
