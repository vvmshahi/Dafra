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

const KUBRI_WORDMARK_PDF_SRC = '/brand/kubiri-wordmark.png?v=kubri-2'
let wordmarkPromise: Promise<string | null> | null = null

export interface PdfKpi {
  label: string
  value: string
  sub?: string | null
  tone?: 'green' | 'teal' | 'blue' | 'slate' | 'gold' | 'amber'
  icon?: string
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

function assetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${base}${path.replace(/^\/+/, '')}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read PDF brand image.'))
    reader.readAsDataURL(blob)
  })
}

async function loadKubriWordmark(): Promise<string | null> {
  if (!wordmarkPromise) {
    wordmarkPromise = fetch(assetUrl(KUBRI_WORDMARK_PDF_SRC))
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load ${KUBRI_WORDMARK_PDF_SRC}`)
        return response.blob()
      })
      .then(blobToDataUrl)
      .catch(error => {
        if (import.meta.env.DEV) console.warn('Kubri PDF wordmark could not be loaded. Falling back to text.', error)
        return null
      })
  }

  return wordmarkPromise
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

function toneColors(tone: NonNullable<PdfKpi['tone']> = 'green'): { bg: Rgb; accent: Rgb; badge: Rgb } {
  if (tone === 'gold') return { bg: [150, 100, 24], accent: PDF_THEME.colors.gold, badge: [172, 119, 31] }
  if (tone === 'amber') return { bg: [157, 83, 25], accent: [226, 147, 55], badge: [183, 98, 30] }
  if (tone === 'teal') return { bg: [18, 111, 101], accent: [68, 190, 172], badge: [25, 135, 122] }
  if (tone === 'blue') return { bg: PDF_THEME.colors.indigo, accent: [99, 153, 230], badge: [51, 95, 168] }
  if (tone === 'slate') return { bg: [50, 64, 78], accent: [132, 148, 166], badge: [68, 82, 98] }
  return { bg: PDF_THEME.colors.green2, accent: [76, 175, 116], badge: [35, 111, 73] }
}

function currentPageNumber(doc: jsPDF): number {
  return doc.internal.getCurrentPageInfo().pageNumber
}

function currentContentTop(doc: jsPDF): number {
  return currentPageNumber(doc) === 1 ? PDF_THEME.layout.contentTop : PDF_THEME.layout.continuedContentTop
}

function kpiIcon(label: string): string {
  const normalized = label.toLowerCase()
  if (/vat|tax|provision/.test(normalized)) return 'VAT'
  if (/invoice|document|credit note|session/.test(normalized)) return '#'
  if (/cash|wallet/.test(normalized)) return '$'
  if (/card|payment/.test(normalized)) return 'CARD'
  if (/expense|cost|purchase|material/.test(normalized)) return 'COST'
  if (/margin|percent|share/.test(normalized)) return '%'
  if (/average|summary/.test(normalized)) return 'AVG'
  if (/profit|sales|revenue|total|gross|net/.test(normalized)) return 'SAR'
  return 'KPI'
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

function drawReportHeaderBar(doc: jsPDF, context: ReportPdfContext) {
  const width = pageWidth(doc)
  const left = PDF_THEME.layout.marginLeft
  const right = width - PDF_THEME.layout.marginRight

  setFillColor(doc, PDF_THEME.colors.green)
  doc.rect(0, 0, width, 30, 'F')
  setFillColor(doc, PDF_THEME.colors.gold)
  doc.rect(0, 30, width, 0.9, 'F')

  if (context.brandWordmarkDataUrl) {
    try {
      doc.addImage(context.brandWordmarkDataUrl, 'PNG', left, 7.4, 29, 7.8, undefined, 'FAST')
    } catch (error) {
      if (import.meta.env.DEV) console.warn('Kubri PDF wordmark embed failed. Falling back to text.', error)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      setTextColor(doc, PDF_THEME.colors.gold)
      doc.text('Kubri', left, 13.9)
    }
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    setTextColor(doc, PDF_THEME.colors.gold)
    doc.text('Kubri', left, 13.9)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  setTextColor(doc, PDF_THEME.colors.white)
  doc.text(context.reportTitle, left, 24.1)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.2)
  setTextColor(doc, PDF_THEME.colors.whiteMuted)
  rightText(doc, 'DATE RANGE', right, 10.5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.3)
  setTextColor(doc, PDF_THEME.colors.white)
  rightText(doc, context.dateRangeLabel, right, 15.4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.2)
  setTextColor(doc, PDF_THEME.colors.whiteMuted)
  rightText(doc, `Generated ${context.generatedAtLabel}`, right, 21.2)
}

function drawFirstPageIdentity(doc: jsPDF, context: ReportPdfContext) {
  const width = pageWidth(doc)
  const left = PDF_THEME.layout.marginLeft
  const right = width - PDF_THEME.layout.marginRight
  const boxY = 35
  const boxHeight = 28
  const gap = 5
  const leftWidth = 58
  const rightWidth = 50
  const centerLeft = left + leftWidth + gap
  const centerRight = right - rightWidth - gap
  const centerWidth = centerRight - centerLeft
  const rightLeft = right - rightWidth

  setFillColor(doc, PDF_THEME.colors.white)
  doc.roundedRect(left, boxY, right - left, boxHeight, 2.2, 2.2, 'F')
  setDrawColor(doc, PDF_THEME.colors.border)
  doc.roundedRect(left, boxY, right - left, boxHeight, 2.2, 2.2, 'S')
  setFillColor(doc, PDF_THEME.colors.gold)
  doc.rect(left, boxY + 3, 1.2, boxHeight - 6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  setTextColor(doc, PDF_THEME.colors.gold)
  doc.text('BUSINESS PROFILE', left + 4, boxY + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  setTextColor(doc, PDF_THEME.colors.muted)

  const leftLines = [
    { label: 'Branch', value: context.branchName },
    context.vatNumber ? { label: 'VAT', value: context.vatNumber } : null,
    context.crNumber ? { label: 'CR', value: context.crNumber } : null,
    context.address ? { label: 'Address', value: context.address } : null,
    context.phone ? { label: 'Phone', value: context.phone } : null,
    context.email ? { label: 'Email', value: context.email } : null,
  ].filter((line): line is { label: string; value: string } => !!line)

  leftLines.slice(0, 6).forEach((line, index) => {
    drawLabeledIdentityLine(doc, left + 4, left + leftWidth, boxY + 11 + index * 3.2, line.label, line.value)
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  setTextColor(doc, PDF_THEME.colors.text)
  const companyLines = splitSmartTextToSize(doc, context.companyName, centerWidth, 'bold', 'Business').slice(0, 2)
  companyLines.forEach((line, index) => {
    drawSmartText(
      doc,
      line,
      (centerLeft + centerRight) / 2,
      boxY + 10 + index * 4.7,
      { align: 'center', maxWidth: centerWidth },
      'bold',
      'Business',
    )
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.2)
  setTextColor(doc, PDF_THEME.colors.green2)
  drawSmartText(doc, context.branchName, (centerLeft + centerRight) / 2, boxY + 21, { align: 'center', maxWidth: centerWidth }, 'bold')

  if (context.legalName) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.6)
    setTextColor(doc, PDF_THEME.colors.muted)
    drawSmartText(doc, context.legalName, (centerLeft + centerRight) / 2, boxY + 25.2, { align: 'center', maxWidth: centerWidth })
  }

  setDrawColor(doc, PDF_THEME.colors.border)
  doc.line(centerLeft - 2.5, boxY + 5, centerLeft - 2.5, boxY + boxHeight - 5)
  doc.line(rightLeft - 2.5, boxY + 5, rightLeft - 2.5, boxY + boxHeight - 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  setTextColor(doc, PDF_THEME.colors.gold)
  rightText(doc, 'PREPARED BY', right - 4, boxY + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.2)
  setTextColor(doc, PDF_THEME.colors.muted)
  drawSmartText(doc, context.generatedBy ?? '-', right - 4, boxY + 11.3, { align: 'right', maxWidth: rightWidth - 4 }, 'normal', '-')
  drawSmartText(doc, context.branchName, right - 4, boxY + 16, { align: 'right', maxWidth: rightWidth - 4 }, 'normal')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  setTextColor(doc, PDF_THEME.colors.text)
  rightText(doc, 'Generated', right - 4, boxY + 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.7)
  setTextColor(doc, PDF_THEME.colors.muted)
  rightText(doc, context.generatedAtLabel, right - 4, boxY + 26)

  setDrawColor(doc, PDF_THEME.colors.border)
  doc.line(left, boxY + boxHeight + 3, width - PDF_THEME.layout.marginRight, boxY + boxHeight + 3)
}

export function addHeader(doc: jsPDF, context: ReportPdfContext) {
  drawReportHeaderBar(doc, context)
  if (currentPageNumber(doc) === 1) drawFirstPageIdentity(doc, context)
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
  context.brandWordmarkDataUrl = await loadKubriWordmark()
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
  return currentContentTop(doc)
}

export function addSectionTitle(doc: jsPDF, context: ReportPdfContext, y: number, title: string, sub?: string): number {
  const nextY = ensureSpace(doc, context, y + 4, sub ? 16 : 11)
  const left = PDF_THEME.layout.marginLeft
  const right = pageWidth(doc) - PDF_THEME.layout.marginRight

  setFillColor(doc, PDF_THEME.colors.gold)
  doc.rect(left, nextY - 4.5, 1.2, 7.8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.2)
  setTextColor(doc, PDF_THEME.colors.text)
  doc.text(title, left + 4, nextY)

  const dividerStart = left + 4 + measureSmartText(doc, title, 'bold') + 8
  if (dividerStart < right - 12) {
    setDrawColor(doc, PDF_THEME.colors.border)
    doc.line(dividerStart, nextY + 2.2, right, nextY + 2.2)
  }

  if (sub) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    setTextColor(doc, PDF_THEME.colors.muted)
    doc.text(sub, left + 4, nextY + 6)
    return nextY + 13
  }

  return nextY + 9.5
}

export function addKpiGrid(doc: jsPDF, context: ReportPdfContext, y: number, kpis: PdfKpi[]): number {
  const columns = 3
  const gap = 3.2
  const boxWidth = (contentWidth(doc) - gap * (columns - 1)) / columns
  const boxHeight = 24
  let nextY = y

  kpis.forEach((kpi, index) => {
    const column = index % columns
    if (column === 0) nextY = ensureSpace(doc, context, nextY, boxHeight + 5)

    const x = PDF_THEME.layout.marginLeft + column * (boxWidth + gap)
    const tone = kpi.tone ?? (index % 3 === 0 ? 'green' : index % 3 === 1 ? 'slate' : 'gold')
    const colors = toneColors(tone)
    const icon = kpi.icon ?? kpiIcon(kpi.label)
    const badgeSize = 8.4

    setFillColor(doc, colors.bg)
    doc.roundedRect(x, nextY, boxWidth, boxHeight, 2, 2, 'F')
    setFillColor(doc, colors.accent)
    doc.rect(x, nextY, 1.5, boxHeight, 'F')
    setFillColor(doc, colors.badge)
    doc.roundedRect(x + boxWidth - badgeSize - 3, nextY + 3, badgeSize, badgeSize, 1.5, 1.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(icon.length > 3 ? 4.6 : 5.8)
    setTextColor(doc, PDF_THEME.colors.white)
    drawSmartText(doc, icon, x + boxWidth - badgeSize / 2 - 3, nextY + 8.4, { align: 'center', maxWidth: badgeSize - 1 }, 'bold')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.4)
    setTextColor(doc, PDF_THEME.colors.cardMuted)
    drawSmartText(doc, kpi.label.toUpperCase(), x + 4.8, nextY + 5.7, { maxWidth: boxWidth - badgeSize - 12 }, 'normal', '-')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.2)
    setTextColor(doc, PDF_THEME.colors.white)
    drawSmartText(doc, kpi.value, x + 4.8, nextY + 14.1, { maxWidth: boxWidth - 9 }, 'bold', '-')

    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.4)
      setTextColor(doc, PDF_THEME.colors.cardMuted)
      drawSmartText(doc, kpi.sub, x + 4.8, nextY + 20, { maxWidth: boxWidth - 9 })
    }

    if (column === columns - 1 || index === kpis.length - 1) nextY += boxHeight + 5
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
    startY: options.note ? options.startY + 5 : options.startY,
    head: [options.head.map(cell => pdfDrawableText(cell, '-'))],
    body: options.body.map(row => row.map(cell => pdfDrawableText(cell, '-'))),
    foot: options.foot ? [options.foot.map(cell => pdfDrawableText(cell, '-'))] : undefined,
    theme: 'grid',
    margin: {
      left: PDF_THEME.layout.marginLeft,
      right: PDF_THEME.layout.marginRight,
      top: PDF_THEME.layout.continuedContentTop,
      bottom: PDF_THEME.layout.pageBottom,
    },
    styles: {
      font: 'helvetica',
      fontSize: options.fontSize ?? 7.2,
      cellPadding: { top: 2.2, right: 1.8, bottom: 2.2, left: 1.8 },
      textColor: PDF_THEME.colors.text,
      lineColor: PDF_THEME.colors.border,
      lineWidth: 0.08,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: PDF_THEME.colors.green,
      textColor: PDF_THEME.colors.white,
      fontStyle: 'bold',
      fontSize: options.fontSize ?? 7.2,
      cellPadding: { top: 2.4, right: 1.8, bottom: 2.4, left: 1.8 },
    },
    footStyles: {
      fillColor: PDF_THEME.colors.goldSoft,
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
  return (typeof finalY === 'number' ? finalY : options.startY) + 9
}

export function saveReportDoc(doc: jsPDF, context: ReportPdfContext) {
  addFooter(doc, context)
  const fileName = reportPdfFileName(context)

  try {
    doc.save(fileName)
    return
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('Kubri report PDF save failed; trying Blob download fallback.', error)
    }
  }

  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  try {
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}
