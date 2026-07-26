import type { Branch, Tenant } from '@/types'
import type {
  SupplierHistoryRow,
  SupplierInsight,
  SupplierIntelligenceFilters,
  SupplierIntelligenceResponse,
} from './supplierIntelligence'

export const SUPPLIER_REPORT_HISTORY_LIMIT = 100

export interface SupplierReportCopy {
  title: string
  generatedAt: string
  selectedPeriod: string
  filters: string
  allBranches: string
  allProducts: string
  allUnits: string
  allPaymentStatuses: string
  supplier: string
  phone: string
  email: string
  vatNumber: string
  grossPurchases: string
  purchaseCount: string
  averagePurchase: string
  lastPurchase: string
  purchaseFrequency: string
  daysSinceLastPurchase: string
  days: string
  topProducts: string
  product: string
  unit: string
  quantity: string
  baseQuantity: string
  amount: string
  averageCost: string
  purchases: string
  purchaseTimeline: string
  period: string
  supplierInsights: string
  paymentStatus: string
  purchaseHistory: string
  date: string
  reference: string
  referenceMissing: string
  branch: string
  items: string
  documentStatus: string
  disclaimer: string
  limitedHistory: string
  informationalPayment: string
  print: string
  close: string
  noData: string
  paymentStatuses: Record<string, string>
  statuses: Record<string, string>
  insightText: (insight: SupplierInsight) => string
}

