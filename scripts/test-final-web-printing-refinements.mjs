import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isLowStockProduct } from '../src/lib/products/lowStock.ts'
import { formatSaudiDate, formatSaudiTime } from '../src/lib/utils/date.ts'
import { A4_TEMPLATE_IDS, A4_TEMPLATE_REGISTRY } from '../src/lib/invoices/a4TemplateRegistry.ts'
import { A4_ACCENT_PRESETS, contrastRatio, hasSafeTextContrast, resolveA4ColorTokens, safeForeground } from '../src/lib/invoices/a4ColorTokens.ts'
import { createPreviewQrDataUrl } from '../src/lib/invoices/previewQr.ts'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')

const tracked = {
  stock_quantity: 4,
  min_stock_alert: 5,
  track_stock: true,
  is_service: false,
  is_active: true,
  is_available: true,
}
assert.equal(isLowStockProduct({ ...tracked, is_service: true }), false)
assert.equal(isLowStockProduct({ ...tracked, track_stock: false }), false)
assert.equal(isLowStockProduct(tracked), true)
assert.equal(isLowStockProduct({ ...tracked, stock_quantity: 5 }), true)
assert.equal(isLowStockProduct({ ...tracked, is_active: false }), false)
assert.equal(isLowStockProduct({ ...tracked, is_available: false }), false)
assert.equal(isLowStockProduct({ ...tracked, min_stock_alert: 0 }), false)

