import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseCsv, suggestMapping, toImportPayload } from '../src/lib/products/catalogueImport.ts'

const migration = await readFile('supabase/migrations/20260817000200_secure_catalogue_bulk_import_v1.sql', 'utf8')
assert.match(migration, /SECURITY DEFINER/)
assert.match(migration, /auth\.uid\(\) IS NULL/)
assert.match(migration, /assert_product_write_access/)
assert.match(migration, /CREATE_PRODUCT_SECURE/i)
assert.match(migration, /create_product_unit_barcode/)
assert.match(migration, /update_product_stock_settings/)
assert.match(migration, /EXCEPTION WHEN unique_violation/)
assert.match(migration, /REVOKE ALL ON FUNCTION.*PUBLIC, anon/s)
assert.match(migration, /GRANT EXECUTE.*authenticated/s)
const rows = parseCsv('Item Name,Selling Price,SKU,Barcode,Track Stock,Opening Stock,Item Type\r\nماء,3.5,WATER-1,123456,Yes,12,Product\r\nخدمة,0,,,No,,Service')
const mapped = toImportPayload(rows, suggestMapping(rows[0]))
assert.equal(mapped.issues.length, 0)
assert.equal(mapped.payload.length, 2)
assert.equal(mapped.payload[0].opening_stock, 12)
assert.equal(mapped.payload[1].is_service, true)
assert.equal(mapped.payload[1].track_stock, false)
console.log('catalogue bulk import checks passed')
