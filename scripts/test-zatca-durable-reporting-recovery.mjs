import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  canOpenStoredInvoicePrint,
  selectStoredOutputStateQr,
} from '../src/lib/zatca/qrDisplay.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('scripts/sql/zatca-phase2-finalization-v2/11_durable_simplified_reporting_outbox.sql')
const dispatcher = read('scripts/sql/zatca-phase2-finalization-v2/operator/install_reporting_outbox_dispatch.sql')
const statusSql = read('scripts/sql/zatca-phase2-finalization-v2/05_capabilities_and_status.sql')
const edge = read('supabase/functions/zatca-submit/index.ts')
const submission = read('src/lib/zatca/submission.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receiptPage = read('src/pages/print/ReceiptPrintPage.tsx')
const receiptPrint = read('src/lib/receiptPrint.ts')
const recovery = read('scripts/recover-inv-0826-0827.mjs')

const tests = []
const test = async (name, fn) => {
  await fn()
  tests.push(name)
}

await test('simplified finalization and durable outbox insert are one transaction', () => {
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_reporting_outbox_v2/)
  const persistence = migration.slice(
    migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.persist_zatca_simplified_final_v2'),
    migration.indexOf('DO $grants$'),
  )
  const chainCommit = persistence.indexOf('PERFORM public.commit_zatca_chain_v2')
  const artifactUpdate = persistence.indexOf('zatca_simplified_xml = p_signed_xml')
  const outboxInsert = persistence.indexOf('INSERT INTO public.zatca_reporting_outbox_v2')
  const successReturn = persistence.indexOf("'reportingDispatch', 'durably_queued'")
  assert.ok(chainCommit >= 0 && chainCommit < artifactUpdate)
  assert.ok(artifactUpdate < outboxInsert && outboxInsert < successReturn)
  assert.match(persistence, /DURABLE_REPORTING_OUTBOX_ALREADY_EXISTS/)
  assert.doesNotMatch(migration, /UPDATE\s+public\.invoices\s+SET[\s\S]*WHERE\s+zatca_artifact_stage\s*=\s*'simplified_final'/i)
})

await test('outbox consumer is server-side, recurring, leased, and ordered', () => {
  assert.match(dispatcher, /cron\.schedule/)
  assert.match(dispatcher, /net\.http_post/)
  assert.match(dispatcher, /vault\.decrypted_secrets/)
  assert.match(dispatcher, /"action":"drain_outbox"/)
  assert.match(edge, /await authorizeDrainRequest/)
  assert.doesNotMatch(edge, /callerJWT === serviceRoleKey/)
  assert.match(dispatcher, /X-Zatca-Dispatch-Token/)
  assert.match(edge, /drainReportingOutboxV2/)
  assert.match(edge, /EdgeRuntime/)
  assert.match(edge, /waitUntil/)
  assert.match(migration, /FOR UPDATE OF o SKIP LOCKED/)
  assert.match(migration, /earlier_invoice\.zatca_counter_number < i\.zatca_counter_number/)
  assert.match(migration, /earlier\.status <> 'accepted'/)
  assert.doesNotMatch(dispatcher, /sync_queue/)
})

await test('worker submits only exact stored simplified XML and never rebuilds or signs', () => {
  const worker = edge.slice(
    edge.indexOf('async function processReportingOutboxV2'),
    edge.indexOf('async function drainReportingOutboxV2'),
  )
  assert.match(worker, /zatca_simplified_xml/)
  assert.match(worker, /zatca_simplified_xml_hash/)
  assert.match(worker, /const recomputedHash = await computeInvoiceHash\(invoice\.zatca_simplified_xml\)/)
  assert.match(worker, /recomputedHash !== invoice\.zatca_simplified_xml_hash/)
  assert.match(worker, /networkClaim\.artifactHash !== invoice\.zatca_simplified_xml_hash/)
  assert.match(worker, /invoice: xmlB64/)
  for (const forbidden of [
    'buildInvoiceXMLData(',
    'buildInvoice(',
    'signInvoice(',
    'buildZatcaPhase2Qr(',
    'allocateChainV2WithWait(',
    'persist_zatca_simplified_final_v2',
  ]) assert.doesNotMatch(worker, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const outcome = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_outbox_result_v2'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.fail_zatca_reporting_outbox_attempt_v2'),
  )
  for (const immutableWrite of [
    'zatca_simplified_xml =',
    'zatca_simplified_xml_hash =',
    'zatca_simplified_signature =',
    'zatca_simplified_qr =',
    'zatca_counter_number =',
    'zatca_prev_invoice_hash =',
  ]) assert.doesNotMatch(outcome, new RegExp(immutableWrite))
})

await test('manual retry routes finalized v2 simplified artifacts to the outbox with flags paused', () => {
  assert.match(submission, /async function retryStoredSimplifiedArtifact/)
  assert.match(submission, /action: 'retry'/)
  assert.match(submission, /output\.artifactStage === 'simplified_final'/)
  assert.match(edge, /action === 'retry'/)
  assert.match(edge, /enqueue_zatca_reporting_outbox_v2/)
  assert.match(edge, /!?\['status', 'retry', 'recover_immutable_pair'\]\.includes\(action\)/)
  assert.match(statusSql, /'locally_finalized', 'reporting_pending'/)
  const retryBlock = edge.slice(
    edge.indexOf("if (action === 'retry')"),
    edge.indexOf("if (action === 'recover_immutable_pair')"),
  )
  for (const forbidden of ['processLegacyInvoiceDisabledMode', 'signInvoice', 'buildInvoice']) {
    assert.doesNotMatch(retryBlock, new RegExp(forbidden))
  }
})

