import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import {
  buildCatalogueExportCsv,
  buildCatalogueExportXlsx,
  catalogueExportFilename,
  catalogueExportSheets,
  neutralizeSpreadsheetText,
  sanitizeCatalogueExportFilename,
} from '../src/lib/products/catalogueExport.ts'

const source = readFileSync(new URL('../src/pages/products/CatalogueExportDialog.tsx', import.meta.url), 'utf8')

const payload = {
  scope: 'catalogue',
  items: [
    { name: 'Coffee', secondDescription: 'قهوة', isService: false, categoryName: 'Beverages', sellingPrice: 12.5, sku: '=SKU-1', barcode: '@bar', trackStock: true, currentStock: 18, unit: 'Piece', vatTreatment: 'inclusive', isActive: true },
    { name: 'استشارة / Consulting', secondDescription: null, isService: true, categoryName: 'Services', sellingPrice: 250, sku: null, barcode: null, trackStock: false, currentStock: null, unit: 'Hour', vatTreatment: 'exempt', isActive: true },
  ],
  categories: [
    { name: 'Beverages', isActive: true, productCount: 1 },
    { name: 'خدمات', isActive: true, productCount: 1 },
  ],
}

const sheets = catalogueExportSheets(payload)
assert.deepEqual(sheets.map(sheet => sheet.name), ['Items', 'Categories'])
assert.equal(sheets[0].headers[0], 'Item Name')
assert.equal(sheets[0].rows[0][2], 'Product')
assert.equal(sheets[0].rows[1][2], 'Service')
assert.equal(sheets[0].rows[0][4], 12.5)
assert.equal(sheets[0].rows[0][8], 18)
assert.equal(sheets[0].rows[1][8], '')
assert.equal(sheets[0].rows[0][9], 'Piece')
assert.equal(sheets[1].rows[1][0], 'خدمات')

const csv = buildCatalogueExportCsv(payload)
assert.ok(csv.startsWith('\uFEFF'))
assert.match(csv, /قهوة/)
assert.match(csv, /\u200B=SKU-1/)
assert.match(csv, /\u200B@bar/)
assert.match(csv, /Category,خدمات/)
assert.equal(neutralizeSpreadsheetText('-unsafe'), '\u200B-unsafe')
assert.equal(neutralizeSpreadsheetText(12.5), '12.5')

const workbook = unzipSync(buildCatalogueExportXlsx(payload))
assert.ok(workbook['xl/workbook.xml'])
assert.ok(workbook['xl/worksheets/sheet1.xml'])
assert.ok(workbook['xl/worksheets/sheet2.xml'])
assert.match(strFromU8(workbook['xl/workbook.xml']), /sheet name="Items"[\s\S]*sheet name="Categories"/)
assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /<autoFilter ref="A1:L3"/)
assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /<pane ySplit="1"/)
assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /<c r="E2" s="1" t="n"><v>12.5<\/v><\/c>/)
assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /قهوة/)

assert.equal(sanitizeCatalogueExportFilename('Main / فرع جدة!!'), 'Main-فرع-جدة')
assert.equal(catalogueExportFilename('categories', 'Main / فرع جدة!!', 'xlsx', new Date('2026-08-17T00:00:00Z')), 'kubri-categories-Main-فرع-جدة-2026-08-17.xlsx')

assert.match(source, /\.eq\('tenant_id', tenantId\)[\s\S]*?\.eq\('branch_id', branchId\)/)
assert.match(source, /canExport/)
assert.match(source, /if \(!canExport\)/)
assert.match(source, /CATALOGUE_EXPORT_MAX_ROWS/)
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/)
assert.doesNotMatch(source, /fetch\(|axios|spreadsheet.*https/i)
assert.match(source, /right-to-left|dir=\"rtl\"|useTranslation/)

console.log('Catalogue bulk export: 27 read-only workbook, CSV, security, and Unicode assertions passed')
