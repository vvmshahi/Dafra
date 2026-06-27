import type { FunctionalityMap } from './config.ts'

export type ComplianceSampleType =
  | 'simplified_invoice'
  | 'simplified_credit_note'
  | 'simplified_debit_note'
  | 'standard_invoice'
  | 'standard_credit_note'
  | 'standard_debit_note'

export interface ComplianceSampleResult {
  type: ComplianceSampleType
  status: 'accepted' | 'pending' | 'blocked'
  dryRun?: boolean
  message?: string
}

const SIMPLIFIED: ComplianceSampleType[] = [
  'simplified_invoice',
  'simplified_credit_note',
  'simplified_debit_note',
]

const STANDARD: ComplianceSampleType[] = [
  'standard_invoice',
  'standard_credit_note',
  'standard_debit_note',
]

export function requiredComplianceSamples(map: FunctionalityMap): ComplianceSampleType[] {
  if (map === '0100') return SIMPLIFIED
  if (map === '1000') return STANDARD
  return [...STANDARD, ...SIMPLIFIED]
}

export function simulatedComplianceResults(map: FunctionalityMap): ComplianceSampleResult[] {
  return requiredComplianceSamples(map).map(type => ({
    type,
    status: 'accepted',
    dryRun: true,
  }))
}

// TODO Phase 2B:
// 1. Build valid signed UBL samples for invoice, credit note, and debit note.
// 2. Cover simplified and standard variants according to functionalityMap.
// 3. Sign each sample with the compliance certificate and generated private key.
// 4. POST each accepted sample to /core/compliance/invoices.
// 5. Return accepted/blocked results without raw XML or ZATCA response bodies.
export async function submitComplianceSamples(): Promise<ComplianceSampleResult[]> {
  throw new Error(
    'Compliance sample document generation/submission is not implemented yet. The final production credential request was not made.',
  )
}
