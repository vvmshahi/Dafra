import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const root = new URL('..', import.meta.url).pathname
const status = execFileSync('supabase', ['status', '--output', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const env = Object.fromEntries(status.split(/\r?\n/).map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2].replace(/"$/, '')]))
for (const endpoint of [env.API_URL, env.DB_URL]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname), 'Refusing non-local endpoint')
assert.ok(env.SERVICE_ROLE_KEY && env.ANON_KEY, 'Local development keys are required')

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, opts)
const anon = () => createClient(env.API_URL, env.ANON_KEY, opts)
const password = `Phase3D-${randomUUID()}!`
const users = []
const ids = { tenantA: randomUUID(), tenantB: randomUUID(), branchA: randomUUID(), branchB: randomUUID(), customer: randomUUID(), product1: randomUUID(), product2: randomUUID() }
const oldOfficial = { registeredSellerName: 'Phase 3D Historical Seller One', registeredSellerNameAr: 'بائع تاريخي تجريبي واحد', vatNumber: '300000000000003', registrationScheme: 'CRN', registrationIdentifier: '1010999901', buildingNumber: '1234', street: 'Old Synthetic Street', district: 'Old Test District', city: 'Riyadh', postalCode: '12345', country: 'SA', evidenceReference: 'Synthetic localhost evidence' }
const newOfficial = { ...oldOfficial, registeredSellerName: 'Phase 3D Historical Seller Two', vatNumber: '300000000000013', buildingNumber: '5678', street: 'New Synthetic Street', postalCode: '54321' }
const oldPresentation = { invoice_display_heading: 'Old Synthetic Heading', invoice_display_subheading: 'Old Synthetic Subheading', display_name: 'Old Synthetic Company', name: 'Old Synthetic Branch', receipt_footer: 'Old synthetic footer', phone: '+966500000001', email: 'old@example.test', website: 'https://old.example.test', logo_url: 'https://assets.example.test/logo-v1.svg', show_logo: true, show_email: true, show_website: true, show_footer: true, show_cash_change: true, show_company_display_name: true, show_branch_display_name: true, invoice_language: 'both', thermal_density: 'compact', print_mode: 'both', a4_template_id: 'classic', document_template_version: 1 }
const newPresentation = { invoice_display_heading: 'New Synthetic Heading', invoice_display_subheading: 'New Synthetic Subheading', display_name: 'New Synthetic Company', name: 'New Synthetic Branch', receipt_footer: 'New synthetic footer', phone: '+966500000002', email: 'new@example.test', website: 'https://new.example.test', logo_url: 'https://assets.example.test/logo-v2.svg', invoice_language: 'ar', thermal_density: 'detailed', print_mode: 'pdf', a4_template_id: 'modern', document_template_version: 2 }

async function ok(result, label) { if (result.error) throw new Error(`${label}: ${result.error.code ?? ''} ${result.error.message}`); return result.data }
async function denied(promise, label) { const result = await promise; assert.ok(result.error, `${label} unexpectedly succeeded`) }
async function createUser(email, role) { const data = await ok(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } }), `create ${role}`); users.push(data.user.id); return data.user.id }
async function login(email) { const c = anon(); await ok(await c.auth.signInWithPassword({ email, password }), `login ${email}`); return c }
async function rpc(c, name, args) { return ok(await c.rpc(name, args), name) }
async function row(table, id, select = '*') { return ok(await service.from(table).select(select).eq('id', id).single(), `read ${table}`) }
function normalized(invoice, items) {
  const s = invoice.identity_snapshot
  if (!s) return { legacy: true, fidelity: 'best_effort', invoiceNumber: invoice.invoice_number, totals: [invoice.subtotal, invoice.tax_amount, invoice.total_amount] }
  return { legacy: false, compliance: s.compliance, presentation: s.presentation, document: s.document, language: invoice.document_language, invoiceNumber: invoice.invoice_number, uuid: invoice.zatca_uuid, qr: invoice.zatca_qr_code, xmlHash: invoice.zatca_xml_hash, totals: [invoice.subtotal, invoice.tax_amount, invoice.total_amount], items: items.map(i => [i.name, Number(i.quantity), Number(i.unit_price), Number(i.tax_amount), Number(i.total)]) }
}
async function document(id) { const invoice = await row('invoices', id); const items = await ok(await service.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order'), 'read items'); return { invoice, items, render: normalized(invoice, items) } }
function assertSnapshot(snapshot, official, presentation) {
  assert.equal(snapshot.compliance.registeredSellerName, official.registeredSellerName)
  assert.equal(snapshot.compliance.vatNumber, official.vatNumber)
  assert.equal(snapshot.compliance.address.street, official.street)
  assert.equal(snapshot.presentation.displayHeading, presentation.invoice_display_heading)
  assert.equal(snapshot.presentation.footer, presentation.receipt_footer)
  assert.equal(snapshot.presentation.logoUrl, presentation.logo_url)
  assert.ok(snapshot.presentation.logoAssetVersion >= 1)
  assert.equal(snapshot.document.language, presentation.invoice_language)
  assert.equal(snapshot.document.a4TemplateId, presentation.a4_template_id)
  assert.equal(snapshot.document.templateVersion, presentation.document_template_version)
  assert.equal(snapshot.document.thermalDensity, presentation.thermal_density)
  assert.equal(snapshot.document.printMode, presentation.print_mode)
  assert.equal(JSON.stringify(snapshot).includes(presentation.invoice_display_heading), true)
  assert.equal(snapshot.compliance.registeredSellerName.includes(presentation.invoice_display_heading), false)
}
async function cleanup() {
  const tenantList = [`'${ids.tenantA}'::uuid`, `'${ids.tenantB}'::uuid`].join(',')
  execFileSync('docker', ['exec', 'supabase_db_Dafra', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', `BEGIN; DELETE FROM public.branch_compliance_profiles WHERE tenant_id IN (${tenantList}); DELETE FROM public.audit_events WHERE tenant_id IN (${tenantList}); DELETE FROM public.tenants WHERE id IN (${tenantList}); COMMIT;`], { stdio: ['ignore', 'ignore', 'pipe'] })
  for (const id of users.reverse()) await ok(await service.auth.admin.deleteUser(id), 'delete synthetic user')
}

let passed = false
try {
  for (const table of ['tenants', 'user_profiles', 'invoices']) { const r = await service.from(table).select('*', { count: 'exact', head: true }); await ok(r, `initial ${table}`); assert.equal(r.count, 0) }
  const ownerId = await createUser('owner.phase3d@example.test', 'owner')
  const branchUserId = await createUser('branch.phase3d@example.test', 'branch')
  const otherOwnerId = await createUser('other-owner.phase3d@example.test', 'owner')
  await ok(await service.from('tenants').insert([{ id: ids.tenantA, name: 'Phase 3D Synthetic Tenant A', vat_number: '300000000000023', cr_number: '1010999902', city: 'Riyadh' }, { id: ids.tenantB, name: 'Phase 3D Synthetic Tenant B', vat_number: '300000000000033', cr_number: '1010999903', city: 'Jeddah' }]), 'tenants')
  await ok(await service.from('branches').insert([{ id: ids.branchA, tenant_id: ids.tenantA, branch_code: 'P3DA', is_main_branch: true, ...oldPresentation }, { id: ids.branchB, tenant_id: ids.tenantB, branch_code: 'P3DB', is_main_branch: true, ...oldPresentation, name: 'Unrelated Synthetic Branch' }]), 'branches')
  await ok(await service.from('user_profiles').upsert([{ id: ownerId, tenant_id: ids.tenantA, role: 'owner', email: 'owner.phase3d@example.test', full_name: 'Synthetic Owner', is_active: true }, { id: branchUserId, tenant_id: ids.tenantA, branch_id: ids.branchA, role: 'branch', email: 'branch.phase3d@example.test', full_name: 'Synthetic Branch User', is_active: true }, { id: otherOwnerId, tenant_id: ids.tenantB, role: 'owner', email: 'other-owner.phase3d@example.test', full_name: 'Synthetic Other Owner', is_active: true }]), 'profiles')
  const owner = await login('owner.phase3d@example.test'); const branchUser = await login('branch.phase3d@example.test'); const otherOwner = await login('other-owner.phase3d@example.test')
  await rpc(owner, 'save_branch_compliance_draft', { p_branch_id: ids.branchA, p_payload: oldOfficial, p_reason: 'Synthetic initial profile' })
  await rpc(owner, 'confirm_branch_official_seller_information', { p_branch_id: ids.branchA, p_payload: oldOfficial, p_reason: 'Synthetic owner confirmation', p_confirmation: true })
  await ok(await service.from('customers').insert({ id: ids.customer, tenant_id: ids.tenantA, branch_id: ids.branchA, name: 'Synthetic Customer', customer_type: 'individual', phone: '+966500000099', is_active: true }), 'customer')
  await ok(await service.from('products').insert([{ id: ids.product1, tenant_id: ids.tenantA, branch_id: ids.branchA, name: 'Synthetic Product One', name_ar: 'منتج تجريبي واحد', sku: 'P3D-1', price: 100, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', is_service: true, track_stock: false, is_active: true, is_available: true }, { id: ids.product2, tenant_id: ids.tenantA, branch_id: ids.branchA, name: 'Synthetic Product Two', name_ar: 'منتج تجريبي اثنان', sku: 'P3D-2', price: 50, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', is_service: true, track_stock: false, is_active: true, is_available: true }]), 'products')
  const issue = async (key) => rpc(branchUser, 'pos_checkout', { p_payload: { branch_id: ids.branchA, customer_id: ids.customer, idempotency_key: key, payment_method: 'card', items: [{ product_id: ids.product1, quantity: 2 }, { product_id: ids.product2, quantity: 1 }] } })
  const checkoutA = await issue(`phase3d-a-${randomUUID()}`); assert.deepEqual([Number(checkoutA.subtotal), Number(checkoutA.tax_amount), Number(checkoutA.total)], [250, 37.5, 287.5])
  const syntheticQrSource = JSON.stringify({ synthetic: true, seller: oldOfficial.registeredSellerName, vat: oldOfficial.vatNumber, invoiceId: checkoutA.invoice_id })
  await ok(await service.from('invoices').update({ zatca_qr_code: syntheticQrSource }).eq('id', checkoutA.invoice_id), 'seed synthetic stored QR source')
  const a1 = await document(checkoutA.invoice_id); assertSnapshot(a1.invoice.identity_snapshot, oldOfficial, oldPresentation); assert.equal(a1.invoice.document_language, 'both'); assert.equal(a1.invoice.zatca_qr_code, syntheticQrSource); assert.equal(a1.invoice.zatca_xml_hash, null); assert.ok(!syntheticQrSource.includes(oldPresentation.invoice_display_heading))
  const frozenA = JSON.stringify(a1.render); const frozenSnapshotA = JSON.stringify(a1.invoice.identity_snapshot)
  await ok(await service.from('branches').update(newPresentation).eq('id', ids.branchA), 'new presentation')
  const a2 = await document(checkoutA.invoice_id); assert.equal(JSON.stringify(a2.render), frozenA); assert.equal(a2.invoice.identity_snapshot.presentation.logoAssetVersion, a1.invoice.identity_snapshot.presentation.logoAssetVersion)
  await rpc(owner, 'save_branch_compliance_draft', { p_branch_id: ids.branchA, p_payload: newOfficial, p_reason: 'Synthetic identity update' }); let ready = await rpc(owner, 'get_branch_compliance_readiness', { p_branch_id: ids.branchA }); assert.equal(ready.status, 'revalidation_required')
  await rpc(owner, 'confirm_branch_official_seller_information', { p_branch_id: ids.branchA, p_payload: newOfficial, p_reason: 'Synthetic reconfirmation', p_confirmation: true })
  const a3 = await document(checkoutA.invoice_id); assert.equal(JSON.stringify(a3.render), frozenA); assert.equal(JSON.stringify(a3.invoice.identity_snapshot), frozenSnapshotA)
  const checkoutB = await issue(`phase3d-b-${randomUUID()}`); const b1 = await document(checkoutB.invoice_id); assertSnapshot(b1.invoice.identity_snapshot, newOfficial, newPresentation); assert.equal(b1.invoice.document_language, 'ar'); assert.notEqual(JSON.stringify(b1.render), frozenA)
  await ok(await service.from('invoices').update({ zatca_status: 'reported' }).in('id', [checkoutA.invoice_id, checkoutB.invoice_id]), 'synthetic reported prerequisite')
  const full = await rpc(branchUser, 'create_full_credit_note', { p_payload: { original_invoice_id: checkoutA.invoice_id, idempotency_key: `phase3d-full-${randomUUID()}`, reason: 'Synthetic full return', refund_method: 'card', return_stock: false } }); const fullDoc = await document(full.credit_note_invoice_id)
  assert.equal(fullDoc.invoice.original_invoice_id, checkoutA.invoice_id); assert.equal(fullDoc.invoice.invoice_reference, a1.invoice.invoice_number); assertSnapshot(fullDoc.invoice.identity_snapshot, newOfficial, newPresentation); assert.equal(Number(fullDoc.invoice.total_amount), 287.5)
  const bItem = b1.items[0]; const partial = await rpc(branchUser, 'create_partial_credit_note', { p_payload: { original_invoice_id: checkoutB.invoice_id, idempotency_key: `phase3d-part-${randomUUID()}`, reason: 'Synthetic partial return', refund_method: 'card', return_stock: false, items: [{ original_invoice_item_id: bItem.id, quantity: 1 }] } }); const partialDoc = await document(partial.credit_note_invoice_id)
  assert.equal(partialDoc.invoice.original_invoice_id, checkoutB.invoice_id); assert.equal(Number(partialDoc.invoice.total_amount), 115); assertSnapshot(partialDoc.invoice.identity_snapshot, newOfficial, newPresentation)
  const creditFrozen = [JSON.stringify(fullDoc.render), JSON.stringify(partialDoc.render)]
  await ok(await service.from('branches').update({ invoice_display_heading: 'Third Heading', receipt_footer: 'Third Footer', invoice_language: 'en', a4_template_id: 'future', document_template_version: 3 }).eq('id', ids.branchA), 'later settings')
  assert.equal(JSON.stringify((await document(full.credit_note_invoice_id)).render), creditFrozen[0]); assert.equal(JSON.stringify((await document(partial.credit_note_invoice_id)).render), creditFrozen[1])
  await denied(branchUser.from('invoices').update({ identity_snapshot: { rewritten: true } }).eq('id', checkoutA.invoice_id), 'snapshot rewrite')
  await denied(owner.from('invoices').update({ document_language: 'en' }).eq('id', checkoutA.invoice_id), 'language rewrite')
  const qrReplacement = await branchUser.from('invoices').update({ zatca_qr_code: 'replacement' }).eq('id', checkoutA.invoice_id).select('id')
  assert.equal(qrReplacement.error, null); assert.deepEqual(qrReplacement.data, []); assert.equal((await row('invoices', checkoutA.invoice_id, 'zatca_qr_code')).zatca_qr_code, syntheticQrSource)
  await denied(otherOwner.from('invoices').select('id').eq('id', checkoutA.invoice_id).single(), 'cross tenant invoice read')
  const branchRead = await ok(await branchUser.from('invoices').select('id').in('id', [checkoutA.invoice_id, checkoutB.invoice_id]), 'assigned document read'); assert.equal(branchRead.length, 2)
  await ok(await service.from('branches').update({ compliance_identity_mode: 'legacy' }).eq('id', ids.branchA), 'enable legacy simulation')
  await ok(await service.from('invoices').insert({ id: randomUUID(), tenant_id: ids.tenantA, branch_id: ids.branchA, created_by: ownerId, invoice_number: `LEG-${randomUUID().slice(0, 8)}`, zatca_invoice_type: 'simplified', zatca_type_code: '388', zatca_status: 'pending', subtotal: 1, discount_amount: 0, taxable_amount: 1, tax_amount: 0, total_amount: 1, currency_code: 'SAR', invoice_date: '2026-07-21', status: 'posted', payment_status: 'pending', identity_snapshot: null }), 'legacy simulation')
  await ok(await service.from('branches').update({ compliance_identity_mode: 'protected' }).eq('id', ids.branchA), 'restore protected mode')
  const legacy = await ok(await service.from('invoices').select('*').like('invoice_number', 'LEG-%').single(), 'legacy read'); assert.deepEqual(normalized(legacy, []), { legacy: true, fidelity: 'best_effort', invoiceNumber: legacy.invoice_number, totals: [legacy.subtotal, legacy.tax_amount, legacy.total_amount] })
  for (const doc of [a1, b1, fullDoc, partialDoc]) { const text = JSON.stringify(doc.invoice.identity_snapshot).toLowerCase(); for (const secret of ['password', 'access_token', 'service_role', 'private_key', 'certificate', 'csid', 'otp', 'base64']) assert.ok(!text.includes(secret)); assert.equal(JSON.stringify(normalized(doc.invoice, doc.items)), JSON.stringify(normalized(doc.invoice, doc.items))) }
  const sizes = [a1, b1, fullDoc, partialDoc].map(d => Buffer.byteLength(JSON.stringify(d.invoice.identity_snapshot)))
  const average = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length); const largest = Math.max(...sizes)
  assert.ok(largest < 10000); assert.equal(await ok(await service.from('invoices').select('*', { count: 'exact', head: true }), 'invoice count').then(() => true), true)
  passed = true
  console.log(JSON.stringify({ result: 'Phase 3D runtime assertions passed', snapshotBytes: sizes, averageSnapshotBytes: average, largestSnapshotBytes: largest, projectedBytes: { oneMillion: average * 1_000_000, tenMillion: average * 10_000_000, hundredMillion: average * 100_000_000 } }))
} finally {
  await cleanup()
  for (const table of ['tenants', 'user_profiles', 'invoices']) { const r = await service.from(table).select('*', { count: 'exact', head: true }); await ok(r, `cleanup ${table}`); assert.equal(r.count, 0) }
  const authCount = execFileSync('docker', ['exec', 'supabase_db_Dafra', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'SELECT count(*) FROM auth.users'], { encoding: 'utf8' }).trim(); assert.equal(authCount, '0')
  if (!passed) console.error('Phase 3D cleanup completed after failure.')
}
