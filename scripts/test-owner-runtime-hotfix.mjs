import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8')
const auth = readFileSync('src/hooks/useAuth.ts', 'utf8')
const recovery = readFileSync('src/lib/authSessionRecovery.ts', 'utf8')
const tracking = readFileSync('src/lib/ownerSetupCompletion.ts', 'utf8')
const boundary = readFileSync('src/components/errors/AppRuntimeErrorBoundary.tsx', 'utf8')
const main = readFileSync('src/main.tsx', 'utf8')
const en = JSON.parse(readFileSync('src/localization/locales/en/common.json', 'utf8'))
const ar = JSON.parse(readFileSync('src/localization/locales/ar-SA/common.json', 'utf8'))

assert.doesNotMatch(sidebar, /canViewOperations/)
assert.doesNotMatch(sidebar, /operationsRoles/)
assert.match(sidebar, /isSuperAdmin\s*\?\s*\[\.\.\.superAdminNav, operationsNavItem\]/)
assert.match(sidebar, /:\s*ownerNav/)
assert.doesNotMatch(sidebar.match(/const ownerNav[\s\S]*?\n\]/)?.[0] ?? '', /operations/)

assert.match(recovery, /invalid refresh token\|refresh token not found/i)
assert.match(recovery, /removeItem\(AUTH_STORAGE_KEY\)/)
assert.match(auth, /invalidRefreshHandled/)
assert.equal((auth.match(/clearStaleAuthSessionData\(\)/g) ?? []).length, 2)

assert.match(tracking, /catch \{/)
assert.match(tracking, /tracking request failed safely/)
assert.match(boundary, /getDerivedStateFromError/)
assert.match(boundary, /window\.location\.reload/)
assert.match(boundary, /scope: 'local'/)
assert.match(main, /<AppRuntimeErrorBoundary>/)
assert.ok(en.errors.runtimeTitle && en.errors.runtimeBody && en.reload)
assert.ok(ar.errors.runtimeTitle && ar.errors.runtimeBody && ar.reload)

console.log('owner runtime hotfix contract: PASS')
