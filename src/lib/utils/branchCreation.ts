export function branchCreationErrorMessage(message?: string | null): string {
  const text = String(message ?? '')

  if (/branch limit reached/i.test(text)) {
    return 'Branch limit reached. Please contact Kubri support to add more branches.'
  }

  if (/account is suspended|suspended/i.test(text)) {
    return 'This account is suspended. New branches cannot be created.'
  }

  if (/only tenant owners|unauthorized|forbidden/i.test(text)) {
    return 'Only tenant owners can create branches.'
  }

  return text || 'Failed to create branch. Please try again.'
}

export function branchIdFromRpcResult(data: unknown): string {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }

  throw new Error('Branch creation RPC returned no branch id')
}
