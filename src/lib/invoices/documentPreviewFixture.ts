/** Synthetic-only data for visual previews. It is never persisted or sent to ZATCA. */
export const DOCUMENT_PREVIEW_FIXTURE = {
  seller: { registeredName: 'Dafra Sample Roastery', registeredNameAr: 'محمصة دفترة التجريبية', vatNumber: '300000000000003', registrationType: 'CR', registrationNumber: '1010999999', address: 'King Fahd Road, Al Olaya, Riyadh, Saudi Arabia, 12211', branchName: 'Sample Branch', branchNameAr: 'الفرع التجريبي' },
  buyer: { name: 'Sample customer', nameAr: 'عميل تجريبي' },
  invoice: { number: 'SAMPLE-0042', issueTimestamp: '2026-01-15T10:30:00.000Z', subtotal: 50.43, discount: 2, taxableAmount: 50.43, vat: 7.57, total: 58, qrMarker: 'sample-qr-marker' },
  creditNote: { number: 'SAMPLE-CN-0042', issueTimestamp: '2026-01-16T10:30:00.000Z', originalNumber: 'SAMPLE-0042', reason: 'Sample return', qrMarker: 'sample-credit-qr-marker' },
  items: [
    { description: 'Ethiopian coffee', descriptionAr: 'قهوة إثيوبية', quantity: 2, unitPrice: 18, discount: 2, taxableAmount: 34, vatRate: 15, vatAmount: 5.1, lineTotal: 39.1 },
    { description: 'Date cake', descriptionAr: 'كيك التمر', quantity: 1, unitPrice: 16.46, discount: 0, taxableAmount: 16.43, vatRate: 15, vatAmount: 2.47, lineTotal: 18.9 },
  ],
  payments: [{ method: 'cash', amount: 30, cashTendered: 40, change: 10, reference: null }, { method: 'card', amount: 28, cashTendered: null, change: null, reference: 'SAMPLE-CARD' }],
} as const
