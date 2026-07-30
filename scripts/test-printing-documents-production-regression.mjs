import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../src/pages/branch/PrintingDocumentsPage.tsx')
const invoice = read('../src/pages/branch/InvoiceSettingsPage.tsx')
const barcode = read('../src/components/barcodes/BarcodeLabelDesigner.tsx')
const shell = read('../src/components/printing/DocumentStudioShell.tsx')
const downloads = read('../src/config/desktopDownloads.ts')

assert.match(page, /DocumentStudioShell/)
assert.match(page, /receipts/)
assert.match(page, /invoices/)
assert.match(page, /barcodeLabels/)
assert.match(invoice, /DocumentStudioWorkspace/)
assert.match(barcode, /DocumentStudioWorkspace/)
assert.match(shell, /DocumentStudioSectionNav/)
assert.match(shell, /document-studio-preview-canvas/)
assert.match(shell, /document-studio-action-footer/)
assert.match(invoice, /sections:.*general|allowedSections/s)
assert.match(barcode, /BARCODE_STUDIO_SECTIONS/)
assert.match(downloads, /Kubri-Desktop-1\.0\.3-macOS-arm64-unsigned\.dmg/)
assert.match(downloads, /Kubri-Desktop-1\.0\.3-Windows-x64-unsigned-setup\.exe/)
assert.doesNotMatch(page, /LegacyPrintingDocuments|StackedPrintingDocuments|legacy-printing-workspace/)

console.log('Printing Documents production regression markers passed')