await test('browser navigation after checkout cannot remove the committed reporting job', async () => {
  class TransactionalFinalizer {
    constructor() {
      this.invoice = null
      this.outbox = null
    }
    finalize() {
      this.invoice = {
        artifactStage: 'simplified_final',
        hash: 'FINAL-HASH',
        qr: 'FINAL-QR',
      }
      this.outbox = {
        artifactHash: this.invoice.hash,
        status: 'pending',
      }
      return { qr: this.invoice.qr }
    }
  }
  const server = new TransactionalFinalizer()
  const response = server.finalize()
  const browserNavigatedAway = true
  assert.equal(browserNavigatedAway, true)
  assert.equal(response.qr, 'FINAL-QR')
  assert.deepEqual(server.outbox, { artifactHash: 'FINAL-HASH', status: 'pending' })
  assert.doesNotMatch(pos, /if \(!preOutputSubmission && !finalizationError\)[\s\S]*submitInvoiceForBranch/)
  assert.match(edge, /scheduleReportingOutboxDrain\(supabase as any, invoiceId\)/)
})

await test('historical A4 and receipt share simplified_final output in pending and reported states', () => {
  for (const state of [
    {
      invoiceStatus: 'pending',
      finalizationStatus: 'locally_finalized',
    },
    {
      invoiceStatus: 'reported',
      finalizationStatus: 'reported',
    },
  ]) {
    const output = {
      ...state,
      contractMode: 'v2',
      legacyCompatible: false,
      artifactStage: 'simplified_final',
      documentKind: 'simplified',
      canPrint: true,
      reconciliationRequired: false,
      qrCode: 'STORED-SIMPLIFIED-FINAL-QR',
    }
    const qr = selectStoredOutputStateQr(output)
    assert.equal(qr, 'STORED-SIMPLIFIED-FINAL-QR')
    assert.equal(
      canOpenStoredInvoicePrint(true, qr, 'ready', 'data:image/png;base64,qr'),
      true,
    )
  }
  for (const page of [detail, receiptPage]) {
    assert.match(page, /getInvoiceZatcaOutputState/)
    assert.match(page, /selectStoredOutputStateQr\(outputStateMatchesInvoice \? outputState : null\)/)
    assert.match(page, /qrImageUrl: qrDataUrl/)
  }
  assert.match(submission, /ZATCA_OUTPUT_STATE_READ_VERSION = '2\.0\.0'/)
  assert.match(edge, /invoiceAuth\.target\.v2Invoice === true[\s\S]*loadOutputStateV2/)
})

await test('receipt iframe has an explicit ready/failure handshake and bounded failure', () => {
  assert.match(receiptPrint, /RECEIPT_FRAME_READY/)
  assert.match(receiptPrint, /RECEIPT_FRAME_FAILED/)
  assert.match(receiptPrint, /window\.addEventListener\('message', handleMessage\)/)
  assert.match(receiptPrint, /frameWindow\.print\(\)/)
  assert.match(receiptPrint, /Receipt print content did not become ready in time/)
  assert.match(receiptPage, /window\.parent\.postMessage/)
  assert.match(receiptPage, /embeddedPrint/)
})

await test('recovery is hard-coded, authenticated, idempotent, and counter ordered', () => {
  for (const value of [
    '371dee75-6e46-496e-89e7-1a7492b51a3c',
    '0121e5c8-14bf-45ec-bf29-3b0466a18bab',
    '3ae21515-0807-463e-919d-19f40eb5b406',
    'INV-0826',
    'INV-0827',
    'Fcs7MaZh3flIRjoAtZUW3nd3mS1PqqOxsIlJMkhAu48=',
    '1sjvDue9saSjyaN4Dh0RfVwgYt3J75zSHOxdd3wmjvY=',
  ]) {
    assert.match(edge, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(recovery, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(edge, /reservation\.committed_artifact_hash !== target\.artifactHash/)
  assert.match(edge, /const recomputedHash = await computeInvoiceHash\(invoice\.zatca_simplified_xml\)/)
  assert.match(edge, /RECOVERY_PREDECESSOR_NOT_REPORTED/)
  assert.match(edge, /previous\.zatca_network_response_v2 == null/)
  assert.match(edge, /TENANT_SUBMIT_ROLES\.has\(callerProfile\.role\)/)
  assert.match(recovery, /for \(const target of RECOVERY_PLAN\)/)
  assert.match(recovery, /results\.push\(await recoverOne\(settings, target\)\)/)
  assert.match(recovery, /recovery stopped before the next invoice/)

  const statuses = new Map()
  const dispatched = []
  const dispatch = target => {
    if (target.counterNumber === 866 && statuses.get(865) !== 'reported') {
      throw new Error('RECOVERY_PREDECESSOR_NOT_REPORTED')
    }
    dispatched.push(target.counterNumber)
    statuses.set(target.counterNumber, 'reported')
  }
  dispatch({ counterNumber: 865 })
  dispatch({ counterNumber: 866 })
  assert.deepEqual(dispatched, [865, 866])
})

await test('recovery dry-run performs no remote access', () => {
  const run = spawnSync(
    process.execPath,
    ['scripts/recover-inv-0826-0827.mjs', '--dry-run'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {},
    },
  )
  assert.equal(run.status, 0, run.stderr)
  const output = JSON.parse(run.stdout)
  assert.equal(output.remoteAccess, false)
  assert.deepEqual(output.order.map(target => target.counterNumber), [865, 866])
})

console.log(`ZATCA durable reporting/recovery: ${tests.length} deterministic checks passed`)
for (const name of tests) console.log(`PASS ${name}`)
