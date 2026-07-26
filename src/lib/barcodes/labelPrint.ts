import JsBarcode from 'jsbarcode'
import type { BarcodeType } from './barcode'
import { validateBarcode } from './barcode'

export interface BarcodeLabel {
  barcode: string
  barcodeType: BarcodeType
  businessName?: string | null
  productName: string
  productNameAr?: string | null
  unitName: string
  price?: string
  sku?: string | null
  showPrintDate?: boolean
}

export interface LabelPrintSettings {
  widthMm: number
  heightMm: number
  marginMm: number
  columns: number
  copies: number
  template: string
}

export const DEFAULT_LABEL_SETTINGS: LabelPrintSettings = {
  widthMm: 50,
  heightMm: 30,
  marginMm: 2,
  columns: 1,
  copies: 1,
  template: 'thermal_50x30',
}

const FORMAT_BY_TYPE: Partial<Record<BarcodeType, string>> = {
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPC',
  code39: 'CODE39',
  code128: 'CODE128',
  unknown: 'CODE128',
}

export function renderBarcodeSvg(value: string, barcodeType: BarcodeType): string {
  const error = validateBarcode(value, barcodeType)
  if (error) throw new Error(error)
  const format = FORMAT_BY_TYPE[barcodeType]
  if (!format) throw new Error('unsupportedPrintSymbology')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, {
    format,
    displayValue: true,
    lineColor: '#000000',
    background: '#ffffff',
    margin: 0,
    height: 46,
    fontSize: 12,
    xmlDocument: document,
  })
  return svg.outerHTML
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

export function barcodeLabelDocument(label: BarcodeLabel, settings: LabelPrintSettings): string {
  const svg = renderBarcodeSvg(label.barcode, label.barcodeType)
  const copies = Math.max(1, Math.min(500, Math.floor(settings.copies)))
  const columns = Math.max(1, Math.min(5, Math.floor(settings.columns)))
  const width = Math.max(25, Math.min(210, settings.widthMm))
  const height = Math.max(15, Math.min(297, settings.heightMm))
  const margin = Math.max(0, Math.min(10, settings.marginMm))
  const item = `<article class="label">
    ${label.businessName ? `<div class="business">${escapeHtml(label.businessName)}</div>` : ''}
    <div class="product">${escapeHtml(label.productName)}</div>
    ${label.productNameAr ? `<div class="arabic" dir="rtl">${escapeHtml(label.productNameAr)}</div>` : ''}
    <div class="meta"><span>${escapeHtml(label.unitName)}</span>${label.price ? `<strong>${escapeHtml(label.price)}</strong>` : ''}</div>
    <div class="barcode">${svg}</div>
    ${label.sku ? `<div class="sku">${escapeHtml(label.sku)}</div>` : ''}
    ${label.showPrintDate ? `<time>${escapeHtml(new Date().toLocaleDateString())}</time>` : ''}
  </article>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title>
  <style>
    @page { margin: ${margin}mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #000; background: #fff; font: 10px Arial, sans-serif; }
    .sheet { display: grid; grid-template-columns: repeat(${columns}, ${width}mm); gap: 0; }
    .label { width: ${width}mm; height: ${height}mm; overflow: hidden; padding: 1.5mm;
      break-inside: avoid; border: .15mm dashed #bbb; background: #fff; }
    .business,.product,.arabic,.sku,time { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .business { font-size: 8px; } .product { font-weight: 700; font-size: 11px; }
    .arabic { font-family: Arial, sans-serif; font-size: 10px; }
    .meta { display:flex; justify-content:space-between; gap:2mm; font-size:9px; }
    .meta strong { font-size: 11px; } .barcode { height: 14mm; text-align:center; }
    .barcode svg { width: 100%; height: 100%; } .sku,time { font-size:7px; }
    @media print { .label { border-color: transparent; } }
  </style></head><body><main class="sheet">${Array.from({ length: copies }, () => item).join('')}</main></body></html>`
}

export interface BarcodePrintAdapter {
  preview(documentHtml: string): void
}

export const browserBarcodePrintAdapter: BarcodePrintAdapter = {
  preview(documentHtml) {
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.inset = '0'
    frame.style.width = '100%'
    frame.style.height = '100%'
    frame.style.zIndex = '9999'
    frame.style.background = '#fff'
    frame.srcdoc = documentHtml
    document.body.appendChild(frame)
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(() => frame.remove(), 1000)
    }
  },
}
