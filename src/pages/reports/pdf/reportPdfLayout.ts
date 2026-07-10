import { jsPDF } from 'jspdf'
import autoTable, { type UserOptions } from 'jspdf-autotable'
import {
  hasArabicText,
  hasLatinText,
  isArabicFontReady,
  PDF_ARABIC_FONT,
  PDF_LATIN_FONT,
  pdfDrawableText,
  registerPdfFonts,
  setPdfFontForText,
  type PdfFontStyle,
} from './reportPdfFonts'
import { PDF_THEME, type ReportPdfContext, reportPdfFileName, safeText } from './reportPdfTheme'

type Rgb = readonly [number, number, number]
type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY?: number } }
type PdfTextAlign = 'left' | 'center' | 'right' | 'justify'
type PdfTextOptions = { align?: PdfTextAlign; maxWidth?: number }
type PdfTextRun = { text: string; arabic: boolean }

export interface PdfKpi {
  label: string
  value: string
  sub?: string | null
  tone?: 'green' | 'gold' | 'plain'
}

export interface PdfTableOptions {
  startY: number
  head: string[]
  body: string[][]
  foot?: string[]
  columnStyles?: UserOptions['columnStyles']
  fontSize?: number
  note?: string
}

function setFillColor(doc: jsPDF, color: Rgb) {
  doc.setFillColor(color[0], color[1], color[2])
}

function setTextColor(doc: jsPDF, color: Rgb) {
  doc.setTextColor(color[0], color[1], color[2])
}

function setDrawColor(doc: jsPDF, color: Rgb) {
  doc.setDrawColor(color[0], color[1], color[2])
}

function pageWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth()
}

function pageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight()
}

function contentWidth(doc: jsPDF): number {
  return pageWidth(doc) - PDF_THEME.layout.marginLeft - PDF_THEME.layout.marginRight
}

function rightText(doc: jsPDF, text: string, x: number, y: number) {
  doc.text(text, x, y, { align: 'right' })
}

function splitMixedTextRuns(text: string): PdfTextRun[] {
  const runs: PdfTextRun[] = []
  let current = ''
  let currentArabic = false

  Array.from(text).forEach(char => {
    const charArabic = hasArabicText(char)
    const charLatin = hasLatinText(char)
    const nextArabic = charArabic || (!charLatin && currentArabic)

    if (current && nextArabic !== currentArabic) {
      runs.push({ text: current, arabic: currentArabic })
      current = ''
    }

    current += char
    currentArabic = nextArabic
  })

  if (current) runs.push({ text: current, arabic: currentArabic })
  return runs
}

function setPdfRunFont(doc: jsPDF, run: PdfTextRun, style: PdfFontStyle) {
  doc.setFont(run.arabic && isArabicFontReady() ? PDF_ARABIC_FONT : PDF_LATIN_FONT, run.arabic ? 'normal' : style)
}

function measureTextRun(doc: jsPDF, run: PdfTextRun, style: PdfFontStyle): number {
  setPdfRunFont(doc, run, style)
  return doc.getTextWidth(run.text)
}

function isMixedArabicLatin(text: string): boolean {
  return isArabicFontReady() && hasArabicText(text) && hasLatinText(text)
}

function measureSmartText(doc: jsPDF, text: string, style: PdfFontStyle): number {
  if (isMixedArabicLatin(text)) {
    return splitMixedTextRuns(text).reduce((sum, run) => sum + measureTextRun(doc, run, style), 0)
  }

  setPdfFontForText(doc, text, style)
  return doc.getTextWidth(text)
}

function fitSmartTextToWidth(doc: jsPDF, text: string, maxWidth: number | undefined, style: PdfFontStyle): string {
  if (!maxWidth || measureSmartText(doc, text, style) <= maxWidth) return text

  const ellipsis = '...'
  const chars = Array.from(text)
  while (chars.length > 0 && measureSmartText(doc, `${chars.join('').trimEnd()}${ellipsis}`, style) > maxWidth) {
    chars.pop()
  }

  return chars.length > 0 ? `${chars.join('').trimEnd()}${ellipsis}` : ''
}

function drawSmartText(
  doc: jsPDF,
  value: unknown,
  x: number,
  y: number,
  options: PdfTextOptions = {},
  style: PdfFontStyle = 'normal',
  fallback = '',
) {
  const text = fitSmartTextToWidth(doc, pdfDrawableText(value, fallback), options.maxWidth, style)
  if (!text) return

  if (isMixedArabicLatin(text) && options.align !== 'justify') {
    const runs = splitMixedTextRuns(text)
    const widths = runs.map(run => measureTextRun(doc, run, style))
    const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    let cursor = options.align === 'right' ? x - totalWidth : options.align === 'center' ? x - totalWidth / 2 : x

    runs.forEach((run, index) => {
      if (!run.text) return
      setPdfRunFont(doc, run, style)
      doc.text(run.text, cursor, y)
      cursor += widths[index]
    })
    return
  }

  setPdfFontForText(doc, text, style)
  doc.text(text, x, y, options)
}

