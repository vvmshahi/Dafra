function cleanDisplayText(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstDisplayText(values, placeholder) {
  for (const value of values) {
    const text = cleanDisplayText(value)
    if (text) return text
  }
  return typeof placeholder === 'string' ? placeholder.trim() : '?'
}

export function resolveBranchDisplayName(value, isArabic, placeholder = '?') {
  const source = record(value)
  return firstDisplayText(
    isArabic
      ? [source.name_ar, source.name, source.display_name, source.branch_name, source.branchName]
      : [source.name, source.name_ar, source.display_name, source.branch_name, source.branchName],
    placeholder,
  )
}

export function resolveBusinessDisplayName(value, isArabic, placeholder = '?') {
  const source = record(value)
  return firstDisplayText(
    isArabic
      ? [source.business_name_ar, source.business_name, source.name_ar, source.name, source.display_name]
      : [source.business_name, source.business_name_ar, source.name, source.name_ar, source.display_name],
    placeholder,
  )
}

export { cleanDisplayText }
