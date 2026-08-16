import { ZATCA_FINALIZATION_CLIENT_VERSION } from '@/lib/zatca/submission'
import { invokeAuthenticatedZatca } from '@/lib/zatca/authenticatedEdge'
import {
  CREDIT_NOTE_SCOPE_MIGRATION_KEY,
  atomicCheckoutStorageKey,
  removeObsoleteCreditNoteStorageEntries,
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
  product_unit_id?: string | null
  product_unit_version?: number | null
  selling_unit_name?: string | null
  selling_unit_name_ar?: string | null
  selling_unit_code?: string | null
  package_quantity?: number | string | null
  package_quantity_scale?: number | null
  conversion_to_base?: number | string | null
  base_quantity?: number | string | null
  base_unit_name?: string | null
  base_unit_name_ar?: string | null
  base_unit_code?: string | null
  base_quantity_scale?: number | null
  package_pricing_method?: 'calculated' | 'custom' | null
  base_unit_price?: number | string | null
  package_unit_price?: number | string | null
  stock_tracked_at_sale?: boolean | null
  service_item_at_sale?: boolean | null
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
  branchId?: string
}

export interface PendingAtomicCheckoutInspection {
  pending: PendingAtomicCheckout | null
  storageKey: string
  storageScope: string
  storedOriginalInvoiceId: string | null
  accepted: boolean
  rejectedReason:
    | 'invalid_json'
    | 'invalid_payload'
    | 'document_mismatch'
    | 'identity_mismatch'
    | null
  removed: boolean
  migrated: boolean
}

export interface ObsoleteCreditNoteCleanupResult {
  localStorageKeys: string[]
  sessionStorageKeys: string[]
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
    ? { ...pending, scopeId, branchId }
    : pending
  localStorage.setItem(
    atomicCheckoutStorageKey(branchId, pending.documentType, scopeId),
    JSON.stringify(scopedPending),
  )
}

function storageScope(
  branchId: string,
  documentType: AtomicCheckoutDocumentType,
  scopeId?: string,
): string {
  return `${branchId}:${documentType}:${scopeId ?? 'branch'}`
}

function storedOriginalInvoiceId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const originalInvoiceId = (value as Record<string, unknown>).original_invoice_id
  return typeof originalInvoiceId === 'string' ? originalInvoiceId : null
}

function removeExactPendingKey(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function cleanupObsoleteCreditNotePendingCheckouts(): ObsoleteCreditNoteCleanupResult {
  const result: ObsoleteCreditNoteCleanupResult = {
    localStorageKeys: [],
    sessionStorageKeys: [],
  }
  try {
    result.localStorageKeys = removeObsoleteCreditNoteStorageEntries(localStorage)
    localStorage.setItem(CREDIT_NOTE_SCOPE_MIGRATION_KEY, 'invoice-id-scope-v1')
  } catch {
    // Storage can be unavailable in private browsing. The scoped read remains fail-closed.
  }
  try {
    result.sessionStorageKeys = removeObsoleteCreditNoteStorageEntries(sessionStorage)
  } catch {
    // Session storage cleanup is best-effort and never affects POS invoice state.
  }
  return result
}

export function inspectPendingAtomicCheckout(
  branchId: string,
  documentType: AtomicCheckoutDocumentType = 'invoice',
  scopeId?: string,
): PendingAtomicCheckoutInspection {
  const key = atomicCheckoutStorageKey(branchId, documentType, scopeId)
  const base = {
    storageKey: key,
    storageScope: storageScope(branchId, documentType, scopeId),
    storedOriginalInvoiceId: null,
    accepted: false,
    rejectedReason: null,
    removed: false,
    migrated: false,
  } satisfies Omit<PendingAtomicCheckoutInspection, 'pending'>

  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return { ...base, pending: null }
  }
  if (!raw) return { ...base, pending: null }

  let parsed: Partial<PendingAtomicCheckout>
  try {
    parsed = JSON.parse(raw) as Partial<PendingAtomicCheckout>
  } catch {
    return {
      ...base,
      pending: null,
      rejectedReason: 'invalid_json',
      removed: documentType === 'credit_note' && removeExactPendingKey(key),
    }
  }

  const originalInvoiceId = storedOriginalInvoiceId(parsed.checkout)
  const inspectedBase = { ...base, storedOriginalInvoiceId: originalInvoiceId }
  if (parsed.documentType !== documentType) {
    return {
      ...inspectedBase,
      pending: null,
      rejectedReason: 'document_mismatch',
      removed: documentType === 'credit_note' && removeExactPendingKey(key),
    }
  }

  const creditIdentityMismatch = documentType === 'credit_note'
    && Boolean(scopeId)
    && (
      parsed.scopeId !== scopeId
      || originalInvoiceId !== scopeId
      || (typeof parsed.branchId === 'string' && parsed.branchId !== branchId)
    )
  if (creditIdentityMismatch) {
    return {
      ...inspectedBase,
      pending: null,
      rejectedReason: 'identity_mismatch',
      removed: removeExactPendingKey(key),
    }
  }

  if (typeof parsed.idempotencyKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(parsed.cartFingerprint ?? '')
      || !parsed.checkout || typeof parsed.checkout !== 'object'
      || Array.isArray(parsed.checkout)) {
    return {
      ...inspectedBase,
      pending: null,
      rejectedReason: 'invalid_payload',
      removed: documentType === 'credit_note' && removeExactPendingKey(key),
    }
  }

  let pending = parsed as PendingAtomicCheckout
  let migrated = false
  if (documentType === 'credit_note' && scopeId && pending.branchId == null) {
    pending = { ...pending, branchId }
    try {
      localStorage.setItem(key, JSON.stringify(pending))
      migrated = true
    } catch {
      return {
        ...inspectedBase,
        pending: null,
        rejectedReason: 'invalid_payload',
      }
    }
  }
  if (!pendingAtomicCheckoutMatchesScope(
    pending,
    documentType,
    scopeId,
    branchId,
  )) {
    return {
      ...inspectedBase,
      pending: null,
      rejectedReason: 'identity_mismatch',
      removed: documentType === 'credit_note' && removeExactPendingKey(key),
      migrated,
    }
  }
  return {
    ...inspectedBase,
    pending,
    accepted: true,
    migrated,
  }
}

export function readPendingAtomicCheckout(
  branchId: string,
  documentType: AtomicCheckoutDocumentType = 'invoice',
  scopeId?: string,
): PendingAtomicCheckout | null {
  return inspectPendingAtomicCheckout(branchId, documentType, scopeId).pending
}

export function clearPendingAtomicCheckoutScope(
  branchId: string,
  documentType: AtomicCheckoutDocumentType,
  scopeId: string,
): void {
  removeExactPendingKey(
    atomicCheckoutStorageKey(branchId, documentType, scopeId),
  )
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
  const request = {
    action: documentType === 'credit_note'
      ? 'checkout_simplified_credit_note'
      : 'checkout_simplified',
    branchId: params.branchId,
    checkout: params.checkout,
    cartFingerprint: params.cartFingerprint,
    clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
    source: documentType === 'credit_note' ? 'auto_credit_note' : 'auto_checkout',
  }
  const { data, error } = await invokeAuthenticatedZatca(request)
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