export interface SupplierReportPrintInput {
  data: SupplierIntelligenceResponse
  history: SupplierHistoryRow[]
  historyTotalCount: number
  filters: SupplierIntelligenceFilters
  filterLabels: {
    branch: string
    product: string
    unit: string
    paymentStatus: string
    dateRange: string
  }
  tenant: Tenant | null
  branch: Branch | null
  locale: string
  copy: SupplierReportCopy
  insights: SupplierInsight[]
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

export function openSupplierReportWindow(preparingLabel: string): Window | null {
  const reportWindow = window.open('about:blank', '_blank')
  if (reportWindow) {
    reportWindow.opener = null
    reportWindow.document.write(`<!doctype html><title>${escapeHtml(preparingLabel)}</title>`)
    reportWindow.document.close()
  }
  return reportWindow
}

export function renderSupplierIntelligenceReport(
  reportWindow: Window,
  input: SupplierReportPrintInput,
) {
  const { data, copy, locale } = input
  const rtl = locale === 'ar-SA'
  const businessName = rtl
    ? input.branch?.business_name_ar || input.tenant?.name_ar || input.branch?.business_name || input.tenant?.name
    : input.branch?.business_name || input.tenant?.name || input.branch?.business_name_ar || input.tenant?.name_ar
  const branchName = rtl
    ? input.branch?.name_ar || input.branch?.name
    : input.branch?.name || input.branch?.name_ar
  const supplierName = rtl
    ? data.supplier.nameAr || data.supplier.name
    : data.supplier.name || data.supplier.nameAr
  const lastPurchase = data.summary.lastPurchase
    ? `${localDate(data.summary.lastPurchase.createdAt, locale, true)}${data.summary.lastPurchase.reference ? ` · ${data.summary.lastPurchase.reference}` : ''}`
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
        <td class="number">${product.baseQuantity == null ? '—' : escapeHtml(quantity(product.baseQuantity))}</td>
        <td class="number">${currencyCell(product.grossAmount)}</td>
        <td class="number">${product.averageUnitCost == null ? '—' : currencyCell(product.averageUnitCost)}</td>
        <td class="number">${escapeHtml(product.purchaseCount)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const timelineRows = data.timeline.length
    ? data.timeline.map(point => `
      <tr>
        <td>${escapeHtml(localDate(point.bucketStart, locale))}</td>
        <td class="number">${currencyCell(point.grossPurchases)}</td>
        <td class="number">${escapeHtml(point.purchaseCount)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const paymentRows = data.paymentStatusSummary.length
    ? data.paymentStatusSummary.map(row => `
      <tr>
        <td>${escapeHtml(copy.paymentStatuses[row.status] ?? row.status)}</td>
        <td class="number">${escapeHtml(row.purchaseCount)}</td>
        <td class="number">${currencyCell(row.grossPurchases)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" class="empty">${escapeHtml(copy.noData)}</td></tr>`

  const historyRows = input.history.length
    ? input.history.map(row => `
      <tr>
        <td>${escapeHtml(localDate(row.createdAt, locale, true))}</td>
        <td>${escapeHtml(row.reference || copy.referenceMissing)}</td>
        <td>${escapeHtml(rtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr)}</td>
        <td class="number">${escapeHtml(row.itemCount)}</td>
        <td class="number">${currencyCell(row.grossAmount)}</td>
        <td>${escapeHtml(copy.paymentStatuses[row.paymentStatus] ?? row.paymentStatus)}</td>
        <td>${escapeHtml(copy.statuses[row.receivingStatus] ?? copy.statuses[row.status] ?? row.status)}</td>
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
  <title>${escapeHtml(copy.title)} · ${escapeHtml(supplierName)}</title>
  <style>
    @font-face { font-family:"KubriArabic"; src:url("/fonts/NotoNaskhArabic-Regular.ttf") format("truetype"); font-display:swap; }
    @font-face { font-family:"SaudiRiyal"; src:url("/fonts/SaudiRiyal.woff2") format("woff2"); font-display:block; }
    :root { color-scheme:light; --ink:#18241f; --muted:#66736d; --line:#dfe7e3; --soft:#f6f5f1; --brand:#1b6b3a; --accent:#b7791f; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:#eef2f0; font-family:Arial,"KubriArabic",sans-serif; }
    .toolbar { position:sticky; top:0; z-index:2; display:flex; justify-content:flex-end; gap:8px; padding:12px max(16px,calc((100% - 210mm)/2)); background:#fff; border-bottom:1px solid var(--line); }
    button { border:1px solid var(--line); border-radius:8px; background:#fff; padding:8px 14px; color:var(--ink); font:inherit; cursor:pointer; }
    button.primary { border-color:var(--brand); background:var(--brand); color:#fff; }
    main { width:210mm; min-height:297mm; margin:18px auto; background:#fff; padding:16mm 14mm; box-shadow:0 8px 30px #1f3d3020; }
    header { display:flex; justify-content:space-between; gap:24px; padding-bottom:16px; border-bottom:2px solid var(--ink); }
    h1 { margin:0; font-size:22px; line-height:1.35; overflow-wrap:anywhere; }
    h2 { margin:22px 0 8px; font-size:14px; }
    p { margin:3px 0; font-size:11px; line-height:1.55; }
    .muted { color:var(--muted); }
    .identity { margin-top:15px; display:grid; grid-template-columns:1.2fr .8fr; gap:12px; }
    .panel { border:1px solid var(--line); border-radius:10px; padding:11px 12px; overflow-wrap:anywhere; }
    .label { color:var(--muted); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .value { margin-top:2px; font-weight:700; overflow-wrap:anywhere; }
    .metrics { margin-top:12px; display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
    .metric { border:1px solid var(--line); border-radius:9px; padding:9px; min-height:56px; break-inside:avoid; }
    .metric.primary { background:#eef8f3; border-color:#bfe2d2; }
    .currency { display:inline-flex; align-items:baseline; gap:2px; direction:ltr; unicode-bidi:isolate; white-space:nowrap; }
    .riyal { font-family:"SaudiRiyal"; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8.5px; }
    thead { display:table-header-group; }
    th { text-align:start; color:var(--muted); background:var(--soft); border-block:1px solid var(--line); padding:6px; }
    td { padding:6px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
    .number { text-align:end; font-variant-numeric:tabular-nums; }
    .empty { text-align:center; color:var(--muted); padding:16px; }
    ul { margin:0; padding-inline-start:20px; columns:2; column-gap:28px; }
    li { break-inside:avoid; font-size:10px; margin-bottom:5px; line-height:1.5; }
    .notice { margin-top:14px; border-inline-start:3px solid var(--brand); background:#eef8f3; padding:8px 10px; font-size:9px; line-height:1.6; }
    .info { margin:5px 0 8px; color:var(--muted); font-size:9px; }
    @media print {
      @page { size:A4; margin:11mm; }
      body { background:#fff; }
      .toolbar { display:none; }
      main { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; }
      h2 { break-after:avoid; }
      .panel, .metric { break-inside:avoid; page-break-inside:avoid; }
      tr { break-inside:avoid; page-break-inside:avoid; }
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
        <div class="label">${escapeHtml(copy.supplier)}</div>
        <div class="value">${escapeHtml(supplierName)}</div>
        ${data.supplier.phone ? `<p>${escapeHtml(copy.phone)}: <span dir="ltr">${escapeHtml(data.supplier.phone)}</span></p>` : ''}
        ${data.supplier.email ? `<p>${escapeHtml(copy.email)}: <span dir="ltr">${escapeHtml(data.supplier.email)}</span></p>` : ''}
        ${data.supplier.vatNumber ? `<p>${escapeHtml(copy.vatNumber)}: <span dir="ltr">${escapeHtml(data.supplier.vatNumber)}</span></p>` : ''}
      </section>
      <section class="panel">
        <div class="label">${escapeHtml(copy.filters)}</div>
        <p>${escapeHtml(input.filterLabels.branch)}</p>
        <p>${escapeHtml(input.filterLabels.product)}</p>
        <p>${escapeHtml(input.filterLabels.unit)}</p>
        <p>${escapeHtml(input.filterLabels.paymentStatus)}</p>
      </section>
    </div>

    <section class="metrics">
      <div class="metric primary"><div class="label">${escapeHtml(copy.grossPurchases)}</div><div class="value">${currencyCell(data.summary.grossPurchases)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.purchaseCount)}</div><div class="value">${escapeHtml(data.summary.purchaseCount)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.averagePurchase)}</div><div class="value">${currencyCell(data.summary.averagePurchaseValue)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.lastPurchase)}</div><div class="value">${escapeHtml(lastPurchase)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.purchaseFrequency)}</div><div class="value">${escapeHtml(frequency)}</div></div>
      <div class="metric"><div class="label">${escapeHtml(copy.daysSinceLastPurchase)}</div><div class="value">${data.summary.daysSinceLastPurchase == null ? '—' : escapeHtml(data.summary.daysSinceLastPurchase)}</div></div>
    </section>

    <h2>${escapeHtml(copy.supplierInsights)}</h2>
    <section class="panel"><ul>${insightRows}</ul></section>

    <h2>${escapeHtml(copy.topProducts)}</h2>
    <table>
      <thead><tr><th>${escapeHtml(copy.product)}</th><th>${escapeHtml(copy.unit)}</th><th class="number">${escapeHtml(copy.quantity)}</th><th class="number">${escapeHtml(copy.baseQuantity)}</th><th class="number">${escapeHtml(copy.amount)}</th><th class="number">${escapeHtml(copy.averageCost)}</th><th class="number">${escapeHtml(copy.purchases)}</th></tr></thead>
      <tbody>${topRows}</tbody>
    </table>

    <h2>${escapeHtml(copy.purchaseTimeline)}</h2>
    <table>
      <thead><tr><th>${escapeHtml(copy.period)}</th><th class="number">${escapeHtml(copy.grossPurchases)}</th><th class="number">${escapeHtml(copy.purchases)}</th></tr></thead>
      <tbody>${timelineRows}</tbody>
    </table>

    <h2>${escapeHtml(copy.paymentStatus)}</h2>
    <p class="info">${escapeHtml(copy.informationalPayment)}</p>
    <table>
      <thead><tr><th>${escapeHtml(copy.paymentStatus)}</th><th class="number">${escapeHtml(copy.purchases)}</th><th class="number">${escapeHtml(copy.grossPurchases)}</th></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>

    <h2>${escapeHtml(copy.purchaseHistory)}</h2>
    ${input.historyTotalCount > input.history.length ? `<p class="info">${escapeHtml(copy.limitedHistory.replace('{{count}}', String(input.history.length)).replace('{{total}}', String(input.historyTotalCount)))}</p>` : ''}
    <table>
      <thead><tr><th>${escapeHtml(copy.date)}</th><th>${escapeHtml(copy.reference)}</th><th>${escapeHtml(copy.branch)}</th><th class="number">${escapeHtml(copy.items)}</th><th class="number">${escapeHtml(copy.amount)}</th><th>${escapeHtml(copy.paymentStatus)}</th><th>${escapeHtml(copy.documentStatus)}</th></tr></thead>
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
