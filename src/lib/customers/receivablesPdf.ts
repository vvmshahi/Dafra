import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CustomerReceivableWorkspace } from './receivables'
import { registerPdfFonts, setPdfFontForText } from '@/pages/reports/pdf/reportPdfFonts'

function safeFilename(value: string) {
  return value.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'customer'
}

function typeLabel(type: string) {
  return ({ invoice: 'Invoice', payment_receipt: 'Payment', credit_note: 'Credit note', payment_reversal: 'Payment reversal', adjustment: 'Adjustment' } as Record<string, string>)[type] ?? 'Transaction'
}

export async function downloadCustomerStatementPdf(input: {
  customerName: string
  companyName?: string | null
  branchLabel?: string | null
  locale: 'en' | 'ar'
  workspace: CustomerReceivableWorkspace
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await registerPdfFonts(doc)
  const isArabic = input.locale === 'ar'
  const labels = isArabic
    ? { title: 'كشف حساب العميل', customer: 'العميل', company: 'المنشأة', branch: 'الفرع', period: 'الفترة', opening: 'الرصيد الافتتاحي', closing: 'الرصيد الختامي', headers: ['التاريخ والوقت', 'النوع', 'الوصف', 'مدين', 'دائن', 'الرصيد'] }
    : { title: 'Customer statement', customer: 'Customer', company: 'Company', branch: 'Branch', period: 'Period', opening: 'Opening balance', closing: 'Closing balance', headers: ['Date / time', 'Type', 'Description', 'Debit', 'Credit', 'Balance'] }
  const margin = 14
  const width = doc.internal.pageSize.getWidth()
  const text = (value: unknown, x: number, y: number, options?: Parameters<jsPDF['text']>[2]) => { setPdfFontForText(doc, value); doc.text(String(value ?? '—'), x, y, options) }
  doc.setFillColor(23, 61, 42); doc.rect(0, 0, width, 28, 'F'); doc.setTextColor(255, 255, 255); doc.setFontSize(16); text(labels.title, isArabic ? width - margin : margin, 17, { align: isArabic ? 'right' : 'left' })
  doc.setTextColor(30, 40, 35); doc.setFontSize(9)
  const identity = [[labels.customer, input.customerName], [labels.company, input.companyName ?? '—'], [labels.branch, input.branchLabel ?? (isArabic ? 'موحد' : 'Consolidated')], [labels.period, `${input.workspace.statement.startDate} — ${input.workspace.statement.endDate}`]]
  let y = 40
  for (const [label, value] of identity) { doc.setFont('helvetica', 'bold'); text(`${label}:`, margin, y); doc.setFont('helvetica', 'normal'); text(value, margin + 30, y); y += 5 }
  const rows = input.workspace.ledger.map(row => [new Date(row.effectiveAt).toLocaleString(isArabic ? 'ar-SA-u-nu-latn' : 'en-SA'), typeLabel(row.type), row.description || typeLabel(row.type), row.debit ? row.debit.toFixed(2) : '—', row.credit ? row.credit.toFixed(2) : '—', row.runningBalance.toFixed(2)])
  autoTable(doc, { startY: y + 5, head: [labels.headers], body: rows, theme: 'grid', styles: { font: 'helvetica', fontSize: 7, cellPadding: 2, halign: isArabic ? 'right' : 'left' }, headStyles: { fillColor: [23, 61, 42], textColor: [255, 255, 255], fontStyle: 'bold' }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, didParseCell: data => { setPdfFontForText(doc, data.cell.text.join(' ')) } })
  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 20
  doc.setFontSize(9); doc.setTextColor(30, 40, 35); text(`${labels.opening}: ${input.workspace.statement.openingBalance.toFixed(2)}`, margin, finalY + 10); text(`${labels.closing}: ${input.workspace.statement.closingBalance.toFixed(2)}`, margin, finalY + 16)
  doc.save(`${isArabic ? 'كشف-حساب' : 'customer-statement'}-${safeFilename(input.customerName)}-${input.workspace.statement.startDate}-to-${input.workspace.statement.endDate}.pdf`)
}
