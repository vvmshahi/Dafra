import type { ReactNode } from 'react'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'

export interface ThermalItem {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
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
  logoUrl?: string | null
  showLogo?: boolean
  branchName?: string | null
  address?: string | null
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
  taxAmount: number
  total: number
  paymentMethod: string
  payments?: ThermalPayment[]
  cashReceived?: number | null
  change?: number | null
  showCashChange?: boolean
  customerName?: string | null
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
    <span style={{ whiteSpace: 'nowrap' }}>
      <RiyalSymbol />{' '}{n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

function TRow({ left, right, bold }: { left: string; right: ReactNode; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 'bold' : 'normal', fontSize: bold ? '12px' : '11px', marginBottom: '1px' }}>
      <span>{left}</span><span>{right}</span>
    </div>
  )
}

const Dash = () => (
  <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
)

function paymentLabel(method: string): string {
  if (method === 'split') return 'Split Payment'
  if (method === 'cash') return 'Cash'
  if (method === 'card') return 'Card / POS'
  if (method === 'bank_transfer') return 'Bank Transfer'
  return 'Other'
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
  website, showWebsite, email, showEmail,
  invoiceNumber, date, time,
  items, subtotal, taxAmount, total,
  paymentMethod, payments = [], cashReceived, change, showCashChange = true,
  customerName, buyerVatNumber, isStandardInvoice = false,
  documentType = 'invoice', originalInvoiceNumber, creditReason,
  qrDataUrl, receiptFooter, showFooter = true,
}: ThermalReceiptProps) {
  // Line 2 (legal name) only shown if it differs from Line 1 (brand name)
  const showLegalName = businessNameEn && businessNameEn !== businessNameAr
  const isCreditNote = documentType === 'credit_note'
  const isSplitPayment = paymentMethod === 'split'
    || (payments.length > 1
      && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
      && payments.some(payment => payment.method === 'card' && Number(payment.amount) > 0))
  const cashPayment = payments.find(payment => payment.method === 'cash')
  const cardPayment = payments.find(payment => payment.method === 'card')
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
  const titleAr = isCreditNote
    ? (isStandardInvoice ? 'إشعار دائن ضريبي' : 'إشعار دائن ضريبي مبسط')
    : (isStandardInvoice ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة')
  const titleEn = isCreditNote
    ? (isStandardInvoice ? 'Tax Credit Note' : 'Simplified Tax Credit Note')
    : (isStandardInvoice ? 'Standard Tax Invoice' : 'Simplified Tax Invoice')

  return (
    <div
      id={id}
      style={{
        display: preview ? 'block' : 'none',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#000',
        width: '100%',
        maxWidth: '300px',
        margin: '0 auto',
        padding: '6px',
        boxSizing: 'border-box' as const,
        lineHeight: '1.4',
        background: 'white',
      }}
    >
      {/* Logo */}
      {showLogo && logoUrl && (
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          <img src={logoUrl} alt="logo" style={{ maxHeight: '60px', maxWidth: '200px', display: 'block', margin: '0 auto', objectFit: 'contain' }} />
        </div>
      )}

      {/* Business header */}
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {businessNameAr && (
          <div style={{ fontFamily: 'Cairo, "Segoe UI", sans-serif', fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>
            {businessNameAr}
          </div>
        )}
        {/* Legal company name — only shown when different from brand name */}
        {showLegalName && (
          <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>{businessNameEn}</div>
        )}
        {branchName && branchName !== businessNameAr && branchName !== businessNameEn && (
          <div style={{ fontSize: '10px', color: '#444' }}>{branchName}</div>
        )}
        {address && (
          <div style={{ fontSize: '10px', color: '#555', marginTop: '2px', lineHeight: '1.3' }}>{address}</div>
        )}
        {vatNumber && <div style={{ fontSize: '10px' }}>VAT: {vatNumber}</div>}
        {phone && <div style={{ fontSize: '10px' }}>Tel: {phone}</div>}
        {showWebsite && website && <div style={{ fontSize: '10px', color: '#555' }}>{website}</div>}
        {showEmail && email && <div style={{ fontSize: '10px', color: '#555' }}>{email}</div>}
      </div>

      <Dash />

      {/* Invoice title */}
      <div style={{ textAlign: 'center', margin: '4px 0' }}>
        <div style={{ fontFamily: 'Cairo, "Segoe UI", sans-serif', fontSize: '13px', fontWeight: 'bold', direction: 'rtl' }}>
          {titleAr}
        </div>
        <div style={{ fontSize: '10px', color: '#555' }}>
          {titleEn}
        </div>
      </div>

      <Dash />

      {/* Invoice meta */}
      <div style={{ fontSize: '11px', marginBottom: '4px' }}>
        <div>{isCreditNote ? 'Credit Note' : 'Invoice'}: <strong>{invoiceNumber}</strong></div>
        {isCreditNote && originalInvoiceNumber && (
          <div>Original Invoice: <strong>{originalInvoiceNumber}</strong></div>
        )}
        <div>Date: {date}</div>
        <div>Time: {time}</div>
      </div>

      {isCreditNote && creditReason && (
        <>
          <Dash />
          <div style={{ fontSize: '11px', marginBottom: '4px' }}>
            <div>Reason: <strong>{creditReason}</strong></div>
          </div>
        </>
      )}

      <Dash />

      {/* Line items */}
      <div style={{ marginBottom: '4px' }}>
        {items.map((item, i) => (
          <div key={i} style={{ marginBottom: '3px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, wordBreak: 'break-word' }}>{item.name}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#333' }}>
              <span>{item.qty} x <Amt n={item.unitPrice} /></span>
              <span><Amt n={item.lineTotal} /></span>
            </div>
          </div>
        ))}
      </div>

      <Dash />

      {/* Totals */}
      <div style={{ fontSize: '11px', marginBottom: '4px' }}>
        <TRow left="Subtotal:" right={<Amt n={subtotal} />} />
        <TRow left="VAT (15%):" right={<Amt n={taxAmount} />} />
        <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
        <TRow left={isCreditNote ? 'CREDIT TOTAL:' : 'TOTAL:'} right={<Amt n={total} />} bold />
      </div>

      <Dash />

      {/* Payment */}
      <div style={{ fontSize: '11px', marginBottom: '4px' }}>
        <div>{isCreditNote ? 'Refund' : 'Payment'}: <strong>{paymentLabel(isSplitPayment ? 'split' : paymentMethod)}</strong></div>
        {isSplitPayment && cashPayment && (
          <TRow left="Cash:" right={<Amt n={Number(cashPayment.amount)} />} />
        )}
        {isSplitPayment && cardPayment && (
          <TRow left="Card:" right={<Amt n={Number(cardPayment.amount)} />} />
        )}
        {isSplitPayment && (
          <TRow left="Total paid:" right={<Amt n={paidTotal} />} />
        )}
        {!isSplitPayment && paymentMethod === 'cash' && cashReceived != null && cashReceived > 0 && (
          <TRow left="Received:" right={<Amt n={cashReceived} />} />
        )}
        {!isSplitPayment && showCashChange && paymentMethod === 'cash' && (change ?? 0) > 0.005 && (
          <TRow left="Change:" right={<Amt n={change ?? 0} />} />
        )}
      </div>

      {/* Customer */}
      {(customerName && customerName !== 'Walk-in Customer' || buyerVatNumber) && (
        <>
          <Dash />
          <div style={{ fontSize: '11px', marginBottom: '4px' }}>
            {customerName && customerName !== 'Walk-in Customer' && (
              <div>Customer: <strong>{customerName}</strong></div>
            )}
            {buyerVatNumber && (
              <div>Buyer VAT: <strong>{buyerVatNumber}</strong></div>
            )}
          </div>
        </>
      )}

      <Dash />

      {/* QR code */}
      {qrDataUrl ? (
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <img src={qrDataUrl} alt="ZATCA QR" style={{ width: '150px', height: '150px', display: 'block', margin: '0 auto' }} />
          <div style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>Scan to verify invoice</div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#aaa', margin: '6px 0' }}>
          [QR Code]
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
              <div style={{ fontFamily: 'Cairo, "Segoe UI", sans-serif', fontSize: '13px', direction: 'rtl', marginBottom: '2px' }}>
                شكراً لزيارتكم
              </div>
              <div style={{ fontSize: '10px' }}>Thank you!</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