const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const ownerBranch = read('src/pages/admin/BranchDetailPage.tsx')
for (const source of [branchDashboard, ownerBranch]) {
  assert.match(source, /\.eq\('tenant_id',/)
  assert.match(source, /\.eq\('branch_id',/)
  assert.match(source, /\.eq\('track_stock', true\)/)
  assert.match(source, /\.eq\('is_service', false\)/)
  assert.match(source, /isLowStockProduct/)
  assert.match(source, /formatSaudiTime/)
}

const instant = '2026-07-29T12:42:00.000Z'
assert.match(formatSaudiDate(instant, 'en'), /29 Jul 2026/)
assert.match(formatSaudiTime(instant, 'en'), /03:42\s*pm/i)
assert.match(formatSaudiDate(instant, 'ar-SA'), /29/)
assert.match(formatSaudiTime(instant, 'ar-SA'), /03:42/)

const workspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
assert.match(branchDashboard, /\[t\('recent\.invoice'\), t\('recent\.customer'\), t\('recent\.amount'\), t\('recent\.status'\), t\('recent\.date'\), t\('recent\.time'\)\]/)
assert.match(branchDashboard, /data-branch-title-block/)
assert.match(branchDashboard, /dir="ltr" className="relative mx-auto/)
assert.match(branchDashboard, /formatSaudiDate\(invoiceTimestamp/)
assert.match(branchDashboard, /formatSaudiTime\(invoiceTimestamp/)
assert.match(ownerBranch, /'date', 'time'/)
assert.match(workspace, /return 'receipts'/)
assert.match(workspace, /value === 'invoices'/)
assert.match(workspace, /value === 'barcode-labels'/)
assert.match(workspace, /useSearchParams/)
assert.match(workspace, /tab\.id !== 'printerSetup' \|\| electron/)
assert.match(workspace, /electron && active === 'printerSetup'/)
assert.match(workspace, /!electron && <details[\s\S]*BarcodePrinterSetupPanel/)
assert.match(workspace, /setSearchParams\(next\)/)

const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
assert.match(invoiceSettings, /border-gray-200 bg-white/)
assert.match(invoiceSettings, /role="tablist"/)
assert.match(invoiceSettings, /role="radio"/)
assert.match(invoiceSettings, /ThemeChoice/)
assert.match(invoiceSettings, /A4LayoutComparison/)

const registry = read('src/lib/invoices/a4TemplateRegistry.ts')
const a4 = read('src/components/print/A4Document.tsx')
const css = read('src/index.css')
const migration = read('supabase/migrations/20260729000500_extend_a4_invoice_themes.sql')
const brandingMigration = read('supabase/migrations/20260729000600_extend_a4_invoice_branding.sql')
const letterheadMigration = read('supabase/migrations/20260729000700_complete_a4_letterhead_presentation.sql')
const artworkPolicyHardeningMigration = read('supabase/migrations/20260729000800_harden_invoice_artwork_storage_policies.sql')
const optionalBranchColumnsMigration = read('supabase/migrations/20260729000900_tolerate_optional_branch_presentation_columns.sql')
const legacyLogoCompatibilityMigration = read('supabase/migrations/20260730000000_restore_legacy_invoice_logo_path_compatibility.sql')
const completeA4ReadMigration = read('supabase/migrations/20260730000100_preserve_complete_a4_settings_on_read.sql')
const artworkPaginationMigration = read('supabase/migrations/20260730000200_add_a4_standard_branding_visibility.sql')
const a4PreviewFit = read('src/components/print/A4PreviewFit.tsx')
const letterhead = read('src/lib/invoices/letterheadArtwork.ts')
const colourTokens = read('src/lib/invoices/a4ColorTokens.ts')
const presentation = read('src/lib/invoices/presentationSettings.ts')
const previewQr = read('src/lib/invoices/previewQr.ts')
for (const theme of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(registry, new RegExp(`${theme}:`))
}
for (const className of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(css, new RegExp(`a4-document--${className}`))
}
assert.match(a4, /options\.nonFiscalDemo/)
assert.doesNotMatch(a4, /SharedA4Layout/)
for (const layout of ['a4-classic-head', 'a4-statement-head', 'a4-minimal-head', 'a4-executive-band', 'a4-ledger-head', 'a4-modular-head']) assert.match(a4, new RegExp(layout))
assert.match(a4, /page-break-inside|Footer/)
assert.match(css, /a4-statement-summary/)
assert.match(migration, /validate_invoice_presentation_settings/)
assert.match(migration, /executive_green/)
assert.match(migration, /to_regprocedure\('public\.validate_invoice_presentation_settings\(jsonb,uuid,uuid\)'\) IS NULL[\s\S]*20260729000700/)
assert.doesNotMatch(migration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)
for (const marker of ['accent_color', 'header_asset_path', 'header_asset_enabled', 'header_asset_fit', 'header_asset_height', 'header_asset_spacing']) {
  assert.match(invoiceSettings, new RegExp(marker))
  assert.match(brandingMigration, new RegExp(marker))
}
assert.match(a4, /--a4-accent/)
assert.match(a4, /--a4-heading/)
assert.match(a4, /--a4-body/)
assert.match(a4, /a4-header-artwork/)
assert.match(a4, /a4-footer-artwork/)
assert.match(invoiceSettings, /A4PreviewFit zoom=\{previewZoom\} bounded/)
assert.match(workspace, /printing-workspace-shell/)
assert.match(workspace, /inline-flex w-fit max-w-full/)
assert.match(invoiceSettings, /invoice-editor-tabs/)
assert.match(invoiceSettings, /invoice-editor-canvas/)
assert.match(invoiceSettings, /invoice-editor-actions/)
assert.match(invoiceSettings, /setPreviewZoom\('width'\)/)
assert.match(invoiceSettings, /setPreviewZoom\('page'\)/)
assert.match(invoiceSettings, /loadLetterheadSource/)
assert.match(invoiceSettings, /cropLetterheadRegion/)
assert.match(invoiceSettings, /LETTERHEAD_ACCEPT/)
for (const region of ['thumb-brand', 'thumb-title', 'thumb-from', 'thumb-to', 'thumb-meta', 'thumb-table', 'thumb-qr', 'thumb-total']) assert.match(invoiceSettings, new RegExp(region))
assert.match(a4, /a4-executive-document[\s\S]*<QrVerification/)
assert.match(a4, /a4-minimal-foot[\s\S]*<QrVerification/)
assert.match(read('src/localization/locales/en/documents.json'), /"seller": "Bill From"/)
assert.match(read('src/localization/locales/ar-SA/documents.json'), /"seller": "صادرة من"/)
assert.doesNotMatch(brandingMigration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)
assert.match(brandingMigration, /to_regprocedure\('public\.validate_invoice_presentation_settings\(jsonb,uuid,uuid\)'\) IS NULL[\s\S]*20260729000700/)

// Corrective A4 registry: six valid IDs round-trip to six unique renderers,
// landmark sets, thumbnails, and intended QR regions. Unknown IDs fall back to
// Classic in the resolver instead of silently taking the Minimal renderer.
assert.equal(A4_TEMPLATE_IDS.length, 6)
assert.equal(new Set(A4_TEMPLATE_IDS.map(id => A4_TEMPLATE_REGISTRY[id].renderer)).size, 6)
assert.equal(new Set(A4_TEMPLATE_IDS.map(id => A4_TEMPLATE_REGISTRY[id].thumbnailClass)).size, 6)
assert.equal(new Set(A4_TEMPLATE_IDS.map(id => A4_TEMPLATE_REGISTRY[id].qrRegion)).size, 6)
assert.equal(new Set(A4_TEMPLATE_IDS.map(id => A4_TEMPLATE_REGISTRY[id].landmarks.join('|'))).size, 6)
assert.match(registry, /registry\[candidate\] \?\s*candidate\s*:\s*'classic'/)
assert.doesNotMatch(registry, /fallback:\s*'minimal_professional'/)
for (const id of A4_TEMPLATE_IDS.slice(3)) assert.notEqual(A4_TEMPLATE_REGISTRY[id].renderer, A4_TEMPLATE_REGISTRY.minimal_professional.renderer)

// Workspace consumes the already-sized app content box; it must not subtract a
// second guessed header height or create a lower blank quarter.
assert.match(css, /\.printing-workspace-shell\s*\{\s*height:\s*100%;\s*min-height:\s*0/)
assert.doesNotMatch(css, /printing-workspace-shell\s*\{[^}]*calc\(100dvh\s*-\s*7\.5rem\)/)
assert.match(css, /@media print[^}]*@page[\s\S]*html,body\s*\{[^}]*background:\s*#fff\s*!important/)
assert.match(css, /\.a4-sample,\.a4-page-number\s*\{\s*display:\s*none\s*!important/)
assert.match(read('src/components/layout/AppLayout.tsx'), /ownsInnerScroll/)
assert.match(read('src/components/layout/AppLayout.tsx'), /overflow-hidden/)
assert.match(workspace, /active === 'invoices' \|\| active === 'receipts' \? 'overflow-hidden'/)

// Independent colours, white/black handling, and contrast enforcement.
assert.ok(A4_ACCENT_PRESETS.includes('#0f766e'))
assert.ok(A4_ACCENT_PRESETS.includes('#000000'))
assert.ok(A4_ACCENT_PRESETS.includes('#ffffff'))
assert.equal(safeForeground('#ffffff'), '#111827')
assert.equal(safeForeground('#000000'), '#ffffff')
assert.ok(contrastRatio('#111827', '#ffffff') >= 4.5)
assert.equal(hasSafeTextContrast('#ffffff', '#ffffff'), false)
const whiteTokens = resolveA4ColorTokens({ templateId: 'classic', accent: '#ffffff', heading: '#10251a', body: '#1f2937', autoForeground: true })
assert.equal(whiteTokens.tableHeader, '#ffffff')
assert.equal(whiteTokens.tableHeaderForeground, '#111827')
for (const marker of ['heading_color','body_color','auto_foreground','A4_LAYOUT_COLOR_DEFAULTS','hasSafeTextContrast']) assert.match(invoiceSettings + presentation + colourTokens, new RegExp(marker))

// Fixture QR is deterministic, clearly non-production, and omitted for demo
// and unavailable states. Runtime invoices still pass their authoritative QR.
const firstPreviewQr = await createPreviewQrDataUrl('eligible_simplified')
const secondPreviewQr = await createPreviewQrDataUrl('eligible_simplified')
assert.equal(firstPreviewQr, secondPreviewQr)
assert.match(firstPreviewQr ?? '', /^data:image\/png;base64,/)
assert.equal(await createPreviewQrDataUrl('demo'), null)
assert.equal(await createPreviewQrDataUrl('unavailable'), null)
assert.match(previewQr, /KUBRI_PREVIEW_ONLY/)
assert.match(invoiceSettings, /previewQrState === 'demo'/)
assert.match(read('src/pages/invoices/InvoiceDetailPage.tsx'), /qrImageUrl: qrDataUrl/)

// Letterhead source validation is byte-based and signature-aware. Images and
// PDFs are decoded before crop derivatives are uploaded; originals are not
// stored and multi-page/encrypted PDFs are rejected.
for (const marker of ['file.size > LETTERHEAD_MAX_SOURCE_BYTES','isJpeg','isPng','isWebp','isPdf','file.slice\\(0, 16\\)','image.naturalWidth < 480','pdfDocument.numPages !== 1','pdf_encrypted','isEvalSupported: false','cropLetterheadRegion','canvas.toBlob']) assert.match(letterhead, new RegExp(marker))
assert.doesNotMatch(letterhead, /file\.size\s*\/\s*1024\s*>\s*LETTERHEAD_MAX_SOURCE_BYTES/)
assert.match(invoiceSettings, /setSaveError\(null\)[\s\S]*loadLetterheadSource/)
assert.match(invoiceSettings, /fileName|LetterheadCropPanel/)
assert.match(invoiceSettings, /invoiceArtworkObjectPath/)
assert.match(invoiceSettings, /\.from\('invoice-artwork'\)\.upload/)
assert.doesNotMatch(invoiceSettings, /\.from\('invoice-artwork'\)\.upload\([^)]*artworkSource/)

// Private storage and path model cover insert/read/replace/remove while tenant,
// branch, and anonymous isolation remain enforced by authenticated-only policy.
assert.match(letterheadMigration, /'invoice-artwork',[\s\S]*FALSE,[\s\S]*8388608/)
for (const operation of ['INSERT','SELECT','UPDATE','DELETE']) assert.match(letterheadMigration, new RegExp(`FOR ${operation} TO authenticated`))
assert.match(letterheadMigration, /tenant\/\[0-9a-f-\]\{36\}\/branch/)
assert.match(letterheadMigration, /public\.get_my_tenant_id\(\)/)
assert.match(letterheadMigration, /public\.get_my_branch_id\(\)/)
assert.match(letterheadMigration, /public\.get_my_role\(\)::TEXT = 'owner'/)
assert.doesNotMatch(letterheadMigration, /TO anon|service_role/)
assert.doesNotMatch(letterheadMigration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)
assert.doesNotMatch(letterheadMigration, /^END$/m)
for (const operation of ['INSERT','SELECT','UPDATE','DELETE']) assert.match(artworkPolicyHardeningMigration, new RegExp(`FOR ${operation} TO authenticated`))
const canonicalArtworkPath = /name ~ '\^tenant\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\/branch\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\/invoice-artwork\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\/\(header\|footer\)\\\.\(png\|jpg\|jpeg\|webp\)\$'/g
assert.equal(artworkPolicyHardeningMigration.match(canonicalArtworkPath)?.length, 5)
assert.equal((artworkPolicyHardeningMigration.match(/storage\.foldername\(storage\.objects\.name\)/g) ?? []).length, 10)
assert.doesNotMatch(artworkPolicyHardeningMigration, /storage\.foldername\(name\)/)
assert.match(artworkPolicyHardeningMigration, /public\.get_my_role\(\)::TEXT = 'branch'[\s\S]*b\.id = public\.get_my_branch_id\(\)/)
assert.match(artworkPolicyHardeningMigration, /BEFORE UPDATE OF bucket_id, name/)
assert.match(artworkPolicyHardeningMigration, /NEW\.name IS DISTINCT FROM OLD\.name/)
assert.match(artworkPolicyHardeningMigration, /SECURITY INVOKER[\s\S]*SET search_path = pg_catalog/)
assert.doesNotMatch(artworkPolicyHardeningMigration, /TO anon|service_role|public\s*=\s*TRUE/i)
for (const optionalColumn of ['invoice_display_subheading', 'show_company_display_name', 'thermal_density', 'a4_template_id']) {
  assert.match(optionalBranchColumnsMigration, new RegExp(`branch_json->>'${optionalColumn}'`))
  assert.doesNotMatch(optionalBranchColumnsMigration, new RegExp(`b\\.${optionalColumn}`))
}
assert.match(optionalBranchColumnsMigration, /REVOKE ALL ON FUNCTION public\.default_invoice_presentation_settings\(UUID\) FROM PUBLIC, anon, authenticated/)
assert.match(optionalBranchColumnsMigration, /REVOKE ALL ON FUNCTION public\.resolve_invoice_presentation_settings\(UUID\) FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(optionalBranchColumnsMigration, /UPDATE public\.|ALTER TABLE|INSERT INTO public\.(invoices|payments|products|customers)/)

// Saving an otherwise valid A4 payload must retain the hosted V1 logo path
// `<authoritative branch UUID>/logo.ext`. The correction does not accept an
// arbitrary UUID prefix or broaden the private artwork path contract.
assert.match(legacyLogoCompatibilityMigration, /\('\^'\|\|p_branch_id::TEXT\|\|'\/logo\\\.\(png\|jpg\|jpeg\|webp\)\$'\)/)
assert.match(legacyLogoCompatibilityMigration, /pg_get_functiondef/)
assert.match(legacyLogoCompatibilityMigration, /position\(v_old IN v_definition\) = 0/)
assert.doesNotMatch(legacyLogoCompatibilityMigration, /\^https\?/)
assert.doesNotMatch(legacyLogoCompatibilityMigration, /UPDATE public\.|ALTER TABLE|INSERT INTO public\.(invoices|payments|products|customers)/)
assert.match(completeA4ReadMigration, /CREATE OR REPLACE FUNCTION public\.get_branch_invoice_settings\(p_branch_id UUID\)/)
assert.match(completeA4ReadMigration, /b\.presentation_settings->'a4' \? 'accent_color'[\s\S]*validate_invoice_presentation_settings/)
assert.match(completeA4ReadMigration, /ELSE[\s\S]*v1_canonicalize_invoice_presentation_settings/)
assert.match(completeA4ReadMigration, /REVOKE ALL ON FUNCTION public\.get_branch_invoice_settings\(UUID\) FROM PUBLIC, anon/)
assert.match(completeA4ReadMigration, /GRANT EXECUTE ON FUNCTION public\.get_branch_invoice_settings\(UUID\) TO authenticated/)
assert.doesNotMatch(completeA4ReadMigration, /UPDATE public\.|ALTER TABLE|INSERT INTO public\.(invoices|payments|products|customers)/)
assert.match(presentation, /interface UpdateBranchInvoiceSettingsPayload/)
assert.match(invoiceSettings, /const payload: UpdateBranchInvoiceSettingsPayload/)
assert.match(invoiceSettings, /p_payload: payload/)
for (const safeError of ['settingsFormatUnsupported', 'layoutUnavailable', 'artworkValidationFailed', 'permissionDenied', 'saveFailed']) {
  assert.match(invoiceSettings + read('src/localization/locales/en/printing.json'), new RegExp(safeError))
}
assert.match(invoiceSettings, /import\.meta\.env\.DEV[\s\S]*code:[\s\S]*details:[\s\S]*hint:/)

// Custom letterhead identity is explicit and branch-persisted. The switch
// removes only decorative branding; the authoritative legal seller remains in
// every layout. Older custom headers default hidden while no-artwork settings
// retain Kubri branding.
for (const source of [presentation, read('src/types/database.ts'), read('src/lib/invoices/documentViewModel.ts')]) {
  assert.match(source, /show_standard_branding|showStandardBranding/)
}
assert.match(invoiceSettings, /showStandardBranding/)
assert.match(invoiceSettings, /header_asset_enabled \|\| current\.presentation\.a4\.header_asset_path[\s\S]*show_standard_branding[\s\S]*: false/)
assert.match(a4, /showsStandardBranding/)
assert.match(a4, /showBranding &&[\s\S]*a4-legal-seller/)
assert.match(a4, /a4-document--branding-hidden/)
assert.match(css, /a4-document--branding-hidden/)
assert.match(read('src/localization/locales/en/printing.json'), /Show Kubri invoice branding below custom header/)
assert.match(read('src/localization/locales/ar-SA/printing.json'), /إظهار هوية الفاتورة أسفل الترويسة المخصصة/)
assert.match(artworkPaginationMigration, /show_standard_branding/)
assert.match(artworkPaginationMigration, /NOT \(s#>>'\{a4,header_asset_enabled\}'\)::BOOLEAN/)
assert.match(artworkPaginationMigration, /pg_get_functiondef/)
assert.doesNotMatch(artworkPaginationMigration, /UPDATE public\.|ALTER TABLE|INSERT INTO public\.(invoices|payments|products|customers)|zatca|checkout|stock/i)

// Preview scaling remains a viewport concern. Printable content has no fixed
// page height or transform, while measured content height and explicit
// unbreakable closing groups allow natural multi-page flow.
assert.match(a4PreviewFit, /renderedDocument\.scrollHeight/)
assert.match(a4PreviewFit, /CONTINUATION_PAGE_MARGINS/)
assert.match(a4PreviewFit, /repeatedTableHeader/)
assert.match(a4PreviewFit, /nextPageCount !== pageCount/)
assert.match(a4PreviewFit, /onPageCountChange/)
assert.match(invoiceSettings, /onPageCountChange=\{setA4PageCount\}/)
assert.match(css, /\.a4-closing-group\s*\{\s*break-inside:\s*avoid;\s*page-break-inside:\s*avoid;/)
assert.match(css, /\.a4-header-artwork,.a4-footer-artwork[^}]*break-inside:\s*avoid/)
assert.match(css, /@media print[\s\S]*\.a4-document\s*\{\s*min-height:\s*0;\s*padding:\s*0 !important;/)
assert.doesNotMatch(css.match(/@media print[\s\S]*?\/\* Snapshot-driven thermal document/)?.[0] ?? '', /transform:\s*scale|zoom:|overflow:\s*hidden|max-height:/)

// Every saved presentation field is serialized, normalized, admitted by the
// migration, and carried into the shared document model used by detail, PDF,
// POS, and reprint surfaces.
for (const marker of ['footer_asset_path','footer_asset_enabled','footer_asset_fit','footer_asset_height','footer_asset_spacing','header_crop_top','header_crop_height','footer_crop_top','footer_crop_height','artwork_scope','artwork_template_id']) {
  assert.match(presentation, new RegExp(marker))
  assert.match(letterheadMigration, new RegExp(marker))
  assert.match(read('src/lib/invoices/documentViewModel.ts'), new RegExp(marker.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace('headerCropTop','headerAssetPath|headerAssetEnabled|headerAssetFit|headerAssetHeight|headerAssetSpacing').replace('headerCropHeight','headerAssetPath|headerAssetEnabled|headerAssetFit|headerAssetHeight|headerAssetSpacing').replace('footerCropTop','footerAssetPath|footerAssetEnabled|footerAssetFit|footerAssetHeight|footerAssetSpacing').replace('footerCropHeight','footerAssetPath|footerAssetEnabled|footerAssetFit|footerAssetHeight|footerAssetSpacing')))
}
assert.match(read('src/lib/invoices/runtimePresentation.ts'), /createSignedUrl\(assetPath, 10 \* 60\)/)

const barcode = read('src/components/barcodes/BarcodeBatchPrintDrawer.tsx')
const designer = read('src/components/barcodes/BarcodeLabelDesigner.tsx')
const labelSettingsSource = read('src/lib/barcodes/labelSettings.ts')
const labelPrint = read('src/lib/barcodes/labelPrint.ts')
for (const contract of [
  /get_product_units/,
  /list_product_unit_barcodes/,
  /copies/,
  /barcodeRequired/,
  /barcodePrintDocument/,
  /saveAsPdf/,
  /recordBarcodePrintBatch/,
  /generate_internal_product_unit_barcode/,
]) {
  assert.match(barcode, contract)
}
assert.match(barcode, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.match(barcode, /max-h-\[min\(860px,calc\(100dvh-2rem\)\)\]/)
assert.match(barcode, /useDialogFocus/)
assert.match(barcode, /items\.some\(item => !item\.barcode\?\.isActive\)/)
assert.match(barcode, /p_product_unit_id: item\.unit\.id/)
assert.match(barcode, /p_is_primary: true/)
assert.match(designer, /PRIMARY_LABEL_PRESET_IDS\.map/)
assert.doesNotMatch(designer, /'a4_sheet'|'custom'/)
assert.match(labelSettingsSource, /storedPresetId === 'a4_sheet'/)
assert.match(labelSettingsSource, /storedPresetId === 'custom'/)
for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label']) {
  assert.match(labelSettingsSource, new RegExp(`${preset}:`))
  assert.match(labelPrint, new RegExp(`${preset}:`))
}
for (const landmark of ['compact-price-composition', 'standard-product-composition', 'detailed-product-composition', 'carton-label-composition']) {
  assert.match(labelPrint, new RegExp(landmark))
}

const thermal = read('src/components/print/ThermalReceipt.tsx')
const thermalCompositions = read('src/components/print/ThermalReceiptCompositions.tsx')
const thermalMigration = read('supabase/migrations/20260730000300_allow_classic_thermal_receipt_layout.sql')
const thermalSettings = read('src/lib/invoices/presentationSettings.ts')
const thermalTypes = read('src/types/database.ts')
const thermalAdapters = read('src/lib/invoices/documentViewAdapters.ts')
for (const layout of ["id: 'classic'", 'compact-retail', 'structured-detail', 'branded-modern']) assert.match(thermal, new RegExp(layout))
assert.match(thermal, /data-receipt-layout/)
assert.match(thermal, /data-qr-placement/)
for (const component of ['ClassicReceipt', 'CompactRetailReceipt', 'StructuredDetailReceipt', 'BrandedModernReceipt']) assert.match(thermalCompositions, new RegExp(`export function ${component}`))
for (const marker of ['thermal-classic-line', 'thermal-compact-line', 'thermal-structured-line__figures', 'thermal-branded-card__head']) assert.match(thermalCompositions, new RegExp(marker))
assert.match(thermalCompositions, /classic:\s*ClassicReceipt/)
assert.match(thermalCompositions, /compact:\s*CompactRetailReceipt/)
assert.match(thermalCompositions, /standard:\s*StructuredDetailReceipt/)
assert.match(thermalCompositions, /detailed:\s*BrandedModernReceipt/)
assert.match(thermalCompositions, /item\.vatAmount/)
const classicComposition = thermalCompositions.slice(thermalCompositions.indexOf('export function ClassicReceipt'), thermalCompositions.indexOf('export function CompactRetailReceipt'))
let classicMarker = -1
for (const marker of ['<ReceiptLogo', 'thermal-classic-header', '<Rule />', '<ReceiptTitle', '<ReceiptMetadata', '<ReceiptBuyer', '<ClassicItems', '<Totals', '<Payments', 'thermal-classic-footer']) {
  const nextMarker = classicComposition.indexOf(marker)
  assert.ok(nextMarker > classicMarker, `Classic must preserve the original receipt order at ${marker}`)
  classicMarker = nextMarker
}
assert.match(thermalSettings, /THERMAL_DENSITIES:[^=]+=\s*\['classic', 'compact', 'standard', 'detailed'\]/)
assert.match(thermalTypes, /ThermalDensity = 'classic' \| 'compact' \| 'standard' \| 'detailed'/)
assert.match(thermalAdapters, /thermalDensity === 'classic'/)
assert.match(thermalMigration, /NOT IN \('classic','compact','standard','detailed'\)/)
assert.doesNotMatch(thermalMigration, /UPDATE public\.|INSERT INTO public\.|DELETE FROM public\./)
assert.match(invoiceSettings, /qrImageUrl:\s*previewQrUrl[\s\S]*nonFiscalDemo:\s*previewQrState === 'demo'/)
for (const marker of ['receipt-theme-thumb__brand', 'receipt-theme-thumb__meta', 'receipt-theme-thumb__items', 'receipt-theme-thumb__total', 'receipt-theme-thumb__qr']) assert.match(invoiceSettings, new RegExp(marker))
for (const thumbnail of ['receipt-theme-thumb--classic', 'receipt-theme-thumb--compact', 'receipt-theme-thumb--standard', 'receipt-theme-thumb--detailed']) assert.match(css, new RegExp(thumbnail))
assert.doesNotMatch(css, /thermal-theme--compact-retail \.thermal-legal-info\{display:none\}/)
assert.match(css, /thermal-receipt--58mm\.thermal-theme--structured-detail/)
assert.match(css, /thermal-theme--branded-modern/)

const electron = read('src/lib/electron.ts')
const printerTab = read('src/pages/settings/PrinterTab.tsx')
assert.match(electron, /isElectron/)
assert.match(printerTab, /getPrinters|receiptPrinterName|a4PrinterName|silentPrint/)

console.log('final web printing refinement tests passed')
