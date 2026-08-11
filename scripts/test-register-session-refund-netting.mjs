import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const halalas = (value) => {
  const [whole, fraction = ''] = String(value).split('.')
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
}

const sar = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`

function netTenders(events) {
  return events.reduce((totals, event) => {
    const amount = halalas(event.amount)
    if (event.kind === 'sale') {
      if (event.method === 'cash') totals.cash += amount
      else if (event.method === 'card') totals.card += amount
      else if (event.method === 'bank_transfer') totals.bankTransfer += amount
      else totals.other += amount
      return totals
    }

    // Completed refund payouts are classified by payout method, never by the
    // original sale tender. Non-cash payouts net the register card bucket.
    if (event.method === 'cash') totals.cash -= amount
    else if (event.method === 'card' || event.method === 'bank_transfer') totals.card -= amount
    else totals.other -= amount
    return totals
  }, { cash: 0n, card: 0n, bankTransfer: 0n, other: 0n })
}

const cases = [
  {
    name: '1: cash sale remains cash',
    events: [{ kind: 'sale', method: 'cash', amount: '10.00' }],
    expected: { cash: '10.00', card: '0.00' },
  },
  {
    name: '2: card sale remains card',
    events: [{ kind: 'sale', method: 'card', amount: '10.00' }],
    expected: { cash: '0.00', card: '10.00' },
  },
  {
    name: '3: cash refund reduces cash only',
    events: [
      { kind: 'sale', method: 'cash', amount: '10.00' },
      { kind: 'refund', method: 'cash', amount: '2.00' },
    ],
    expected: { cash: '8.00', card: '0.00' },
  },
  {
    name: '4: card sale with bank-transfer payout reduces card',
    events: [
      { kind: 'sale', method: 'card', amount: '10.00' },
      { kind: 'refund', method: 'bank_transfer', amount: '2.00' },
    ],
    expected: { cash: '0.00', card: '8.00' },
  },
  {
    name: '5: card sale with cash payout leaves card unchanged',
    events: [
      { kind: 'sale', method: 'card', amount: '10.00' },
      { kind: 'refund', method: 'cash', amount: '2.00' },
    ],
    expected: { cash: '-2.00', card: '10.00' },
  },
  {
    name: '6: cash sale with bank-transfer payout leaves cash unchanged',
    events: [
      { kind: 'sale', method: 'cash', amount: '10.00' },
      { kind: 'refund', method: 'bank_transfer', amount: '2.00' },
    ],
    expected: { cash: '10.00', card: '-2.00' },
  },
  {
    name: '7: split sale with cash payout nets the cash allocation only',
    events: [
      { kind: 'sale', method: 'cash', amount: '6.00' },
      { kind: 'sale', method: 'card', amount: '4.00' },
      { kind: 'refund', method: 'cash', amount: '1.00' },
    ],
    expected: { cash: '5.00', card: '4.00' },
  },
  {
    name: '8: split sale with card payout nets the card allocation only',
    events: [
      { kind: 'sale', method: 'cash', amount: '6.00' },
      { kind: 'sale', method: 'card', amount: '4.00' },
      { kind: 'refund', method: 'card', amount: '3.00' },
    ],
    expected: { cash: '6.00', card: '1.00' },
  },
  {
    name: '9: multiple mixed payout refunds retain independent buckets',
    events: [
      { kind: 'sale', method: 'cash', amount: '10.00' },
      { kind: 'sale', method: 'card', amount: '10.00' },
      { kind: 'refund', method: 'cash', amount: '3.00' },
      { kind: 'refund', method: 'bank_transfer', amount: '4.00' },
      { kind: 'refund', method: 'card', amount: '1.00' },
    ],
    expected: { cash: '7.00', card: '5.00' },
  },
  {
    name: '10: SAR .50 card sale plus SAR .50 bank-transfer payout nets exactly to zero',
    events: [
      { kind: 'sale', method: 'card', amount: '0.50' },
      { kind: 'refund', method: 'bank_transfer', amount: '0.50' },
    ],
    expected: { cash: '0.00', card: '0.00' },
  },
]

for (const testCase of cases) {
  const actual = netTenders(testCase.events)
  assert.equal(sar(actual.cash), testCase.expected.cash, `${testCase.name}: net cash`)
  assert.equal(sar(actual.card), testCase.expected.card, `${testCase.name}: net card`)
}

const migration = await readFile('supabase/migrations/20260812000100_register_session_refund_method_netting.sql', 'utf8')
const posPage = await readFile('src/pages/pos/POSPage.tsx', 'utf8')
const dayClosingPage = await readFile('src/pages/day-closing/DayClosingPage.tsx', 'utf8')

for (const requiredFragment of [
  'JOIN public.payment_refunds r ON r.credit_note_invoice_id = i.id',
  "r.status = 'completed'",
  "e.event_kind = 'refund' AND e.method IN ('card', 'bank_transfer')",
  'NOT EXISTS (',
  'get_register_session_summary_before_refund_netting',
  'get_dashboard_summary_before_refund_netting',
  'CREATE OR REPLACE FUNCTION public.close_register_session',
]) {
  assert.ok(migration.includes(requiredFragment), `migration must contain ${requiredFragment}`)
}

const closeSessionModal = posPage.slice(
  posPage.indexOf('function CloseSessionModal'),
  posPage.indexOf('// ── Session Summary Modal'),
)
assert.ok(closeSessionModal.includes("rpc('get_register_session_summary'"), 'Close Register must use the shared session summary')
assert.ok(!closeSessionModal.includes(".from('payments')"), 'Close Register must not reimplement payment tender netting')
assert.ok(dayClosingPage.includes("rpc('get_dashboard_summary'"), 'Day Closing must use the shared dashboard calculation')

console.log(`PASS: register/session refund payout netting (${cases.length} financial cases + contract checks)`)
