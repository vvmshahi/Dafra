import type { ReactNode } from 'react'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'
import {
  documentDirection,
  documentFontFamily,
  documentLabel,
  documentLabelLines,
  documentNames,
  documentPaymentLabel,
  normalizeDocumentLanguage,
  type DocumentLanguage,
} from '@/localization/documents'

export interface ThermalItem {
  name: string
  nameAr?: string | null
  qty: number
  unitPrice: number
  lineTotal: number
  subtotal?: number
  taxAmount?: number
  total?: number
}

export interface ThermalPayment {
  method: string
  amount: number
}

export interface ThermalReceiptProps {
  id?: string
  preview?: boolean
  // Line 1 (large, bold): brand/display name
  // Line 2 (small, grey): legal name — only printed if different from Line 1
  businessNameAr: string   // Line 1 — brand name (could be Arabic or English)
  businessNameEn: string   // Line 2 — legal company name (shown below only if different)
  documentLanguage?: DocumentLanguage
  logoUrl?: string | null
  showLogo?: boolean
  branchName?: string | null
  branchNameAr?: string | null
  address?: string | null
  addressAr?: string | null
  vatNumber?: string | null
  phone?: string | null
  website?: string | null
  showWebsite?: boolean
  email?: string | null
  showEmail?: boolean
  invoiceNumber: string
  date: string
  time: string
  cashierName?: string | null  // kept for API compat but no longer rendered
  items: ThermalItem[]
  subtotal: number
  discountAmount?: number
  taxAmount: number
  total: number
  paymentMethod: string
  payments?: ThermalPayment[]
  cashReceived?: number | null
  change?: number | null
  showCashChange?: boolean
  customerName?: string | null
  customerNameAr?: string | null
  buyerVatNumber?: string | null
  isStandardInvoice?: boolean
  documentType?: 'invoice' | 'credit_note'
  originalInvoiceNumber?: string | null
  creditReason?: string | null
  qrDataUrl?: string | null
  receiptFooter?: string | null
  showFooter?: boolean
}

