import type { A4TemplateId } from '@/types/database'

export interface A4ColorTokens {
  readonly accent: string
  readonly accentForeground: string
  readonly heading: string
  readonly body: string
  readonly muted: string
  readonly border: string
  readonly surfaceTint: string
  readonly tableHeader: string
  readonly tableHeaderForeground: string
  readonly totalSurface: string
  readonly totalForeground: string
}

export const A4_LAYOUT_COLOR_DEFAULTS: Record<A4TemplateId, {
  readonly accent: string
  readonly heading: string
  readonly body: string
}> = {
  classic: { accent: '#0f766e', heading: '#10251a', body: '#1f2937' },
  modern_split: { accent: '#1d4ed8', heading: '#172554', body: '#1f2937' },
  minimal_professional: { accent: '#27272a', heading: '#18181b', body: '#27272a' },
  executive_green: { accent: '#14532d', heading: '#0f2419', body: '#26322b' },
  clean_ledger: { accent: '#1f2937', heading: '#111827', body: '#1f2937' },
  contemporary_border: { accent: '#0e7490', heading: '#164e63', body: '#1f2937' },
  executive_professional: { accent: '#172554', heading: '#172554', body: '#1f2937' },
  creative_studio: { accent: '#7c3aed', heading: '#3b0764', body: '#312e81' },
}

export const A4_ACCENT_PRESETS = [
  '#0f766e', // Kubri green
  '#000000',
  '#ffffff',
  '#172554',
  '#1d4ed8',
  '#047857',
  '#881337',
  '#6d28d9',
  '#c2410c',
  '#0e7490',
  '#27272a',
] as const

const normalize = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback

export function relativeLuminance(hex: string): number {
  const value = normalize(hex, '#000000').slice(1)
  const channels = [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
}

export function safeForeground(background: string): '#ffffff' | '#111827' {
  return contrastRatio('#ffffff', background) >= contrastRatio('#111827', background) ? '#ffffff' : '#111827'
}

export function hasSafeTextContrast(foreground: string, background = '#ffffff'): boolean {
  return contrastRatio(foreground, background) >= 4.5
}

function mixWithWhite(hex: string, weight: number) {
  const value = normalize(hex, '#000000').slice(1)
  const channel = (offset: number) => Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * (1 - weight) + 255 * weight)
  return `#${[channel(0), channel(2), channel(4)].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

export function resolveA4ColorTokens(input: {
  readonly templateId: A4TemplateId
  readonly accent: string
  readonly heading: string
  readonly body: string
  readonly autoForeground: boolean
}): A4ColorTokens {
  const defaults = A4_LAYOUT_COLOR_DEFAULTS[input.templateId]
  const accent = normalize(input.accent, defaults.accent)
  const headingCandidate = normalize(input.heading, defaults.heading)
  const bodyCandidate = normalize(input.body, defaults.body)
  const heading = input.autoForeground || !hasSafeTextContrast(headingCandidate) ? (hasSafeTextContrast(headingCandidate) ? headingCandidate : '#111827') : headingCandidate
  const body = input.autoForeground || !hasSafeTextContrast(bodyCandidate) ? (hasSafeTextContrast(bodyCandidate) ? bodyCandidate : '#1f2937') : bodyCandidate
  const accentForeground = safeForeground(accent)
  const outlined = accent === '#ffffff'
  return {
    accent,
    accentForeground,
    heading,
    body,
    muted: hasSafeTextContrast('#667085') ? '#667085' : '#4b5563',
    border: outlined ? '#374151' : mixWithWhite(accent, .68),
    surfaceTint: outlined ? '#f8fafc' : mixWithWhite(accent, .93),
    tableHeader: outlined ? '#ffffff' : accent,
    tableHeaderForeground: outlined ? '#111827' : accentForeground,
    totalSurface: outlined ? '#f8fafc' : mixWithWhite(accent, .88),
    totalForeground: outlined ? '#111827' : (hasSafeTextContrast(heading, mixWithWhite(accent, .88)) ? heading : '#111827'),
  }
}
