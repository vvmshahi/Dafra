import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/pages/reports/RegisterSessionsReport.tsx', 'utf8')

assert.match(source, /function ExecutiveSummary/)
assert.match(source, /const \[selectedSession, setSelectedSession\] = useState<RegisterSessionSummary \| null>/)
assert.match(source, /function SessionDetailModal/)
assert.match(source, /role="dialog" aria-modal="true"/)
assert.match(source, /<SessionDetailModal session=\{selectedSession\}/)
assert.ok(source.includes("<KpiCard label={t('sessions.netSales')} value={<Rial amount={session.totalSales} />} primary onDark />"))
assert.ok(source.includes("<KpiCard label={t('sessions.cash')} value={<Rial amount={session.cashTotal} />} onDark />"))
assert.ok(source.includes("<KpiCard label={t('sessions.card')} value={<Rial amount={session.cardTotal} />} onDark />"))
assert.match(source, /onViewDetails=\{\(\) => setSelectedSession\(session\)\}/)
assert.doesNotMatch(source, /expandedSessions|toggleSession|aria-expanded/)
assert.match(source, /sessions\.netSales/)
assert.match(source, /sessions\.expectedCash/)
assert.match(source, /Math\.abs\(diff\) < 0\.01/)
assert.match(source, /sm:grid-cols-5/)
assert.match(source, /sm:grid-cols-5/)
assert.doesNotMatch(source, /get_register_sessions_filtered.*\.update|\.from\('register_sessions'\)\.(update|insert|delete)/s)

console.log('Register-session compact history and accessible expansion UI checks passed')
