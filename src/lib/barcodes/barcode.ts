export type BarcodeType =
  | 'ean13' | 'ean8' | 'upca' | 'upce' | 'code128' | 'code39' | 'itf14'
  | 'gs1_databar' | 'gs1_128' | 'gs1_datamatrix' | 'qr' | 'unknown'

export const BARCODE_TYPES: BarcodeType[] = [
  'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf14',
  'gs1_databar', 'gs1_128', 'gs1_datamatrix', 'qr', 'unknown',
]

export function normalizeBarcode(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

export function hasValidGtinCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false
  let sum = 0
  for (let index = 0; index < value.length - 1; index += 1) {
    sum += Number(value[index]) * ((value.length - 1 - index) % 2 === 1 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === Number(value.at(-1))
}

export function detectBarcodeType(value: string): BarcodeType {
  const normalized = normalizeBarcode(value)
  if (/^\d{8}$/.test(normalized) && hasValidGtinCheckDigit(normalized)) return 'ean8'
  if (/^\d{12}$/.test(normalized) && hasValidGtinCheckDigit(normalized)) return 'upca'
  if (/^\d{13}$/.test(normalized) && hasValidGtinCheckDigit(normalized)) return 'ean13'
  if (/^\d{14}$/.test(normalized) && hasValidGtinCheckDigit(normalized)) return 'itf14'
  return 'unknown'
}

export function validateBarcode(value: string, type: BarcodeType): string | null {
  const normalized = normalizeBarcode(value)
  if (normalized.length < 3 || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return 'invalidValue'
  }
  const gtinLength = type === 'ean8' ? 8 : type === 'upca' ? 12 : type === 'ean13' ? 13 : type === 'itf14' ? 14 : null
  if (gtinLength !== null && (normalized.length !== gtinLength || !hasValidGtinCheckDigit(normalized))) {
    return 'invalidCheckDigit'
  }
  return null
}
