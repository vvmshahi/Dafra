import assert from 'node:assert/strict'
import fs from 'node:fs'

const ui = fs.readFileSync('src/pages/settings/ZatcaTab.tsx', 'utf8')
const api = fs.readFileSync('src/lib/zatca/api.ts', 'utf8')

const resetSection = ui.slice(ui.indexOf("currentStatus === 'compliance_failed'"), ui.indexOf("{showOnboardingForm && !(statusLoading && !status) && (", ui.indexOf("currentStatus === 'compliance_failed'")))
assert.ok(resetSection.length > 0, 'reset section must exist')
assert.doesNotMatch(resetSection, /<form|onSubmit/)
assert.match(resetSection, /<button type="button"[^>]*onClick=\{event => \{ event\.preventDefault\(\)/)
assert.match(resetSection, /event\.stopPropagation\(\)/)
assert.match(resetSection, /void resetFailed\(\)/)
assert.doesNotMatch(resetSection, /onboardProductionZatca|connect\(\)/)

const resetApi = api.slice(api.indexOf('export async function resetFailedProductionOnboarding'), api.indexOf('export async function disconnectProductionZatca'))
assert.match(resetApi, /action: 'reset_failed'/)
assert.doesNotMatch(resetApi, /otp|onboardProductionZatca|generateProductionCsr/i)
assert.match(ui, /setStatus\(next\)[\s\S]*setCapability\(''\)[\s\S]*onStatusChange\(next\)/)

console.log('ZATCA reset event-chain contract passed')
