import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SAUDI_TIME_ZONE,
  formatSaudiDate,
  formatSaudiTime,
  saudiDatePresetRange,
  saudiDateRangeUtc,
} from '../src/lib/utils/date.ts'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const page = read('src/pages/invoices/InvoicesPage.tsx')
const cache = read('src/lib/invoices/invoiceListCache.ts')

assert.equal(SAUDI_TIME_ZONE, 'Asia/Riyadh')
const crossMidnight = '2026-07-26T22:30:00.000Z'
assert.match(formatSaudiDate(crossMidnight, 'en'), /27 Jul 2026/)
assert.match(formatSaudiTime(crossMidnight, 'en'), /01:30/)

const fixedNow = '2026-03-01T00:30:00.000Z'
assert.deepEqual(saudiDatePresetRange('today', fixedNow), {
  start: '2026-03-01',
  end: '2026-03-01',
})
assert.deepEqual(saudiDateRangeUtc('2026-03-01', '2026-03-01'), {
  start: '2026-02-28T21:00:00.000Z',
  end: '2026-03-01T20:59:59.999Z',
})
assert.deepEqual(saudiDatePresetRange('yesterday', fixedNow), {
  start: '2026-02-28',
  end: '2026-02-28',
})
assert.deepEqual(saudiDatePresetRange('this_month', fixedNow), {
  start: '2026-03-01',
  end: '2026-03-01',
})
assert.deepEqual(saudiDatePresetRange('last_month', fixedNow), {
  start: '2026-02-01',
  end: '2026-02-28',
})
assert.deepEqual(saudiDateRangeUtc('2026-07-25', '2026-07-27'), {
  start: '2026-07-24T21:00:00.000Z',
  end: '2026-07-27T20:59:59.999Z',
})

assert.match(page, /const effectiveBranchId = profile\?\.role === 'branch'[\s\S]*profile\.branch_id[\s\S]*selectedOwnerBranchId/)
assert.match(page, /usePosSession\(effectiveBranchId \?\? undefined, profile\?\.tenant_id, undefined\)/)
assert.match(page, /\.from\('branches'\)[\s\S]*\.select\('id, name, name_ar(?:, fiscal_regime)?'\)[\s\S]*\.eq\('tenant_id', profile\.tenant_id\)/)
assert.match(page, /setSelectedOwnerBranchId\(current =>[\s\S]*branches\[0\]\?\.id/)
assert.match(page, /value=\{selectedOwnerBranchId \?\? ''\}[\s\S]*onChange=\{event => setSelectedOwnerBranchId/)
assert.match(page, /branchId: effectiveBranchId/)
assert.match(page, /\.from\('pos_sessions'\)[\s\S]*\.eq\('status', 'closed'\)[\s\S]*\.order\('closed_at', \{ ascending: false \}\)[\s\S]*\.limit\(1\)/)
assert.match(page, /activeSession[\s\S]*setSessionShortcut\('current'\)[\s\S]*setQuickRange\(null\)/)
assert.match(page, /else \{[\s\S]*setSessionShortcut\(null\)[\s\S]*setQuickRange\('today'\)/)
assert.match(page, /initializedBranchRef\.current === branchId/)
assert.match(page, /if \(!filtersResolved\)[\s\S]*resolvingSessionFilter/)
assert.match(page, /setSessionShortcut\(null\)[\s\S]*setQuickRange\(range\)/)
assert.match(page, /setQuickRange\(null\)[\s\S]*setSessionShortcut\(shortcut\)/)
assert.match(page, /baseQuery\.eq\('session_id', activeScope\.sessionId\)/)
assert.match(page, /saudiDateRangeUtc\(activeScope\.startDate, activeScope\.endDate\)/)
assert.match(page, /\.gte\('created_at', range\.start\)\.lte\('created_at', range\.end\)/)
assert.match(page, /fmtDate\(r\.createdAt, i18n\.language\)/)
assert.match(page, /fmtTime\(r\.createdAt, i18n\.language\)/)
assert.match(page, /formatSaudiTime\(selectedSession\.opened_at, i18n\.language\)/)
assert.match(page, /formatSaudiDateTime\(selectedSession\.closed_at!, i18n\.language\)/)
assert.match(page, /const summary = \{[\s\S]*filtered\.length[\s\S]*filtered\.reduce/)
assert.match(page, /if \(q &&[\s\S]*payFilter !== 'all'[\s\S]*zatcaFilter !== 'all'/)
assert.doesNotMatch(page, /\{selectedSession\.id\}|\{activeSession\.id\}|\{previousSession\.id\}/)
assert.match(cache, /sessionId\?: string \| null/)
assert.match(cache, /scope\.sessionId \?\? 'date'/)
assert.match(page, /<CreateCreditNoteModal/)
assert.match(page, /renderDocumentActions\(document\)/)

const requiredKeys = [
  'sessionShortcuts',
  'currentSession',
  'previousSession',
  'noActiveSession',
  'noPreviousSession',
  'loadingPreviousSession',
  'resolvingSessionFilter',
  'sessionResolutionFailed',
  'sessionResolutionFailedHint',
  'sessionOpenedAt',
  'sessionClosedAt',
  'noCurrentSessionInvoices',
  'noPreviousSessionInvoices',
  'noInvoicesToday',
  'noInvoicesDateRange',
  'sessionEmptyHint',
  'branchFilter',
  'loadingBranches',
  'noBranches',
  'branchLoadFailed',
]
for (const localePath of [
  'src/localization/locales/en/invoices.json',
  'src/localization/locales/ar-SA/invoices.json',
]) {
  const locale = json(localePath)
  for (const key of requiredKeys) {
    assert.equal(typeof locale[key], 'string', `${localePath} is missing ${key}`)
    assert.ok(locale[key].trim(), `${localePath} has an empty ${key}`)
  }
}

console.log('Invoice Saudi-time and session-filter contract checks passed')
