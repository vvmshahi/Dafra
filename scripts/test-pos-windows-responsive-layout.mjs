import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pos = readFileSync(new URL('../src/pages/pos/POSPage.tsx', import.meta.url), 'utf8')

// The POS terminal must remain two-pane at common Windows effective desktop
// widths, while deliberately returning to its stacked touch layout below 960px.
assert.match(pos, /data-pos-terminal className="flex h-\[100dvh\] flex-col overflow-hidden bg-\[#f7f8f5\] min-\[960px\]:flex-row"/)
assert.doesNotMatch(pos, /data-pos-terminal[^\n]*lg:flex-row/)
assert.match(pos, /data-pos-order-panel className="flex h-\[44dvh\] w-full flex-shrink-0 flex-col[\s\S]*?min-\[960px\]:h-auto[\s\S]*?min-\[960px\]:w-\[360px\]/)
assert.match(pos, /<div className="flex min-h-0 min-w-0 flex-1 flex-col" dir=\{isRtl \? 'rtl' : 'ltr'\}>/)

// Long category labels remain inside their own scroll container instead of
// widening the catalogue or forcing the terminal back into a column.
assert.match(pos, /ref=\{categoryScrollRef\} className="flex min-w-0 flex-1 items-center gap-1\.5 overflow-x-auto"/)
assert.match(pos, /data-pos-product-grid className="grid grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"/)

console.log('POS Windows responsive layout contract passed (two-pane >=960px, stacked below, shrink-safe catalogue, scrollable categories).')
