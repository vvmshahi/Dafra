import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveProduct } from '../src/lib/products/archiveProduct.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const page = read('src/pages/products/ProductsPage.tsx')
const dialog = read('src/components/ui/ConfirmDialog.tsx')
const archiveContract = read('src/lib/products/archiveProduct.ts')
const enProducts = JSON.parse(read('src/localization/locales/en/products.json'))
const arProducts = JSON.parse(read('src/localization/locales/ar-SA/products.json'))
const enDialogs = JSON.parse(read('src/localization/locales/en/dialogs.json'))
const arDialogs = JSON.parse(read('src/localization/locales/ar-SA/dialogs.json'))

function mockClient(response) {
  const calls = []
  const client = {
    from(table) {
      calls.push(['from', table])
      return {
        update(values) {
          calls.push(['update', values])
          return {
            eq(column, value) {
              calls.push(['eq', column, value])
              return {
                select(columns) {
                  calls.push(['select', columns])
                  return { single: async () => response }
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, calls }
}

{
  const { client, calls } = mockClient({ data: { id: 'product-1' }, error: null, status: 200 })
  await archiveProduct(client, 'product-1')
  assert.deepEqual(calls, [
    ['from', 'products'],
    ['update', { is_active: false }],
    ['eq', 'id', 'product-1'],
    ['select', 'id'],
  ])
}

for (const response of [
  { data: null, error: new Error('network'), status: 500 },
  { data: null, error: null, status: 204 },
  { data: { id: 'another-product' }, error: null, status: 200 },
  { data: { id: 'product-1' }, error: null, status: 400 },
]) {
  const { client } = mockClient(response)
  await assert.rejects(() => archiveProduct(client, 'product-1'))
}

assert.match(page, /function ProductCard\(\{[\s\S]*?onArchive/)
assert.match(page, /function ProductListRow\(\{[\s\S]*?onArchive/)
assert.match(page, /const handleArchive = async/)
assert.doesNotMatch(page, /handleDelete|onDelete|deleteProduct/)
assert.match(page, /<Archive size=\{13\} aria-hidden="true"/)
assert.match(page, /<Archive size=\{14\} aria-hidden="true"/)
assert.doesNotMatch(page, /Trash2/)
assert.match(page, /title=\{t\('actions\.archiveProduct'/)
assert.match(page, /aria-label=\{t\('actions\.archiveProduct'/)
assert.match(page, /focus-visible:ring-2 focus-visible:ring-amber-500/)
assert.match(page, /disabled=\{archiveLoading\}/)
assert.match(page, /aria-busy=\{archiveLoading \|\| undefined\}/)
assert.match(page, /archivePendingRef\.current/)
assert.match(page, /if \(!id \|\| archivePendingRef\.current\) return/)
assert.match(page, /await archiveProduct\([\s\S]*?setProducts\(/)
assert.match(page, /toast\.success\(t\('archive\.success'\)\)/)
assert.match(page, /catch \{[\s\S]*?toast\.error\(t\('archive\.error'\)\)/)
assert.match(page, /kind="archive"/)
assert.match(page, /busy=\{archivingId !== null\}/)
assert.match(page, /cancelLabel=\{t\('common:cancel'\)\}/)
assert.match(dialog, /role="alertdialog"/)
assert.match(dialog, /aria-labelledby=\{titleId\}/)
assert.match(dialog, /aria-describedby=\{bodyId\}/)
assert.match(dialog, /if \(!busy\) onClose\(\)/)
assert.doesNotMatch(archiveContract, /\.delete\(/)

assert.equal(enDialogs.archive.title, 'Archive product?')
assert.equal(enDialogs.archive.body, 'This product will be removed from the active catalogue and POS. Sales and stock history will be preserved.')
assert.equal(enDialogs.archive.confirm, 'Archive product')
assert.equal(arDialogs.archive.title, 'أرشفة المنتج؟')
assert.equal(arDialogs.archive.body, 'سيتم إخفاء هذا المنتج من الكتالوج النشط ونقطة البيع، مع الاحتفاظ بسجل المبيعات والمخزون.')
assert.equal(arDialogs.archive.confirm, 'أرشفة المنتج')
assert.equal(enProducts.actions.archiveProduct, 'Archive {{name}}')
assert.equal(arProducts.actions.archiveProduct, 'أرشفة {{name}}')
assert.equal(enProducts.archive.success, 'Product archived successfully.')
assert.equal(enProducts.archive.error, 'Could not archive the product. Please try again.')
assert.equal(arProducts.archive.success, 'تمت أرشفة المنتج بنجاح.')
assert.equal(arProducts.archive.error, 'تعذرت أرشفة المنتج. يرجى المحاولة مرة أخرى.')

console.log('Product archive contract/UI tests passed.')
