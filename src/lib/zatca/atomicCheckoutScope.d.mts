export const ATOMIC_CHECKOUT_STORAGE_PREFIX: string
export const CREDIT_NOTE_SCOPE_MIGRATION_KEY: string

export function atomicCheckoutStorageKey(
  branchId: string,
  documentType?: 'invoice' | 'credit_note',
  scopeId?: string,
): string

export function legacyBranchCreditNoteStorageKey(branchId: string): string
export function isLegacyBranchCreditNoteStorageKey(key: unknown): boolean

export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export function removeObsoleteCreditNoteStorageEntries(
  storage: StorageLike,
): string[]

export function pendingAtomicCheckoutMatchesScope(
  pending: unknown,
  documentType?: 'invoice' | 'credit_note',
  scopeId?: string,
  branchId?: string,
): boolean

export function resolveScopedAtomicCheckout<T extends Record<string, unknown>>(
  pending: { checkout?: Record<string, unknown> } | null | undefined,
  currentCheckout: T,
  documentType?: 'invoice' | 'credit_note',
  scopeId?: string,
  branchId?: string,
): Record<string, unknown>