function splitSmartTextToSize(
  doc: jsPDF,
  value: unknown,
  maxWidth: number,
  style: PdfFontStyle = 'normal',
  fallback = '',
): string[] {
  const text = pdfDrawableText(value, fallback)
  if (!text) return []

  if (isMixedArabicLatin(text)) {
    return [fitSmartTextToWidth(doc, text, maxWidth, style)].filter(Boolean)
  }

  setPdfFontForText(doc, text, style)
  const lines = doc.splitTextToSize(text, maxWidth)
  return (Array.isArray(lines) ? lines : [lines]).map(line => safeText(line)).filter(Boolean)
}

function identityAlign(text: string): PdfTextAlign {
  return isArabicFontReady() && hasArabicText(text) && !hasLatinText(text) ? 'right' : 'left'
}

function drawIdentityLine(doc: jsPDF, left: number, right: number, y: number, value: string, style: PdfFontStyle = 'normal') {
  const align = identityAlign(value)
  drawSmartText(doc, value, align === 'right' ? right : left, y, { align, maxWidth: right - left }, style)
}

function drawLabeledIdentityLine(doc: jsPDF, left: number, right: number, y: number, label: string, value: string) {
  if (isArabicFontReady() && hasArabicText(value)) {
    doc.setFont(PDF_LATIN_FONT, 'normal')
    doc.text(`${label}:`, left, y)
    drawSmartText(doc, value, right, y, { align: 'right', maxWidth: Math.max(40, right - left - 24) })
    return
  }

  drawSmartText(doc, `${label}: ${value}`, left, y, { maxWidth: right - left }, 'normal', `${label}: -`)
}

