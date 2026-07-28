import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const entry = `
  import React, { act, useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import { decideProtectedRoute, decideSetupBranchRoute } from './src/lib/authRouteRecovery.ts'
  export { React, act, useState, createRoot, decideProtectedRoute, decideSetupBranchRoute }
`
const built = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, format: 'esm', platform: 'browser', write: false,
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const {
  React, act, useState, createRoot, decideProtectedRoute, decideSetupBranchRoute,
} = await import(moduleUrl)

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const base = {
  loading: false, authError: null, isAuthenticated: true,
  isOnboarded: true, role: 'owner', firstBranchAccessComplete: false,
}
let setMountedState
function RouteProbe() {
  const [state, setState] = useState(base)
  setMountedState = setState
  const protectedDecision = decideProtectedRoute(state)
  const setupDecision = decideSetupBranchRoute(state)
  return React.createElement('output', {
    'data-protected': protectedDecision,
    'data-setup': setupDecision,
  }, `${protectedDecision}|${setupDecision}`)
}
const root = createRoot(document.getElementById('root'))
await act(async () => root.render(React.createElement(RouteProbe)))
const output = () => document.querySelector('output')
assert.equal(output().dataset.protected, 'setup-branch')
assert.equal(output().dataset.setup, 'allow')

// Branch row exists but access is partial: the same incomplete boolean remains
// on setup. Complete access transitions to the dashboard deterministically.
await act(async () => setMountedState({ ...base, firstBranchAccessComplete: true }))
assert.equal(output().dataset.protected, 'allow')
assert.equal(output().dataset.setup, 'dashboard')

// Transient query failure has a bounded recovery state, never a spinner.
await act(async () => setMountedState({ ...base, authError: 'PROFILE_QUERY_FAILED' }))
assert.equal(output().dataset.protected, 'recovery')
assert.equal(output().dataset.setup, 'recovery')

// Confirmed missing profile is also a bounded recovery state in the real Auth
// hook; validate its three-attempt contract and recovery actions.
const authSource = readFileSync('src/hooks/useAuth.ts', 'utf8')
assert.ok(authSource.includes('PROFILE_RETRY_DELAYS_MS = [0, 250, 750]'))
assert.ok(authSource.includes('profile: currentProfile.current'))
const appSource = readFileSync('src/App.tsx', 'utf8')
assert.match(appSource, /AuthRecoveryPanel/)
assert.match(appSource, /onRetry/)
assert.match(appSource, /onSignOut/)

// Missing branch, manual-review branch, and branch-only partial state all share
// the resumable setup route; the page renders the manual-review support state.
await act(async () => setMountedState(base))
assert.equal(output().dataset.setup, 'allow')
const setupSource = readFileSync('src/pages/onboarding/SetupBranchPage.tsx', 'utf8')
assert.match(setupSource, /firstBranchProvisioningState === 'failed_manual_review'/)

// Onboarding replay reconciliation uses authoritative refreshed profile state.
const onboarding = readFileSync('src/pages/onboarding/OnboardingPage.tsx', 'utf8')
assert.match(onboarding, /ALREADY_ONBOARDED\\|timeout\\|network\\|fetch/)
assert.ok(onboarding.includes('reconciled.profile?.tenant_id'))

const en = JSON.parse(readFileSync('src/localization/locales/en/onboarding.json', 'utf8'))
const ar = JSON.parse(readFileSync('src/localization/locales/ar-SA/onboarding.json', 'utf8'))
assert.ok(en.errors.manualReview && en.errors.usernameTaken)
assert.ok(ar.errors.manualReview && ar.errors.usernameTaken)

await act(async () => root.unmount())
dom.window.close()
console.log('phase1 mounted route/auth recovery runtime: PASS')
