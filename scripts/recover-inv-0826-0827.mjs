#!/usr/bin/env node

const BRANCH_ID = '371dee75-6e46-496e-89e7-1a7492b51a3c'
const CLIENT_VERSION = '2.1.0'
const CONFIRMATION = `recover:${BRANCH_ID}:865-866`
const RECOVERY_PLAN = Object.freeze([
  {
    invoiceId: '0121e5c8-14bf-45ec-bf29-3b0466a18bab',
    invoiceNumber: 'INV-0826',
    counterNumber: 865,
    previousHash: 't3CZaYvRmwniI6rCyL+OfITTxHJQ5BdA1CjvdgVN1cY=',
    artifactHash: 'Fcs7MaZh3flIRjoAtZUW3nd3mS1PqqOxsIlJMkhAu48=',
  },
  {
    invoiceId: '3ae21515-0807-463e-919d-19f40eb5b406',
    invoiceNumber: 'INV-0827',
    counterNumber: 866,
    previousHash: 'Fcs7MaZh3flIRjoAtZUW3nd3mS1PqqOxsIlJMkhAu48=',
    artifactHash: '1sjvDue9saSjyaN4Dh0RfVwgYt3J75zSHOxdd3wmjvY=',
  },
])

function usage() {
  return [
    'Immutable simplified recovery for INV-0826 then INV-0827.',
    '',
    'Dry run (local plan only; performs no network or database access):',
    '  node scripts/recover-inv-0826-0827.mjs --dry-run',
    '',
    'Authorized execution (not for audit use):',
    `  node scripts/recover-inv-0826-0827.mjs --execute --confirm '${CONFIRMATION}'`,
    '',
    'Required execution-only environment:',
    '  DAFRA_SUPABASE_URL',
    '  DAFRA_SUPABASE_ANON_KEY',
    '  DAFRA_OPERATOR_ACCESS_TOKEN',
  ].join('\n')
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  const dryRun = argv.includes('--dry-run')
  const execute = argv.includes('--execute')
  if (dryRun === execute) throw new Error('Choose exactly one of --dry-run or --execute.')
  const confirmIndex = argv.indexOf('--confirm')
  const confirmation = confirmIndex >= 0 ? argv[confirmIndex + 1] : null
  if (execute && confirmation !== CONFIRMATION) {
    throw new Error(`Execution requires the exact confirmation: ${CONFIRMATION}`)
  }
  return { help: false, dryRun, execute }
}

function validatePlan() {
  if (RECOVERY_PLAN.length !== 2) throw new Error('Recovery plan must contain exactly two invoices.')
  for (let index = 0; index < RECOVERY_PLAN.length; index += 1) {
    const target = RECOVERY_PLAN[index]
    if (target.counterNumber !== 865 + index) throw new Error('Recovery counters are not 865 then 866.')
    if (index > 0 && target.previousHash !== RECOVERY_PLAN[index - 1].artifactHash) {
      throw new Error('Recovery PIH chain is not contiguous.')
    }
  }
}

function executionSettings() {
  const url = process.env.DAFRA_SUPABASE_URL?.replace(/\/+$/, '')
  const anonKey = process.env.DAFRA_SUPABASE_ANON_KEY
  const accessToken = process.env.DAFRA_OPERATOR_ACCESS_TOKEN
  if (!url || !anonKey || !accessToken) {
    throw new Error('Missing execution-only Supabase URL, anon key, or operator access token.')
  }
  return { url, anonKey, accessToken }
}

async function responseBody(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { error: `Non-JSON response (HTTP ${response.status})` }
  }
}

async function recoverOne(settings, target) {
  const response = await fetch(`${settings.url}/functions/v1/zatca-submit`, {
    method: 'POST',
    headers: {
      apikey: settings.anonKey,
      Authorization: `Bearer ${settings.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'recover_immutable_pair',
      clientVersion: CLIENT_VERSION,
      source: 'manual_retry',
      branchId: BRANCH_ID,
      invoiceId: target.invoiceId,
      confirmation: CONFIRMATION,
    }),
  })
  const body = await responseBody(response)
  if (!response.ok) {
    throw new Error(
      `${target.invoiceNumber} recovery request failed (HTTP ${response.status}): `
      + `${body?.code ?? body?.error ?? 'unknown error'}`,
    )
  }
  const accepted = body?.recovery?.accepted === true
    && body?.invoiceStatus === 'reported'
    && body?.finalizationStatus === 'reported'
    && body?.recovery?.counterNumber === target.counterNumber
  if (!accepted) {
    throw new Error(
      `${target.invoiceNumber} counter ${target.counterNumber} was not accepted; `
      + 'recovery stopped before the next invoice.',
    )
  }
  return {
    invoiceId: target.invoiceId,
    invoiceNumber: target.invoiceNumber,
    counterNumber: target.counterNumber,
    status: 'reported',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  validatePlan()
  if (args.dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      remoteAccess: false,
      branchId: BRANCH_ID,
      order: RECOVERY_PLAN.map(target => ({
        invoiceId: target.invoiceId,
        invoiceNumber: target.invoiceNumber,
        counterNumber: target.counterNumber,
        previousHash: target.previousHash,
        artifactHash: target.artifactHash,
      })),
      invariants: [
        'authenticated hard-coded operator endpoint only',
        'stored simplified XML hash must match invoice and committed reservation',
        'no XML build, renumber, signing, hashing mutation, or QR mutation',
        '866 is attempted only after 865 is reported with a persisted response',
      ],
    }, null, 2))
    return
  }

  const settings = executionSettings()
  const results = []
  for (const target of RECOVERY_PLAN) {
    // Deliberately sequential. Any thrown error exits immediately, so counter
    // 866 is unreachable unless counter 865 returned an accepted/report state.
    results.push(await recoverOne(settings, target))
  }
  console.log(JSON.stringify({ recovered: results }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