export function addHeader(doc: jsPDF, context: ReportPdfContext) {
  const width = pageWidth(doc)
  const left = PDF_THEME.layout.marginLeft
  const right = width - PDF_THEME.layout.marginRight
  const identityWidth = Math.min(118, right - left - 64)
  const identityRight = left + identityWidth

  setFillColor(doc, PDF_THEME.colors.green)
  doc.rect(0, 0, width, 25, 'F')
  setFillColor(doc, PDF_THEME.colors.gold)
  doc.rect(0, 25, width, 1.2, 'F')

  setFillColor(doc, PDF_THEME.colors.gold)
  doc.roundedRect(left, 8.2, 7.6, 7.6, 1.2, 1.2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  setTextColor(doc, PDF_THEME.colors.green)
  doc.text('K', left + 2.5, 13.5)

  doc.setFontSize(10)
  setTextColor(doc, PDF_THEME.colors.white)
  doc.text('Kubri', left + 10, 13)

  doc.setFontSize(15)
  doc.text(context.reportTitle, left, 21.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  setTextColor(doc, PDF_THEME.colors.white)
  rightText(doc, 'Date range', right, 12)
  rightText(doc, context.dateRangeLabel, right, 17)
  rightText(doc, `Generated ${context.generatedAtLabel}`, right, 22)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  setTextColor(doc, PDF_THEME.colors.text)
  const companyLines = splitSmartTextToSize(doc, context.companyName, identityWidth, 'bold', 'Business').slice(0, 2)
  const companyAlign = identityAlign(companyLines.join(' '))
  companyLines.forEach((line, index) => {
    drawSmartText(
      doc,
      line,
      companyAlign === 'right' ? identityRight : left,
      34 + index * 4,
      { align: companyAlign, maxWidth: identityWidth },
      'bold',
      'Business',
    )
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  setTextColor(doc, PDF_THEME.colors.muted)

  const detailLines = [
    context.legalName ? { kind: 'plain' as const, value: context.legalName } : null,
    { kind: 'label' as const, label: 'Branch', value: context.branchName },
    {
      kind: 'plain' as const,
      value: [context.vatNumber ? `VAT: ${context.vatNumber}` : null, context.crNumber ? `CR: ${context.crNumber}` : null]
        .filter(Boolean)
        .join('   '),
    },
    context.address ? { kind: 'plain' as const, value: context.address } : null,
    {
      kind: 'plain' as const,
      value: [context.phone ? `Tel: ${context.phone}` : null, context.email ? `Email: ${context.email}` : null]
        .filter(Boolean)
        .join('   '),
    },
  ].filter((line): line is NonNullable<typeof line> => !!line && !!line.value)

  const detailStartY = 39 + Math.max(0, companyLines.length - 1) * 4
  detailLines.slice(0, Math.max(2, Math.floor((56 - detailStartY) / 4))).forEach((line, index) => {
    const y = detailStartY + index * 4
    if (line.kind === 'label') drawLabeledIdentityLine(doc, left, identityRight, y, line.label, line.value)
    else drawIdentityLine(doc, left, identityRight, y, line.value)
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  setTextColor(doc, PDF_THEME.colors.text)
  if (context.generatedBy) rightText(doc, 'Generated by', right, 38)

  doc.setFont('helvetica', 'normal')
  setTextColor(doc, PDF_THEME.colors.muted)
  if (context.generatedBy) drawSmartText(doc, context.generatedBy, right, 43, { align: 'right', maxWidth: 58 })

  setFillColor(doc, PDF_THEME.colors.border)
  doc.rect(left, 57, width - left - PDF_THEME.layout.marginRight, 0.3, 'F')
}

export function addFooter(doc: jsPDF, context: ReportPdfContext) {
  const totalPages = doc.getNumberOfPages()
  const height = pageHeight(doc)
  const left = PDF_THEME.layout.marginLeft
  const right = pageWidth(doc) - PDF_THEME.layout.marginRight
  const y = height - PDF_THEME.layout.footerTopOffset

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    setFillColor(doc, PDF_THEME.colors.border)
    doc.rect(left, y - 4, right - left, 0.2, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    setTextColor(doc, PDF_THEME.colors.muted)
    doc.text(`Generated by Kubri | www.kubri.shop | ${context.generatedAtLabel}`, left, y)
    rightText(doc, `Page ${page} of ${totalPages}`, right, y)
  }
}

export async function createReportDoc(context: ReportPdfContext): Promise<{ doc: jsPDF; y: number }> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await registerPdfFonts(doc)
  doc.setProperties({
    title: context.reportTitle,
    subject: context.dateRangeLabel,
    author: 'Kubri',
    creator: 'Kubri',
  })
  addHeader(doc, context)
  return { doc, y: PDF_THEME.layout.contentTop }
}

export function ensureSpace(doc: jsPDF, context: ReportPdfContext, y: number, neededHeight: number): number {
  if (y + neededHeight <= pageHeight(doc) - PDF_THEME.layout.pageBottom) return y
  doc.addPage()
  addHeader(doc, context)
  return PDF_THEME.layout.contentTop
}

export function addSectionTitle(doc: jsPDF, context: ReportPdfContext, y: number, title: string, sub?: string): number {
  const nextY = ensureSpace(doc, context, y, 10)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  setTextColor(doc, PDF_THEME.colors.text)
  doc.text(title, PDF_THEME.layout.marginLeft, nextY)

  if (sub) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    setTextColor(doc, PDF_THEME.colors.muted)
    doc.text(sub, PDF_THEME.layout.marginLeft, nextY + 4)
    return nextY + 8
  }

  return nextY + 5
}

export function addKpiGrid(doc: jsPDF, context: ReportPdfContext, y: number, kpis: PdfKpi[]): number {
  const columns = 3
  const gap = 3
  const boxWidth = (contentWidth(doc) - gap * (columns - 1)) / columns
  const boxHeight = 20
  let nextY = y

  kpis.forEach((kpi, index) => {
    const column = index % columns
    if (column === 0) nextY = ensureSpace(doc, context, nextY, boxHeight + 4)

    const x = PDF_THEME.layout.marginLeft + column * (boxWidth + gap)
    const tone = kpi.tone ?? (index === 0 ? 'green' : 'plain')
    const accentColor = tone === 'gold' ? PDF_THEME.colors.gold : PDF_THEME.colors.green2

    setFillColor(doc, tone === 'green' ? PDF_THEME.colors.softGreen : tone === 'gold' ? PDF_THEME.colors.goldSoft : PDF_THEME.colors.soft)
    doc.roundedRect(x, nextY, boxWidth, boxHeight, 1.5, 1.5, 'F')
    setDrawColor(doc, PDF_THEME.colors.border)
    doc.roundedRect(x, nextY, boxWidth, boxHeight, 1.5, 1.5, 'S')
    setFillColor(doc, accentColor)
    doc.roundedRect(x, nextY, 1.8, boxHeight, 1.5, 1.5, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    setTextColor(doc, PDF_THEME.colors.muted)
    doc.text(kpi.label.toUpperCase(), x + 4, nextY + 5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.2)
    setTextColor(doc, PDF_THEME.colors.text)
    drawSmartText(doc, kpi.value, x + 4, nextY + 12, { maxWidth: boxWidth - 8 }, 'bold', '-')

    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      setTextColor(doc, PDF_THEME.colors.lightText)
      drawSmartText(doc, kpi.sub, x + 4, nextY + 17, { maxWidth: boxWidth - 8 })
    }

    if (column === columns - 1 || index === kpis.length - 1) nextY += boxHeight + 4
  })

  return nextY
}

export function addCompactMessage(doc: jsPDF, context: ReportPdfContext, y: number, message: string): number {
  const left = PDF_THEME.layout.marginLeft
  const width = contentWidth(doc)
  const lines = splitSmartTextToSize(doc, message, width - 8)
  const boxHeight = Math.max(14, lines.length * 4 + 8)
  const nextY = ensureSpace(doc, context, y, boxHeight + 4)

  setFillColor(doc, PDF_THEME.colors.soft)
  doc.roundedRect(left, nextY, width, boxHeight, 1.5, 1.5, 'F')
  setDrawColor(doc, PDF_THEME.colors.border)
  doc.roundedRect(left, nextY, width, boxHeight, 1.5, 1.5, 'S')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  setTextColor(doc, PDF_THEME.colors.warning)
  lines.forEach((line, index) => {
    drawSmartText(doc, line, left + 4, nextY + 6 + index * 4, { maxWidth: width - 8 })
  })

  return nextY + boxHeight + 4
}

export function addFinalNotes(doc: jsPDF, context: ReportPdfContext, y: number, notes: string[]): number {
  if (notes.length === 0) return y
  const left = PDF_THEME.layout.marginLeft
  const width = contentWidth(doc)
  const cleanNotes = notes.map(note => pdfDrawableText(note, '')).filter(Boolean)
  const lines = cleanNotes.flatMap(note => splitSmartTextToSize(doc, note, width - 8))
  const blockHeight = Math.max(12, lines.length * 3.8 + 8)
  const nextY = ensureSpace(doc, context, y, blockHeight + 3)

  setFillColor(doc, PDF_THEME.colors.goldSoft)
  doc.roundedRect(left, nextY, width, blockHeight, 1.2, 1.2, 'F')
  setFillColor(doc, PDF_THEME.colors.gold)
  doc.rect(left, nextY, 1.4, blockHeight, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.2)
  setTextColor(doc, PDF_THEME.colors.text)
  doc.text('Report notes', left + 4, nextY + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  setTextColor(doc, PDF_THEME.colors.muted)
  lines.forEach((line, index) => {
    drawSmartText(doc, line, left + 4, nextY + 9 + index * 3.8, { maxWidth: width - 8 })
  })

  return nextY + blockHeight + 3
}

export function addAutoTable(doc: jsPDF, context: ReportPdfContext, options: PdfTableOptions): number {
  if (options.note) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    setTextColor(doc, PDF_THEME.colors.muted)
    drawSmartText(doc, options.note, PDF_THEME.layout.marginLeft, options.startY, { maxWidth: contentWidth(doc) })
  }

  autoTable(doc, {
    startY: options.note ? options.startY + 4 : options.startY,
    head: [options.head.map(cell => pdfDrawableText(cell, '-'))],
    body: options.body.map(row => row.map(cell => pdfDrawableText(cell, '-'))),
    foot: options.foot ? [options.foot.map(cell => pdfDrawableText(cell, '-'))] : undefined,
    theme: 'grid',
    margin: {
      left: PDF_THEME.layout.marginLeft,
      right: PDF_THEME.layout.marginRight,
      top: PDF_THEME.layout.contentTop,
      bottom: PDF_THEME.layout.pageBottom,
    },
    styles: {
      font: 'helvetica',
      fontSize: options.fontSize ?? 7.2,
      cellPadding: 1.6,
      textColor: PDF_THEME.colors.text,
      lineColor: PDF_THEME.colors.border,
      lineWidth: 0.1,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: PDF_THEME.colors.green,
      textColor: PDF_THEME.colors.white,
      fontStyle: 'bold',
      fontSize: options.fontSize ?? 7.2,
    },
    footStyles: {
      fillColor: PDF_THEME.colors.soft,
      textColor: PDF_THEME.colors.text,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: PDF_THEME.colors.soft,
    },
    columnStyles: options.columnStyles,
    didParseCell: data => {
      const cellText = safeText(Array.isArray(data.cell.text) ? data.cell.text.join(' ') : data.cell.text)
      if (!hasArabicText(cellText) || !isArabicFontReady()) return

      data.cell.styles.font = PDF_ARABIC_FONT
      data.cell.styles.fontStyle = 'normal'
      if (!hasLatinText(cellText)) data.cell.styles.halign = 'right'
    },
    willDrawPage: () => {
      addHeader(doc, context)
    },
  })

  const finalY = (doc as AutoTableDoc).lastAutoTable?.finalY
  return (typeof finalY === 'number' ? finalY : options.startY) + 8
}

export function saveReportDoc(doc: jsPDF, context: ReportPdfContext) {
  addFooter(doc, context)
  doc.save(reportPdfFileName(context))
}
