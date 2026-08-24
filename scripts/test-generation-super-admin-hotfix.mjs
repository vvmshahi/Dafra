import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const clients = readFileSync('src/pages/super-admin/ClientsPage.tsx', 'utf8')
const owner = readFileSync('supabase/functions/create-owner-account/index.ts', 'utf8')

const request = ({ planId, isDemo, fiscalRegime }) => ({
  plan_id: planId,
  is_demo: isDemo,
  fiscal_regime: fiscalRegime,
})

const generation = request({ planId: 'commercial-phase-1', isDemo: false, fiscalRegime: 'generation' })
const integration = request({ planId: 'commercial-phase-2', isDemo: false, fiscalRegime: 'integration' })

assert.equal(generation.is_demo, false)
assert.equal(generation.fiscal_regime, 'generation')
assert.equal(integration.is_demo, false)
assert.equal(integration.fiscal_regime, 'integration')
assert.notEqual(generation.fiscal_regime, integration.fiscal_regime)
assert.match(clients, /const \[isDemo,\s+setIsDemo\]\s+= useState\(false\)/)
assert.match(clients, /const \[fiscalRegime, setFiscalRegime\] = useState<.*>\('generation'\)/)
assert.match(clients, /account_type:\s+isDemo \? 'demo' : 'production'/)
assert.match(clients, /fiscal_intent:\s+fiscalRegime === 'generation' \? 'generation' : 'integration_setup'/)
assert.ok(clients.indexOf('Account type') < clients.indexOf('Fiscal intent is independent'))
assert.ok(clients.indexOf('Fiscal intent is independent') < clients.indexOf('/* Plan + branches */'))
assert.match(clients, /displayCommercialPlanName\(p\.name\)\} — SAR \{p\.price_monthly\}\/branch\/mo/)
assert.doesNotMatch(clients, /fiscalRegime\s*=\s*.*p\.name|p\.name.*fiscalRegime/)
assert.match(owner, /typeof body\.is_demo !== 'boolean'/)
assert.match(owner, /is_demo: body\.is_demo/)
assert.match(owner, /fiscal_regime: body\.fiscal_regime === 'generation' \? 'generation' : 'integration'/)

console.log('Generation Super Admin account-creation hotfix tests passed (13 assertions)')
