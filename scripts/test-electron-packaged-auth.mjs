import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyAuthFailure } from '../src/lib/authFailure.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const root = new URL('../', import.meta.url).pathname
const supabase = read(`${root}src/lib/supabase.ts`)
const auth = read(`${root}src/hooks/useAuth.ts`)
const login = read(`${root}src/pages/auth/LoginPage.tsx`)
const main = read(`${root}electron/main.cjs`)
const buildGuard = read(`${root}scripts/validate-electron-build-environment.mjs`)
const bundled = fs.readdirSync(`${root}dist/assets`).map((file) => read(`${root}dist/assets/${file}`)).join('\n')

assert.match(buildGuard, /bkbphkpqcxuejozayrsy\.supabase\.co/)
assert.match(buildGuard, /Electron production build requires/) 
assert.match(supabase, /expectedSupabaseHost = 'bkbphkpqcxuejozayrsy\.supabase\.co'/)
assert.match(supabase, /Desktop application configuration error/)
assert.match(main, /scheme: APP_PROTOCOL/)
assert.match(main, /secure: true/)
assert.match(main, /supportFetchAPI: true/)
assert.match(auth, /resolve-branch-username/)
assert.match(auth, /signInWithPassword/)
assert.match(auth, /authFailureDiagnostic/)
assert.match(auth, /safeAuthError/)
assert.match(login, /!isDesktopApp\(\)/)
assert.match(login, /to="\/"/)
assert.match(bundled, /bkbphkpqcxuejozayrsy\.supabase\.co/)
assert.doesNotMatch(bundled, /placeholder\.supabase\.co/)

assert.equal(classifyAuthFailure({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials.' }), 'invalid_credentials')
assert.equal(classifyAuthFailure(new TypeError('Failed to fetch')), 'network')
assert.notEqual(classifyAuthFailure(new TypeError('Failed to fetch')), 'invalid_credentials')
assert.equal(classifyAuthFailure({ status: 500, message: 'Edge Function returned an error' }), 'unavailable')

console.log('Electron packaged-auth configuration, protocol, flow, safe error mapping, session contract, and Back-button tests passed.')