function Amt({ n }: { n: number }) {
  return (
    <span dir="ltr" style={{ whiteSpace: 'nowrap', flexShrink: 0, unicodeBidi: 'isolate' }}>
      <RiyalSymbol />{' '}{n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

function TRow({ left, right, bold, strong }: { left: ReactNode; right: ReactNode; bold?: boolean; strong?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '8px',
      fontWeight: bold || strong ? 'bold' : 'normal',
      fontSize: strong ? '13px' : bold ? '12px' : '11px',
      marginBottom: strong ? '4px' : '3px',
    }}>
      <span style={{
        minWidth: '24mm',
        flex: '1 1 auto',
        whiteSpace: 'normal',
        overflowWrap: 'break-word',
        wordBreak: 'normal',
      }}>{left}</span>
      <span style={{ flexShrink: 0, textAlign: 'right' }}>{right}</span>
    </div>
  )
}

const Dash = () => (
  <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
)

function moneyValue(value: number | null | undefined, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function printThermal(): void {
  const existing = document.getElementById('thermal-print-style')
  existing?.remove()
  const s = document.createElement('style')
  s.id = 'thermal-print-style'
  s.textContent = `
    @media print {
      @page { size: 80mm auto; margin: 0 3mm; }
      body { visibility: hidden !important; }
      #invoice-printable { display: none !important; visibility: hidden !important; }
      #thermal-receipt {
        display: block !important;
        visibility: visible !important;
        position: fixed !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important;
        background: white !important;
        z-index: 999999 !important;
        padding: 4px !important;
      }
      #thermal-receipt * { visibility: visible !important; }
    }
  `
  document.head.appendChild(s)
  window.print()
  s.remove()
}

export default function ThermalReceipt({
  id = 'thermal-receipt',
  preview = false,
  businessNameAr, businessNameEn, logoUrl, showLogo = false, branchName, address, vatNumber, phone,
  documentLanguage: documentLanguageValue = 'both', branchNameAr, addressAr,
  website, showWebsite, email, showEmail,
  invoiceNumber, date, time,
  items, subtotal, discountAmount = 0, taxAmount, total,
  paymentMethod, payments = [], cashReceived, change, showCashChange = true,
  customerName, customerNameAr, buyerVatNumber, isStandardInvoice = false,
  documentType = 'invoice', originalInvoiceNumber, creditReason,
  qrDataUrl, receiptFooter, showFooter = true,
}: ThermalReceiptProps) {
  const documentLanguage = normalizeDocumentLanguage(documentLanguageValue)
  const documentDir = documentDirection(documentLanguage)
  const businessNames = documentNames(documentLanguage, businessNameEn, businessNameAr)
  const branchNames = documentNames(documentLanguage, branchName, branchNameAr)
    .filter(name => !businessNames.includes(name))
  const addresses = documentNames(documentLanguage, address, addressAr)
  const customerNames = documentNames(documentLanguage, customerName, customerNameAr)
  const isCreditNote = documentType === 'credit_note'
  const isSplitPayment = paymentMethod === 'split'
    || (payments.length > 1
      && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
      && payments.some(payment => payment.method === 'card' && Number(payment.amount) > 0))
  const cashPayment = payments.find(payment => payment.method === 'cash')
  const cardPayment = payments.find(payment => payment.method === 'card')
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
  const displayPaidTotal = payments.length > 0 ? paidTotal : total
  const balance = roundMoney(total - displayPaidTotal)
  const hasBalance = Math.abs(balance) > 0.005
  const hasDiscount = Math.abs(moneyValue(discountAmount)) > 0.005
  const titleKey = isCreditNote
    ? (isStandardInvoice ? 'taxCreditNote' : 'simplifiedTaxCreditNote')
    : (isStandardInvoice ? 'standardTaxInvoice' : 'simplifiedTaxInvoice')
  const titleLines = documentLabelLines(documentLanguage, titleKey)
  const numberLabel = documentLabel(documentLanguage, isCreditNote ? 'creditNoteNumber' : 'invoiceNumber')

  return (
    <div
      id={id}
      dir={documentDir}
      lang={documentLanguage === 'ar' ? 'ar' : documentLanguage === 'en' ? 'en' : undefined}
      style={{
        display: preview ? 'block' : 'none',
        fontFamily: documentFontFamily(documentLanguage),
        fontSize: 'var(--receipt-font-size, 11px)',
        color: '#000',
        width: '100%',
        maxWidth: 'var(--receipt-content-width, 72mm)',
        margin: '0 auto',
        padding: '6px',
        boxSizing: 'border-box' as const,
        lineHeight: 'var(--receipt-line-height, 1.4)',
        background: 'white',
        overflow: 'visible',
      }}
    >
      {/* Logo */}
      {showLogo && logoUrl && (
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          <img src={logoUrl} alt="" style={{ maxHeight: '60px', maxWidth: '80%', display: 'block', margin: '0 auto', objectFit: 'contain' }} />
        </div>
      )}

      {/* Business header */}
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {businessNames.map((name, index) => (
          <div key={name} dir="auto" style={{ fontSize: index === 0 ? '15px' : '10px', fontWeight: index === 0 ? 'bold' : 'normal', color: index === 0 ? '#000' : '#666', marginBottom: '2px' }}>
            {name}
          </div>
        ))}
        {branchNames.map(name => <div key={name} dir="auto" style={{ fontSize: '10px', color: '#444' }}>{name}</div>)}
        {addresses.map(value => <div key={value} dir="auto" style={{ fontSize: '10px', color: '#555', marginTop: '2px', lineHeight: '1.3' }}>{value}</div>)}
        {vatNumber && <div>{documentLabel(documentLanguage, 'vatNumber')}: <bdi dir="ltr">{vatNumber}</bdi></div>}
        {phone && <div>{documentLabel(documentLanguage, 'phone')}: <bdi dir="ltr">{phone}</bdi></div>}
        {showWebsite && website && <div style={{ fontSize: '10px', color: '#555' }}>{website}</div>}
        {showEmail && email && <div style={{ fontSize: '10px', color: '#555' }}>{email}</div>}
      </div>

      <Dash />

      {/* Invoice title */}
      <div style={{ textAlign: 'center', margin: '4px 0' }}>
        {titleLines.map((line, index) => (
          <div key={line} dir="auto" style={{ fontSize: index === 0 ? '13px' : '10px', fontWeight: index === 0 ? 'bold' : 'normal', color: index === 0 ? '#000' : '#555' }}>{line}</div>
        ))}
      </div>

      <Dash />

      {/* Invoice meta */}
      <div style={{ fontSize: '11px', marginBottom: '4px' }}>
        <div>{numberLabel}: <strong><bdi dir="ltr">{invoiceNumber}</bdi></strong></div>
        {isCreditNote && originalInvoiceNumber && (
          <div>{documentLabel(documentLanguage, 'originalInvoice')}: <strong><bdi dir="ltr">{originalInvoiceNumber}</bdi></strong></div>
        )}
        <div>{documentLabel(documentLanguage, 'date')}: <bdi dir="ltr">{date}</bdi></div>
        <div>{documentLabel(documentLanguage, 'time')}: <bdi dir="ltr">{time}</bdi></div>
      </div>

      {isCreditNote && creditReason && (
        <>
          <Dash />
          <div style={{ fontSize: '11px', marginBottom: '4px' }}>
            <div>{documentLabel(documentLanguage, 'reason')}: <strong dir="auto">{creditReason}</strong></div>
          </div>
        </>
      )}

      <Dash />

      {/* Line items */}
      <div style={{ marginBottom: '6px' }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              marginBottom: i === items.length - 1 ? '0' : '6px',
              paddingBottom: i === items.length - 1 ? '0' : '4px',
              borderBottom: i === items.length - 1 ? '0' : '1px dotted #bbb',
            }}
          >
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              lineHeight: 1.35,
              marginBottom: '2px',
              overflowWrap: 'break-word',
              wordBreak: 'normal',
            }}>
              {documentNames(documentLanguage, item.name, item.nameAr).map(name => <div key={name} dir="auto">{name}</div>)}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '8px',
              fontSize: '10px',
              color: '#333',
            }}>
              <span style={{ minWidth: 0, overflowWrap: 'break-word', wordBreak: 'normal' }}>
                <bdi dir="ltr">{item.qty} ×</bdi> <Amt n={item.unitPrice} />
              </span>
              <span style={{ flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <Amt n={moneyValue(item.total, item.lineTotal)} />
              </span>
            </div>
          </div>
        ))}
      </div>

      <Dash />

      {/* Totals */}
      <div style={{ fontSize: '11px', margin: '8px 0 5px' }}>
        <TRow left={documentLabel(documentLanguage, 'amountBeforeVat')} right={<Amt n={subtotal} />} />
        {hasDiscount && <TRow left={documentLabel(documentLanguage, 'discount')} right={<Amt n={Math.abs(moneyValue(discountAmount))} />} />}
        <TRow left={`${documentLabel(documentLanguage, 'vatAmount')} 15%`} right={<Amt n={taxAmount} />} />
        <div style={{ borderTop: '1px solid #000', margin: '5px 0' }} />
        <TRow left={documentLabel(documentLanguage, isCreditNote ? 'creditTotal' : 'totalIncludingVat')} right={<Amt n={total} />} strong />
        <TRow left={documentLabel(documentLanguage, isCreditNote ? 'refunded' : 'paid')} right={<Amt n={displayPaidTotal} />} bold />
        {hasBalance && !isCreditNote && (
          <TRow left={documentLabel(documentLanguage, 'balance')} right={<Amt n={Math.abs(balance)} />} bold />
        )}
      </div>

      <Dash />

      {/* Payment */}
      <div style={{ fontSize: '11px', marginBottom: '4px' }}>
        <div>{documentLabel(documentLanguage, isCreditNote ? 'refundMethod' : 'paymentMethod')}: <strong>{documentPaymentLabel(documentLanguage, isSplitPayment ? 'split' : paymentMethod)}</strong></div>
        {isSplitPayment && cashPayment && (
          <TRow left={documentLabel(documentLanguage, 'cashAmount')} right={<Amt n={Number(cashPayment.amount)} />} />
        )}
        {isSplitPayment && cardPayment && (
          <TRow left={documentLabel(documentLanguage, 'cardAmount')} right={<Amt n={Number(cardPayment.amount)} />} />
        )}
        {isSplitPayment && (
          <TRow left={documentLabel(documentLanguage, 'totalPaid')} right={<Amt n={paidTotal} />} />
        )}
        {!isSplitPayment && paymentMethod === 'cash' && cashReceived != null && cashReceived > 0 && (
          <TRow left={documentLabel(documentLanguage, 'received')} right={<Amt n={cashReceived} />} />
        )}
        {!isSplitPayment && showCashChange && paymentMethod === 'cash' && (change ?? 0) > 0.005 && (
          <TRow left={documentLabel(documentLanguage, 'change')} right={<Amt n={change ?? 0} />} />
        )}
      </div>

      {/* Customer */}
      {(customerNames.length > 0 && customerName !== 'Walk-in Customer' || buyerVatNumber) && (
        <>
          <Dash />
          <div style={{ fontSize: '11px', marginBottom: '4px' }}>
            {customerNames.length > 0 && customerName !== 'Walk-in Customer' && <div>{documentLabel(documentLanguage, 'customer')}: <strong>{customerNames.map(name => <span key={name} dir="auto" style={{ display: 'block' }}>{name}</span>)}</strong></div>}
            {buyerVatNumber && (
              <div>{documentLabel(documentLanguage, 'customerVatNumber')}: <strong><bdi dir="ltr">{buyerVatNumber}</bdi></strong></div>
            )}
          </div>
        </>
      )}

      <Dash />

      {/* QR code */}
      {qrDataUrl ? (
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <img src={qrDataUrl} alt="QR" dir="ltr" style={{ width: 'min(34mm, 70%)', height: 'auto', aspectRatio: '1 / 1', display: 'block', margin: '0 auto' }} />
          <div style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>{documentLabel(documentLanguage, 'scanToVerify')}</div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#aaa', margin: '6px 0' }}>
          [{documentLabel(documentLanguage, 'qrCode')}]
        </div>
      )}

      <Dash />

      {/* Footer */}
      {showFooter && (
        <div style={{ textAlign: 'center', fontSize: '11px', paddingBottom: '8px' }}>
          {receiptFooter ? (
            <div style={{ fontSize: '10px', color: '#555' }}>{receiptFooter}</div>
          ) : (
            <>
              {documentLabelLines(documentLanguage, 'thankYou').map(line => <div key={line} dir="auto" style={{ fontSize: '11px', marginBottom: '2px' }}>{line}</div>)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
