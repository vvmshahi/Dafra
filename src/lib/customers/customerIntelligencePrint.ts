import type { Branch, Tenant } from '@/types'
import type {
  CustomerHistoryRow,
  CustomerInsight,
  CustomerIntelligenceFilters,
  CustomerIntelligenceResponse,
} from './customerIntelligence'

export const CUSTOMER_REPORT_HISTORY_LIMIT = 100

export interface CustomerReportCopy {
  title: string
  generatedAt: string
  selectedPeriod: string
  filters: string
  allBranches: string
  allProducts: string
  allUnits: string
  customer: string
  phone: string
  vatNumber: string
  grossPurchases: string
  creditedAmount: string
  netPurchases: string
  invoiceCount: string
  creditNoteCount: string
  averageInvoice: string
  lastPurchase: string
  purchaseFrequency: string
  days: string
  topProducts: string
  product: string
  unit: string
  quantity: string
  amount: string
  invoices: string
  purchaseTimeline: string
  period: string
  gross: string
  credited: string
  net: string
  customerInsights: string
  documentHistory: string
  date: string
  document: string
  branch: string
  items: string
  disclaimer: string
  limitedHistory: string
  print: string
  close: string
  noData: string
  documentTypes: Record<string, string>
  insightText: (insight: CustomerInsight) => string
}

