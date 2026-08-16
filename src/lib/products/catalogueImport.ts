import { strFromU8, unzipSync } from 'fflate'

export const CATALOGUE_IMPORT_MAX_ROWS = 5_000
export type ImportField = 'name' | 'name_ar' | 'category' | 'price' | 'sku' | 'barcode' | 'is_service' | 'track_stock' | 'opening_stock' | 'vat_treatment'
export type ImportRow = Record<string, string | number | boolean | null>

export const IMPORT_FIELDS: Array<{ key: ImportField; label: string; required?: boolean }> = [
  { key: 'name', label: 'Item Name', required: true }, { key: 'name_ar', label: 'Second Description' },
  { key: 'category', label: 'Category' }, { key: 'price', label: 'Selling Price', required: true },
  { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'is_service', label: 'Item Type' },
  { key: 'track_stock', label: 'Track Stock' }, { key: 'opening_stock', label: 'Opening Stock' }, { key: 'vat_treatment', label: 'VAT' },
]

const aliases: Record<ImportField, string[]> = {
  name: ['item name', 'name', 'product name', 'service name'], name_ar: ['second description', 'name ar', 'arabic name', 'name arabic'],
  category: ['category'], price: ['selling price', 'price', 'unit price'], sku: ['sku', 'item code'], barcode: ['barcode'],
  is_service: ['item type', 'type', 'service'], track_stock: ['track stock', 'tracking'], opening_stock: ['opening stock', 'current stock', 'stock'], vat_treatment: ['vat', 'vat treatment'],
}
const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < text.length; i += 1) { const char = text[i]; const next = text[i + 1]
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1 } else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { row.push(cell); cell = '' } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(cell); if (row.some(value => value !== '')) rows.push(row); row = []; cell = '' } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }; return rows
}

function colIndex(ref: string) { const letters = ref.replace(/[0-9]/g, ''); return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1 }
function cellsFromSheet(xml: string, shared: string[]) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const row: string[] = []; for (const cell of match[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) { const ref = /r="([^"]+)"/.exec(cell[1])?.[1] ?? 'A1'; const index = colIndex(ref); const body = cell[2]; const type = /t="([^"]+)"/.exec(cell[1])?.[1]; const value = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''; row[index] = decode(type === 's' ? shared[Number(value)] ?? '' : value) } return row
  })
}
export function parseXlsx(bytes: Uint8Array): Array<{ name: string; rows: string[][] }> {
  const files = unzipSync(bytes); const workbook = strFromU8(files['xl/workbook.xml']); const rels = strFromU8(files['xl/_rels/workbook.xml.rels']); const sharedXml = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : ''
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => decode([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(part => part[1]).join('')))
  const targets = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(match => [match[1], match[2]]))
  return [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)].flatMap(match => { const target = targets.get(match[2]); const path = target ? `xl/${target.replace(/^\//, '')}` : ''; return files[path] ? [{ name: decode(match[1]), rows: cellsFromSheet(strFromU8(files[path]), shared) }] : [] })
}
export async function readImportFile(file: File) { const bytes = new Uint8Array(await file.arrayBuffer()); return file.name.toLowerCase().endsWith('.xlsx') ? parseXlsx(bytes) : [{ name: 'CSV', rows: parseCsv(new TextDecoder().decode(bytes)) }] }
export function suggestMapping(headers: string[]) { const mapping: Partial<Record<ImportField, number>> = {}; headers.forEach((header, index) => { const normalized = clean(header); (Object.keys(aliases) as ImportField[]).forEach(key => { if (mapping[key] === undefined && aliases[key].includes(normalized)) mapping[key] = index }) }); return mapping }
export function valueFor(row: string[], index: number | undefined) { return index === undefined ? '' : (row[index] ?? '').trim() }
export function toImportPayload(rows: string[][], mapping: Partial<Record<ImportField, number>>) {
  const issues: Array<{ row: number; reason: string }> = []
  const seen = new Set<string>()
  const payload: Record<string, unknown>[] = []
  rows.slice(1, CATALOGUE_IMPORT_MAX_ROWS + 1).forEach((row, offset) => {
    const source_row = offset + 2
    const name = valueFor(row, mapping.name)
    const price = Number(valueFor(row, mapping.price))
    const is_service = /^(service|yes|true|1)$/i.test(valueFor(row, mapping.is_service))
    const track_stock = !is_service && /^(yes|true|1)$/i.test(valueFor(row, mapping.track_stock))
    const opening_stock = Number(valueFor(row, mapping.opening_stock) || 0)
    const sku = valueFor(row, mapping.sku)
    const barcode = valueFor(row, mapping.barcode)
    if (!name) { issues.push({ row: source_row, reason: 'Item name is required' }); return }
    if (!Number.isFinite(price) || price < 0) { issues.push({ row: source_row, reason: 'Selling price must be zero or higher' }); return }
    if (track_stock && (!Number.isFinite(opening_stock) || opening_stock < 0)) { issues.push({ row: source_row, reason: 'Opening stock must be zero or higher' }); return }
    const keys = [sku && `sku:${clean(sku)}`, barcode && `barcode:${clean(barcode)}`].filter((key): key is string => Boolean(key))
    if (keys.some(key => seen.has(key))) { issues.push({ row: source_row, reason: 'Duplicate SKU or barcode in this file' }); return }
    keys.forEach(key => seen.add(key))
    const vat = ({ 'branch default': 'inherit', inclusive: 'inclusive', exclusive: 'exclusive', exempt: 'exempt' } as Record<string, string>)[clean(valueFor(row, mapping.vat_treatment))] ?? 'inherit'
    payload.push({ source_row, name, name_ar: valueFor(row, mapping.name_ar) || undefined, category: valueFor(row, mapping.category) || undefined, price, sku: sku || undefined, barcode: barcode || undefined, is_service, track_stock, opening_stock: track_stock ? opening_stock : 0, vat_treatment: vat })
  })
  return { payload, issues, limited: rows.length - 1 > CATALOGUE_IMPORT_MAX_ROWS }
}
