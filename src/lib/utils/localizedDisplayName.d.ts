export type LocalizedDisplayNameSource = object | null | undefined

export function cleanDisplayText(value: unknown): string | null
export function resolveBranchDisplayName(
  value: LocalizedDisplayNameSource,
  isArabic: boolean,
  placeholder?: string,
): string
export function resolveBusinessDisplayName(
  value: LocalizedDisplayNameSource,
  isArabic: boolean,
  placeholder?: string,
): string
