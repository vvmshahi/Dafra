import { strToU8, zipSync } from 'fflate'
import type { CustomerReceivableWorkspace, ReceivableLedgerRow } from './receivables'

type Locale = 'en' | 'ar'

export interface ReceivablesWorkbookInput {
  customerName: string
  companyName?: string | null
  branchLabel?: string | null
  locale: Locale
  generatedAt?: Date
  workspace: Pick<CustomerReceivableWorkspace, 'ledger' | 'statement'>
}

type SheetCell = { value: string | number | Date; kind?: 'text' | 'number' | 'date'; style?: number }

const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function xml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelColumn(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const offset = (value - 1) % 26
    result = String.fromCharCode(65 + offset) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function excelDate(value: Date) {
  return (value.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000
}

function spreadsheetText(value: unknown) {
  const text = String(value ?? '')
  // Keep untrusted text as an inline string and additionally neutralize the
  // formula-leading characters understood by spreadsheet applications.
  return /^[=+\-@]/.test(text) ? `\u200B${text}` : text
}

function cellXml(ref: string, cell: SheetCell) {
  if (cell.kind === 'number') {
    const value = Number(cell.value)
    return `<c r="${ref}" s="${cell.style ?? 2}" t="n"><v>${Number.isFinite(value) ? value.toFixed(2) : '0.00'}</v></c>`
  }
  if (cell.kind === 'date') {
    const date = cell.value instanceof Date ? cell.value : new Date(cell.value)
    if (Number.isFinite(date.getTime())) return `<c r="${ref}" s="${cell.style ?? 1}" t="n"><v>${excelDate(date)}</v></c>`
    return `<c r="${ref}" s="${cell.style ?? 0}" t="inlineStr"><is><t>—</t></is></c>`
  }
  return `<c r="${ref}" s="${cell.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(spreadsheetText(cell.value))}</t></is></c>`
}

function rowXml(index: number, cells: SheetCell[]) {
  return `<row r="${index}">${cells.map((cell, column) => cellXml(`${excelColumn(column)}${index}`, cell)).join('')}</row>`
}

function sourceLabel(row: ReceivableLedgerRow) {
  if (row.description?.trim()) return row.description.trim()
  return row.sourceKind.replaceAll('_', ' ')
}

function transactionLabel(type: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    invoice: ['Invoice', 'فاتورة'],
    payment_receipt: ['Payment receipt', 'إيصال دفع'],
    credit_note: ['Credit note', 'إشعار دائن'],
    debit_note: ['Debit note', 'إشعار مدين'],
    payment_reversal: ['Payment reversal', 'عكس دفعة'],
    credit_note_refund: ['Credit-note refund', 'استرداد إشعار دائن'],
    adjustment: ['Approved adjustment', 'تسوية معتمدة'],
  }
  return (labels[type] ?? [type, type])[locale === 'ar' ? 1 : 0]
}

function workbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${XML_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
}

function stylesheetXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${XML_NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="#\,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`
}

export function buildCustomerStatementXlsx(input: ReceivablesWorkbookInput) {
  const isArabic = input.locale === 'ar'
  const labels = isArabic
    ? {
      title: 'كشف حساب العميل', customer: 'العميل', company: 'المنشأة', branch: 'الفرع', period: 'الفترة', generated: 'تم الإنشاء', opening: 'الرصيد الافتتاحي', closing: 'الرصيد الختامي',
      headers: ['التاريخ والوقت', 'الفرع', 'النوع', 'المصدر / الرقم', 'المرجع', 'مدين', 'دائن', 'الرصيد الجاري', 'الحالة', 'ملاحظات'],
    }
    : {
      title: 'Customer statement', customer: 'Customer', company: 'Company', branch: 'Branch', period: 'Period', generated: 'Generated', opening: 'Opening balance', closing: 'Closing balance',
      headers: ['Date / time', 'Branch', 'Transaction type', 'Source / number', 'Reference', 'Debit', 'Credit', 'Running balance', 'Status', 'Notes'],
    }
  const generatedAt = input.generatedAt ?? new Date()
  const rows: SheetCell[][] = [
    [{ value: labels.title, style: 3 }],
    [{ value: labels.customer, style: 3 }, { value: input.customerName }],
    [{ value: labels.company, style: 3 }, { value: input.companyName ?? '—' }],
    [{ value: labels.branch, style: 3 }, { value: input.branchLabel ?? (isArabic ? 'موحد' : 'Consolidated') }],
    [{ value: labels.period, style: 3 }, { value: `${input.workspace.statement.startDate} — ${input.workspace.statement.endDate}` }],
    [{ value: labels.generated, style: 3 }, { value: generatedAt, kind: 'date' }],
    [],
    labels.headers.map(value => ({ value, style: 3 })),
  ]
  for (const row of input.workspace.ledger) {
    rows.push([
      { value: new Date(row.effectiveAt), kind: 'date' },
      { value: row.branchId || '—' },
      { value: transactionLabel(row.type, input.locale) },
      { value: sourceLabel(row) },
      { value: '—' },
      { value: row.debit, kind: 'number' },
      { value: row.credit, kind: 'number' },
      { value: row.runningBalance, kind: 'number' },
      { value: row.type === 'payment_reversal' ? (isArabic ? 'معكوس' : 'Reversed') : (isArabic ? 'مُرحّل' : 'Posted') },
      { value: row.description || '—' },
    ])
  }
  rows.push([])
  rows.push([{ value: labels.opening, style: 3 }, { value: input.workspace.statement.openingBalance, kind: 'number' }])
  rows.push([{ value: labels.closing, style: 3 }, { value: input.workspace.statement.closingBalance, kind: 'number' }])

  const sheetRows = rows.map((row, index) => rowXml(index + 1, row)).join('')
  const headerRow = 8
  const lastRow = rows.length
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${XML_NS}" xmlns:r="${REL_NS}"><dimension ref="A1:J${lastRow}"/><sheetViews><sheetView workbookViewId="0"${isArabic ? ' rightToLeft="1"' : ''}><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A9" sqref="A9"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="21" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/><col min="6" max="8" width="16" customWidth="1"/><col min="9" max="9" width="14" customWidth="1"/><col min="10" max="10" width="34" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A${headerRow}:J${Math.max(headerRow, lastRow - 3)}"/></worksheet>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(workbookXml(isArabic ? 'كشف حساب' : 'Statement')),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(stylesheetXml()),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
  }
  return zipSync(files, { level: 6 })
}

export function customerStatementFilename(customerName: string, locale: Locale, date = new Date()) {
  const cleaned = customerName.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'customer'
  const stamp = date.toISOString().slice(0, 10)
  return `${locale === 'ar' ? 'كشف-حساب' : 'customer-statement'}-${cleaned}-${stamp}.xlsx`
}

export function downloadCustomerStatementXlsx(input: ReceivablesWorkbookInput) {
  const bytes = buildCustomerStatementXlsx(input)
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = customerStatementFilename(input.customerName, input.locale, input.generatedAt)
  link.rel = 'noopener'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}
