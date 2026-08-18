import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/pages/reports/RegisterSessionsReport.tsx', 'utf8')

assert.match(source, /const \[expandedSessions, setExpandedSessions\] = useState<Set<string>>/)
assert.match(source, /setExpandedSessions\(current =>/)
assert.match(source, /aria-expanded=\{expanded\}/)
assert.match(source, /aria-controls=\{cardId\}/)
assert.ok(source.includes('{expanded && <div id={cardId}><SessionDetails session={session} /></div>}'))
assert.match(source, /if \(current\) return <article/)
assert.match(source, /<SessionDetails session=\{session\} \/>/)
assert.match(source, /sessions\.netSales/)
assert.match(source, /sessions\.expectedCash/)
assert.match(source, /Math\.abs\(diff\) < 0\.01/)
assert.match(source, /md:grid-cols-3/)
assert.match(source, /sm:grid-cols-5/)
assert.doesNotMatch(source, /get_register_sessions_filtered.*\.update|\.from\('register_sessions'\)\.(update|insert|delete)/s)

console.log('Register-session compact history and accessible expansion UI checks passed')
