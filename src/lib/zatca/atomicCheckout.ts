import { supabase } from '@/lib/supabase'
import { ZATCA_FINALIZATION_CLIENT_VERSION } from '@/lib/zatca/submission'
import {
  atomicCheckoutStorageKey,
  pendingAtomicCheckoutMatchesScope,
} from '@/lib/zatca/atomicCheckoutScope.mjs'

export type AtomicCheckoutDocumentType = 'invoice' | 'credit_note'

export interface AtomicReceiptItem {
  product_id: string | null
  original_invoice_item_id?: string | null
  name: string
  name_ar: string | null
  sku?: string | null
  unit: string | null
  quantity: number | string
  unit_price: number | string
  discount_percent?: number | string
  discount_amount: number | string
  subtotal: number | string
  tax_rate: number | string
  tax_category: string | null
  tax_amount: number | string
  total: number | string
  sort_order?: number
}

export interface AtomicReceiptPayment {
  method: string
  amount: number | string
  amount_received: number | string | null
  change_amount: number | string | null
}

export interface AtomicReceiptPayload {
  invoice_id: string
  invoice_number: string
  invoice_uuid: string
  created_at: string
  subtotal: number | string
  discount_amount: number | string
  taxable_amount: number | string
  tax_amount: number | string
  total: number | string
  currency_code: string
  payment_method: string
  payment_status: string
  zatca_invoice_type: string
  zatca_type_code: string
  original_invoice_id?: string | null
  invoice_reference?: string | null
  credit_reason?: string | null
  document_language?: string | null
  items: AtomicReceiptItem[]
  payments: AtomicReceiptPayment[]
  seller: Record<string, unknown>
  customer: Record<string, unknown> | null
  zatca_counter_number: number
  previous_hash: string
  cart_fingerprint: string
  qr_code: string
  can_print: true
  reporting_display_state: string
  finalization_status: string
  artifact_stage: 'simplified_final'
  document_kind: 'simplified'
  outbox_id: string
  transaction_committed_at: string
}

export interface AtomicCheckoutResult {
  status: 'committed'
  invoiceStatus: string
  finalizationStatus: string
  artifactStage: 'simplified_final'
  documentKind: 'simplified'
  reportingDisplayState: string
  canPrint: true
  receipt: AtomicReceiptPayload
  idempotentReplay: boolean
}

export interface AtomicCheckoutLegacyRequired {
  status: 'legacy_required'
  reason:
    | 'atomic_rollout_disabled'
    | 'atomic_branch_not_ready'
    | 'existing_legacy_idempotency'
}

export interface PendingAtomicCheckout {
  idempotencyKey: string
  cartFingerprint: string
  documentType: AtomicCheckoutDocumentType
  checkout: Record<string, unknown>
  scopeId?: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

export function stableCheckoutJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export async function atomicCheckoutFingerprint(payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(stableCheckoutJson(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function persistPendingAtomicCheckout(
  branchId: string,
  pending: PendingAtomicCheckout,
  scopeId?: string,
): void {
  const scopedPending = scopeId
    ? { ...pending, scopeId }
    : pending
  localStorage.setItem(
    atomicCheckoutStorageKey(branchId, pending.documentType, scopeId),
    JSON.stringify(scopedPending),
  )
}

export function readPendingAtomicCheckout(
  branchId: string,
  documentType: AtomicCheckoutDocumentType = 'invoice',
  scopeId?: string,
): PendingAtomicCheckout | null {
  try {
    const raw = localStorage.getItem(
      atomicCheckoutStorageKey(branchId, documentType, scopeId),
    )
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingAtomicCheckout>
    if (typeof parsed.idempotencyKey !== 'string'
        || !/^[a-f0-9]{64}$/.test(parsed.cartFingerprint ?? '')
        || !['invoice', 'credit_note'].includes(parsed.documentType ?? '')
        || !parsed.checkout || typeof parsed.checkout !== 'object'
        || Array.isArray(parsed.checkout)
        || !pendingAtomicCheckoutMatchesScope(parsed, documentType, scopeId)) return null
    return parsed as PendingAtomicCheckout
  } catch {
    return null
  }
}

export function clearPendingAtomicCheckout(
  branchId: string,
  idempotencyKey: string,
  cartFingerprint: string,
  documentType: AtomicCheckoutDocumentType = 'invoice',
  scopeId?: string,
): void {
  const pending = readPendingAtomicCheckout(branchId, documentType, scopeId)
  if (!pending
      || pending.idempotencyKey !== idempotencyKey
      || pending.cartFingerprint !== cartFingerprint) return
  localStorage.removeItem(
    atomicCheckoutStorageKey(branchId, documentType, scopeId),
  )
}

export async function checkoutSimplifiedAtomically(params: {
  branchId: string
  checkout: Record<string, unknown>
  cartFingerprint: string
  documentType?: AtomicCheckoutDocumentType
}): Promise<AtomicCheckoutResult | AtomicCheckoutLegacyRequired> {
  const documentType = params.documentType ?? 'invoice'
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: {
      action: documentType === 'credit_note'
        ? 'checkout_simplified_credit_note'
        : 'checkout_simplified',
      branchId: params.branchId,
      checkout: params.checkout,
      cartFingerprint: params.cartFingerprint,
      clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
      source: documentType === 'credit_note' ? 'auto_credit_note' : 'auto_checkout',
    },
  })
  if (error) throw new Error(error.message)
  if (data?.status === 'legacy_required'
      && (data?.reason === 'atomic_rollout_disabled'
        || data?.reason === 'atomic_branch_not_ready'
        || data?.reason === 'existing_legacy_idempotency')) {
    return data as AtomicCheckoutLegacyRequired
  }
  if (data?.status !== 'committed'
      || !data?.receipt?.invoice_id
      || !data?.receipt?.qr_code
      || data?.receipt?.can_print !== true) {
    throw new Error(typeof data?.error === 'string'
      ? data.error
      : 'Atomic simplified checkout did not return a printable receipt')
  }
  return data as AtomicCheckoutResult
}
