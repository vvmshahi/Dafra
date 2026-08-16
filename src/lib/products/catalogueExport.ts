import { strToU8, zipSync } from 'fflate'

export const CATALOGUE_EXPORT_MAX_ROWS = 10_000

export type CatalogueExportFormat = 'xlsx' | 'csv'
export type CatalogueExportScope = 'items' | 'categories' | 'catalogue'
export type CatalogueExportItemType = 'all' | 'products' | 'services'
export type CatalogueExportStatus = 'all' | 'active' | 'inactive'

export interface CatalogueExportItem {
  name: string
  secondDescription: string | null
  isService: boolean
  categoryName: string | null
  sellingPrice: number
  sku: string | null
  barcode: string | null
  trackStock: boolean
  currentStock: number | null
  unit: string | null
  vatTreatment: 'inherit' | 'exclusive' | 'inclusive' | 'exempt' | null
  isActive: boolean
}

export interface CatalogueExportCategory {
  name: string
  isActive: boolean
  productCount: number
}

export interface CatalogueExportPayload {
  items: CatalogueExportItem[]
  categories: CatalogueExportCategory[]
  scope: CatalogueExportScope
}

type Cell = string | number
type Sheet = { name: string; headers: string[]; rows: Cell[][]; widths: number[] }

const ITEM_HEADERS = [
  'Item Name',
  'Second Description',
  'Item Type',
  'Category',
  'Selling Price',
  'SKU',
  'Barcode',
  'Track Stock',
  'Current Stock',
  'Unit',
  'VAT',
  'Active Status',
]

const CATEGORY_HEADERS = ['Category Name', 'Status', 'Product Count']

export function neutralizeSpreadsheetText(value: unknown): string {
  const text = String(value ?? '')
  return /^[=+\-@]/.test(text) ? `\u200B${text}` : text
}

export function sanitizeCatalogueExportFilename(value: string): string {
  const normalized = value.normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || 'branch'
}

export function catalogueExportFilename(
  scope: CatalogueExportScope,
  branchName: string,
  format: CatalogueExportFormat,
  date = new Date(),
): string {
  const subject = scope === 'items' ? 'products' : scope === 'categories' ? 'categories' : 'catalogue'
  return `kubri-${subject}-${sanitizeCatalogueExportFilename(branchName)}-${date.toISOString().slice(0, 10)}.${format}`
}

function itemTypeLabel(isService: boolean) {
  return isService ? 'Service' : 'Product'
}

function vatLabel(value: CatalogueExportItem['vatTreatment']) {
  if (value === 'inclusive') return 'Inclusive'
  if (value === 'exclusive') return 'Exclusive'
  if (value === 'exempt') return 'Exempt'
  return 'Branch default'
}

function statusLabel(active: boolean) {
  return active ? 'Active' : 'Inactive'
}

export function catalogueExportSheets(payload: CatalogueExportPayload): Sheet[] {
  const sheets: Sheet[] = []
  if (payload.scope !== 'categories') {
    sheets.push({
      name: 'Items',
      headers: ITEM_HEADERS,
      rows: payload.items.map(item => [
        item.name,
        item.secondDescription ?? '',
        itemTypeLabel(item.isService),
        item.categoryName ?? '',
        Number(item.sellingPrice),
        item.sku ?? '',
        item.barcode ?? '',
        item.trackStock && !item.isService ? 'Yes' : 'No',
        item.isService || !item.trackStock || item.currentStock === null ? '' : Number(item.currentStock),
        item.unit ?? '',
        vatLabel(item.vatTreatment),
        statusLabel(item.isActive),
      ]),
      widths: [28, 28, 14, 20, 15, 18, 18, 14, 16, 14, 16, 14],
    })
  }
  if (payload.scope !== 'items') {
    sheets.push({
      name: 'Categories',
      headers: CATEGORY_HEADERS,
      rows: payload.categories.map(category => [
        category.name,
        statusLabel(category.isActive),
        Number(category.productCount),
      ]),
      widths: [30, 14, 16],
    })
  }
  return sheets
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelColumn(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const offset = (value - 1) % 26
    result = String.fromCharCode(65 + offset) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function xlsxCell(ref: string, value: Cell, header = false): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${header ? 2 : 1}" t="n"><v>${value}</v></c>`
  }
  return `<c r="${ref}" s="${header ? 2 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(neutralizeSpreadsheetText(value))}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const allRows = [sheet.headers, ...sheet.rows]
  const lastRow = Math.max(allRows.length, 1)
  const lastColumn = excelColumn(Math.max(sheet.headers.length - 1, 0))
  const rows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xlsxCell(`${excelColumn(columnIndex)}${rowIndex + 1}`, value, rowIndex === 0)).join('')}</row>`).join('')
  const columns = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${columns}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`
}

function workbookXml(sheets: Sheet[]): string {
  const names = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names}</sheets></workbook>`
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#\,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F2A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`
}

export function buildCatalogueExportXlsx(payload: CatalogueExportPayload): Uint8Array {
  const sheets = catalogueExportSheets(payload)
  const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  const sheetRelationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(workbookXml(sheets)),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(stylesXml()),
  }
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet)) })
  return zipSync(files, { level: 6 })
}

function csvEscape(value: Cell): string {
  const text = typeof value === 'number' ? String(value) : neutralizeSpreadsheetText(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildCatalogueExportCsv(payload: CatalogueExportPayload): string {
  const sheets = catalogueExportSheets(payload)
  if (sheets.length === 1) {
    const sheet = sheets[0]
    return `\uFEFF${[sheet.headers, ...sheet.rows].map(row => row.map(csvEscape).join(',')).join('\r\n')}`
  }
  const items = sheets.find(sheet => sheet.name === 'Items')
  const categories = sheets.find(sheet => sheet.name === 'Categories')
  const headers = ['Record Type', ...ITEM_HEADERS, 'Product Count']
  const rows: Cell[][] = [
    ...(items?.rows.map(row => ['Item', ...row, '']) ?? []),
    ...(categories?.rows.map(row => ['Category', row[0], '', '', '', '', '', '', '', '', '', '', row[1], row[2]]) ?? []),
  ]
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n')}`
}

export function downloadCatalogueExport(
  payload: CatalogueExportPayload,
  branchName: string,
  format: CatalogueExportFormat,
): void {
  const content = format === 'xlsx' ? buildCatalogueExportXlsx(payload) : buildCatalogueExportCsv(payload)
  const type = format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv;charset=utf-8'
  const href = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = href
  link.download = catalogueExportFilename(payload.scope, branchName, format)
  link.rel = 'noopener'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}