export interface CustomerReportPrintInput {
  data: CustomerIntelligenceResponse
  history: CustomerHistoryRow[]
  historyTotalCount: number
  filters: CustomerIntelligenceFilters
  filterLabels: {
    branch: string
    product: string
    unit: string
    dateRange: string
  }
  tenant: Tenant | null
  branch: Branch | null
  locale: string
  copy: CustomerReportCopy
  insights: CustomerInsight[]
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const money = (value: number) => value.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const quantity = (value: number) => value.toLocaleString('en-US', {
  maximumFractionDigits: 6,
})

function localDate(value: string, locale: string, withTime = false) {
  return new Date(value).toLocaleString(
    locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA',
    withTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { dateStyle: 'medium' },
  )
}

function currencyCell(value: number) {
  return `<span class="currency"><span class="riyal">ê</span><span>${escapeHtml(money(value))}</span></span>`
}

export function openCustomerReportWindow(preparingLabel: string): Window | null {
  const reportWindow = window.open('about:blank', '_blank')
  if (reportWindow) {
    reportWindow.opener = null
    reportWindow.document.write(`<!doctype html><title>${escapeHtml(preparingLabel)}</title>`)
    reportWindow.document.close()
  }
  return reportWindow
}

export function renderCustomerIntelligenceReport(
  reportWindow: Window,
  input: CustomerReportPrintInput,
) {
  const { data, copy, locale } = input
  const rtl = locale === 'ar-SA'
  const businessName = rtl
    ? input.branch?.business_name_ar || input.tenant?.name_ar || input.branch?.business_name || input.tenant?.name
    : input.branch?.business_name || input.tenant?.name || input.branch?.business_name_ar || input.tenant?.name_ar
  const branchName = rtl
    ? input.branch?.name_ar || input.branch?.name
    : input.branch?.name || input.branch?.name_ar
  const customerName = rtl
    ? data.customer.businessNameAr || data.customer.nameAr || data.customer.businessName || data.customer.name
    : data.customer.businessName || data.customer.name || data.customer.businessNameAr || data.customer.nameAr
  const lastPurchase = data.summary.lastPurchase
    ? `${localDate(data.summary.lastPurchase.createdAt, locale, true)} · ${data.summary.lastPurchase.reference}`
    : '—'
  const frequency = data.summary.averageDaysBetweenPurchases == null
    ? '—'
    : `${data.summary.averageDaysBetweenPurchases.toLocaleString('en-US')} ${copy.days}`

  const topRows = data.topProducts.length
    ? data.topProducts.map(product => `
      <tr>
        <td>${escapeHtml(rtl ? product.nameAr || product.name : product.name || product.nameAr)}</td>
        <td>${escapeHtml(rtl ? product.unitNameAr || product.unitName : product.unitName || product.unitNameAr)}</td>
        <td class="number">${escapeHtml(quantity(product.quantity))}</td>
        <td class="number">${currencyCell(product.grossAmount)}</td>
        <td class="number">${escapeHtml(product.invoiceCount)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const timelineRows = data.timeline.length
    ? data.timeline.map(point => `
      <tr>
        <td>${escapeHtml(localDate(point.bucketStart, locale))}</td>
        <td class="number">${currencyCell(point.grossPurchases)}</td>
        <td class="number">${currencyCell(point.creditedAmount)}</td>
        <td class="number">${currencyCell(point.netPurchases)}</td>
        <td class="number">${escapeHtml(point.invoiceCount)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const historyRows = input.history.length
    ? input.history.map(row => `
      <tr>
        <td>${escapeHtml(localDate(row.createdAt, locale, true))}</td>
        <td>${escapeHtml(copy.documentTypes[row.documentType] ?? row.documentType)}<br><span class="muted">${escapeHtml(row.reference)}</span></td>
        <td>${escapeHtml(rtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr)}</td>
        <td class="number">${escapeHtml(row.itemCount)}</td>
        <td class="number">${currencyCell(row.grossAmount)}</td>
        <td class="number">${currencyCell(row.creditedAmount)}</td>
        <td class="number">${currencyCell(row.netEffect)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const insightRows = input.insights
    .map(insight => `<li>${escapeHtml(copy.insightText(insight))}</li>`)
    .join('')

  const html = `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.title)} · ${escapeHtml(customerName)}</title>
  <style>
    @font-face { font-family:"KubriArabic"; src:url("/fonts/NotoNaskhArabic-Regular.ttf") format("truetype"); font-display:swap; }
    @font-face { font-family:"SaudiRiyal"; src:url("/fonts/SaudiRiyal.woff2") format("woff2"); font-display:block; }
    :root { color-scheme:light; --ink:#18241f; --muted:#66736d; --line:#dfe7e3; --soft:#f3f7f5; --brand:#0f8a5f; --credit:#a65f15; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:#eef2f0; font-family:Arial,"KubriArabic",sans-serif; }
    .toolbar { position:sticky; top:0; z-index:2; display:flex; justify-content:flex-end; gap:8px; padding:12px max(16px,calc((100% - 210mm)/2)); background:#fff; border-bottom:1px solid var(--line); }
    button { border:1px solid var(--line); border-radius:8px; background:#fff; padding:8px 14px; color:var(--ink); font:inherit; cursor:pointer; }
    button.primary { border-color:var(--brand); background:var(--brand); color:#fff; }
    main { width:210mm; min-height:297mm; margin:18px auto; background:#fff; padding:16mm 14mm; box-shadow:0 8px 30px #1f3d3020; }
    header { display:flex; justify-content:space-between; gap:24px; padding-bottom:16px; border-bottom:2px solid var(--ink); }
    h1 { margin:0; font-size:22px; line-height:1.35; }
    h2 { margin:22px 0 8px; font-size:14px; }
    p { margin:3px 0; font-size:11px; line-height:1.55; }
    .muted { color:var(--muted); }
    .identity { margin-top:15px; display:grid; grid-template-columns:1.2fr .8fr; gap:12px; }
    .panel { border:1px solid var(--line); border-radius:10px; padding:11px 12px; overflow-wrap:anywhere; }
    .label { color:var(--muted); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .value { margin-top:2px; font-weight:700; }
    .metrics { margin-top:12px; display:grid; grid-template-columns:repeat(4,1fr); gap:7px; }
    .metric { border:1px solid var(--line); border-radius:9px; padding:9px; min-height:56px; }
    .metric.net { background:#eef8f3; border-color:#bfe2d2; }
    .metric.credit .value { color:var(--credit); }
    .currency { display:inline-flex; align-items:baseline; gap:2px; direction:ltr; unicode-bidi:isolate; }
    .riyal { font-family:"SaudiRiyal"; }
    .equation { margin-top:8px; padding:8px 10px; background:var(--soft); border-radius:8px; font-size:10px; color:var(--muted); }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; }
    thead { display:table-header-group; }
    th { text-align:start; color:var(--muted); background:var(--soft); border-block:1px solid var(--line); padding:6px; }
    td { padding:6px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
    .number { text-align:end; font-variant-numeric:tabular-nums; }
    .empty { text-align:center; color:var(--muted); padding:16px; }
    ul { margin:0; padding-inline-start:20px; columns:2; column-gap:28px; }
    li { break-inside:avoid; font-size:10px; margin-bottom:5px; line-height:1.5; }
    .notice { margin-top:14px; border-inline-start:3px solid var(--brand); background:var(--soft); padding:8px 10px; font-size:9px; line-height:1.6; }
    .history-note { margin:5px 0 8px; color:var(--muted); font-size:9px; }
    @media print {
      @page { size:A4; margin:11mm; }
      body { background:#fff; }
      .toolbar { display:none; }
      main { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; }
      h2 { break-after:avoid; }
      .panel, .metric { break-inside:avoid; }
      tr { break-inside:avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.close()">${escapeHtml(copy.close)}</button>
    <button type="button" class="primary" onclick="window.print()">${escapeHtml(copy.print)}</button>
  </div>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(copy.title)}</h1>
        <p class="muted">${escapeHtml(businessName || '—')}</p>
        <p class="muted">${escapeHtml(branchName || input.filterLabels.branch)}</p>
      </div>
      <div>
        <p><span class="label">${escapeHtml(copy.generatedAt)}</span><br>${escapeHtml(localDate(new Date().toISOString(), locale, true))}</p>
        <p><span class="label">${escapeHtml(copy.selectedPeriod)}</span><br>${escapeHtml(input.filterLabels.dateRange)}</p>
      </div>
    </header>

    <div class="identity">
      <section class="panel">
        <div class="label">${escapeHtml(copy.customer)}</div>
        <div class="value">${escapeHtml(customerName)}</div>
        ${data.customer.phone ? `<p>${escapeHtml(copy.phone)}: <span dir="ltr">${escapeHtml(data.customer.phone)}</span></p>` : ''}
        ${data.customer.vatNumber ? `<p>${escapeHtml(copy.vatNumber)}: <span dir="ltr">${escapeHtml(data.customer.vatNumber)}</span></p>` : ''}
      </section>
      <section class="panel">
        <div class="label">${escapeHtml(copy.filters)}</div>
        <p>${escapeHtml(input.filterLabels.branch)}</p>
        <p>${escapeHtml(input.filterLabels.product)}</p>
        <p>${escapeHtml(input.filterLabels.unit)}</p>
      </section>
    </div>

    <section class="metrics">
      <div class="metric"><div class="label">${escapeHtml(copy.grossPurchases)}</div><div class="value">${currencyCell(data.summary.grossPurchases)}</div></div>
      <div class="metric credit"><div class="label">${escapeHtml(copy.creditedAmount)}</div><div class="value">${currencyCell(data.summary.creditedAmount)}</div></div>
      <div class="metric net"><div class="label">${escapeHtml(copy.netPurchases)}</div><div class="value">${currencyCell(data.summary.netPurchases)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.averageInvoice)}</div><div class="value">${currencyCell(data.summary.averageInvoiceValue)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.invoiceCount)}</div><div class="value">${escapeHtml(data.summary.invoiceCount)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.creditNoteCount)}</div><div class="value">${escapeHtml(data.summary.creditNoteCount)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.lastPurchase)}</div><div class="value">${escapeHtml(lastPurchase)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.purchaseFrequency)}</div><div class="value">${escapeHtml(frequency)}</div></div>
    </section>
    <div class="equation">${escapeHtml(copy.grossPurchases)} − ${escapeHtml(copy.creditedAmount)} = ${escapeHtml(copy.netPurchases)}</div>

    <h2>${escapeHtml(copy.customerInsights)}</h2>
    <section class="panel"><ul>${insightRows}</ul></section>

    <h2>${escapeHtml(copy.topProducts)}</h2>
    <table>
      <thead><tr><th>${escapeHtml(copy.product)}</th><th>${escapeHtml(copy.unit)}</th><th class="number">${escapeHtml(copy.quantity)}</th><th class="number">${escapeHtml(copy.amount)}</th><th class="number">${escapeHtml(copy.invoices)}</th></tr></thead>
      <tbody>${topRows}</tbody>
    </table>

    <h2>${escapeHtml(copy.purchaseTimeline)}</h2>
    <table>
      <thead><tr><th>${escapeHtml(copy.period)}</th><th class="number">${escapeHtml(copy.gross)}</th><th class="number">${escapeHtml(copy.credited)}</th><th class="number">${escapeHtml(copy.net)}</th><th class="number">${escapeHtml(copy.invoices)}</th></tr></thead>
      <tbody>${timelineRows}</tbody>
    </table>

    <h2>${escapeHtml(copy.documentHistory)}</h2>
    ${input.historyTotalCount > input.history.length ? `<p class="history-note">${escapeHtml(copy.limitedHistory.replace('{{count}}', String(input.history.length)).replace('{{total}}', String(input.historyTotalCount)))}</p>` : ''}
    <table>
      <thead><tr><th>${escapeHtml(copy.date)}</th><th>${escapeHtml(copy.document)}</th><th>${escapeHtml(copy.branch)}</th><th class="number">${escapeHtml(copy.items)}</th><th class="number">${escapeHtml(copy.gross)}</th><th class="number">${escapeHtml(copy.credited)}</th><th class="number">${escapeHtml(copy.net)}</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>

    <p class="notice">${escapeHtml(copy.disclaimer)}</p>
  </main>
</body>
</html>`

  reportWindow.document.open()
  reportWindow.document.write(html)
  reportWindow.document.close()
  void reportWindow.document.fonts?.ready.then(() => reportWindow.focus())
}
