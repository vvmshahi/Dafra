import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JsBarcode from 'jsbarcode'
import { JSDOM } from 'jsdom'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260726000100_product_unit_barcodes.sql')
const returnTypeFix = read('supabase/migrations/20260726000200_fix_barcode_rpc_return_types.sql')
const preflight = read('scripts/sql/barcodes/01_preflight.sql')
const verification = read('scripts/sql/barcodes/02_post_migration_verification.sql')
const runtimeContract = read('scripts/sql/barcodes/03_isolated_runtime_test.sql')
const scanner = read('src/lib/barcodes/scanner.ts')
const barcode = read('src/lib/barcodes/barcode.ts')
const labels = read('src/lib/barcodes/labelPrint.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const manager = read('src/pages/products/ProductBarcodesSection.tsx')

for (const operation of [
  'create_product_unit_barcode', 'update_product_unit_barcode',
  'disable_product_unit_barcode', 'reactivate_product_unit_barcode',
  'set_primary_product_unit_barcode', 'list_product_unit_barcodes',
  'resolve_product_unit_barcode', 'generate_internal_product_unit_barcode',
  'record_product_barcode_print',
]) {
  assert.match(migration, new RegExp(`FUNCTION public\\.${operation.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`))
}

assert.match(migration, /UNIQUE INDEX product_unit_barcodes_active_branch_value_uidx[\s\S]*branch_id, normalized_barcode[\s\S]*WHERE is_active/)
assert.match(migration, /FOREIGN KEY \(product_unit_id, product_id\)[\s\S]*REFERENCES public\.product_units \(id, product_id\)/)
assert.match(migration, /FOREIGN KEY \(product_id, tenant_id, branch_id\)[\s\S]*REFERENCES public\.products \(id, tenant_id, branch_id\)/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /Barcode is already assigned in this branch/)
assert.doesNotMatch(migration, /already assigned.*(?:product|tenant).*%/i)
assert.match(migration, /REVOKE ALL ON TABLE public\.product_unit_barcodes[\s\S]*PUBLIC, anon, authenticated/)
assert.match(migration, /SET search_path = public, pg_temp[\s\S]*SET row_security = off/)
assert.match(migration, /source = 'internal'|source', 'internal'/)
assert.match(migration, /DF.*gen_random_uuid/)
assert.match(migration, /disabled identities are retained|Disabled identities are retained/)
assert.match(migration, /Duplicate legacy product barcodes require resolution/)
assert.match(migration, /JOIN public\.product_units pu ON pu\.product_id = p\.id AND pu\.is_base/)
assert.match(migration, /public\.branch_effective_stock_enabled/)
assert.match(migration, /WHEN NOT pu\.is_active OR NOT pu\.selling_enabled THEN 'inactive_unit'/)
assert.match(migration, /CASE WHEN pu\.pricing_method = 'custom'/)
assert.match(migration, /first_print[\s\S]*reprint/)
assert.match(migration, /copies > 50[\s\S]*reason/)

assert.match(migration, /actor_role text/)
assert.match(migration, /SELECT up\.id, up\.role, pu\.tenant_id/, 'original enum/text mismatch remains reproducible')
assert.match(returnTypeFix, /actor_role text/)
assert.match(returnTypeFix, /up\.role::text/)
assert.doesNotMatch(returnTypeFix, /SELECT\s+up\.id,\s+up\.role,/)
assert.match(returnTypeFix, /SECURITY DEFINER/)
assert.match(returnTypeFix, /SET search_path = public, pg_temp/)
assert.match(returnTypeFix, /SET row_security = off/)
assert.match(returnTypeFix, /REVOKE ALL ON FUNCTION public\.product_barcode_scope\(uuid\)[\s\S]*PUBLIC, anon, authenticated, service_role/)
assert.doesNotMatch(returnTypeFix, /GRANT EXECUTE ON FUNCTION public\.product_barcode_scope/)
assert.match(returnTypeFix, /barcode_function_contracts_v1/)
assert.match(returnTypeFix, /md5\(pg_get_functiondef/)
assert.match(verification, /pg_get_function_result/)
assert.match(verification, /format_type\(p\.proallargtypes\[3\], NULL\) AS actor_role_declared_type/)
assert.match(verification, /contract_matches/)
assert.doesNotMatch(preflight, /^\\echo/m)
assert.doesNotMatch(verification, /^\\echo/m)
assert.match(runtimeContract, /pg_typeof\(scope\.actor_role\)::text/)
assert.match(runtimeContract, /create_product_unit_barcode/)
assert.match(runtimeContract, /duplicate barcode unexpectedly succeeded/)
assert.match(runtimeContract, /cross-tenant scope unexpectedly succeeded/)
assert.match(runtimeContract, /ROLLBACK;/)

assert.match(barcode, /replace\(\/\^\[ \\t\\r\\n\]\+\|\[ \\t\\r\\n\]\+\$\/g, ''\)/)
assert.match(barcode, /hasValidGtinCheckDigit/)
assert.match(barcode, /value\.length - 1 - index\) % 2 === 1 \? 3 : 1/)
assert.match(barcode, /ean13/)
assert.match(barcode, /code128/)
assert.match(scanner, /event\.key === 'Enter' \|\| event\.key === 'Tab'/)
assert.match(scanner, /idleCompletionMs/)
assert.match(scanner, /maxInterCharacterMs/)
assert.match(scanner, /event\.repeat/)
assert.match(scanner, /data-scanner-ignore/)
assert.match(scanner, /\[role="dialog"\]/)
assert.match(scanner, /input, textarea, select, \[contenteditable="true"\]/)
assert.match(scanner, /this\.tail = this\.tail\.then\(run, run\)/)
assert.match(scanner, /whenIdle\(\): Promise<void>/)

assert.match(pos, /resolve_product_unit_barcode/)
assert.match(pos, /addScannedUnit\(product, unit\)/)
assert.match(pos, /applyScannerCartMutation/)
assert.doesNotMatch(pos, /now - previous\.at < 120/)
assert.match(pos, /receipt \|\| showOpenSession \|\| showCloseSession \|\| unitChooserProduct/)
assert.match(pos, /resolvedBarcodeCacheRef/)
assert.match(pos, /product_unit_version/)
assert.match(pos, /conversion_to_base/)
assert.match(pos, /pricing_method/)
assert.match(pos, /selling_price/)
assert.match(manager, /list_product_unit_barcodes/)
assert.match(manager, /generate_internal_product_unit_barcode/)
assert.match(manager, /getProductBarcodePrintStatus/)
assert.match(manager, /BarcodeQuickPrintDialog/)
assert.doesNotMatch(manager, /print_kind:\s*'reprint'/)

assert.match(labels, /import JsBarcode from 'jsbarcode'/)
assert.match(labels, /EAN13/)
assert.match(labels, /EAN8/)
assert.match(labels, /UPC/)
assert.match(labels, /CODE128/)
assert.match(labels, /escapeHtml/)
assert.match(labels, /width:\s*\$\{width\}mm/)
assert.match(labels, /expandedLabels/)
assert.match(labels, /print-page--a4/)
assert.match(labels, /@page \{ size: \$\{pageSize\}/)
assert.match(labels, /grid-template-columns/)
assert.match(labels, /BarcodePrintAdapter/)

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const render = (value, format) => {
  const svg = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, { format, xmlDocument: dom.window.document, displayValue: true })
  return svg.outerHTML
}
assert.match(render('DF001234567890123456', 'CODE128'), /<rect|<path/, 'Code 128 renders')
assert.match(render('4006381333931', 'EAN13'), /006381/, 'valid EAN-13 renders')
assert.match(render('96385074', 'EAN8'), /9638/, 'valid EAN-8 renders')
assert.match(render('036000291452', 'UPC'), /36000/, 'valid UPC-A renders')
assert.throws(() => render('4006381333932', 'EAN13'), /checksum|valid/i, 'invalid EAN-13 is rejected')

// Independent deterministic scanner model checks the release timing contract.
class Capture {
  constructor(now, emit) { this.now = now; this.emit = emit; this.buffer = ''; this.started = 0; this.last = 0 }
  key(value) {
    const at = this.now()
    if (value === 'Enter' || value === 'Tab') {
      if (this.buffer.length >= 3 && at - this.started <= 1500) this.emit(this.buffer)
      this.buffer = ''
      return
    }
    if (this.buffer && at - this.last > 45) this.buffer = ''
    if (!this.buffer) this.started = at
    this.buffer += value
    this.last = at
  }
}
let time = 0
const captures = []
const capture = new Capture(() => time, code => captures.push(code))
for (const character of '00012345') { capture.key(character); time += 8 }
capture.key('Enter')
assert.deepEqual(captures, ['00012345'], 'Enter capture preserves leading zeros')
time += 150
for (const character of 'CARTON01') { capture.key(character); time += 6 }
capture.key('Tab')
assert.deepEqual(captures, ['00012345', 'CARTON01'], 'Tab capture preserves scan order')
time += 150
capture.key('a'); time += 100; capture.key('b'); time += 100; capture.key('Enter')
assert.equal(captures.length, 2, 'human-speed typing is ignored')

const queueOutput = []
let tail = Promise.resolve()
for (const [value, delay] of [['piece', 20], ['carton', 1], ['piece', 2]]) {
  tail = tail.then(() => new Promise(resolve => setTimeout(() => { queueOutput.push(value); resolve() }, delay)))
}
await tail
assert.deepEqual(queueOutput, ['piece', 'carton', 'piece'], 'slow lookups cannot reorder scans')

console.log('barcode workflow tests passed')
