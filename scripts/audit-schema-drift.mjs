import { readFileSync } from 'node:fs'

const [remotePath, localPath] = process.argv.slice(2)
if (!remotePath || !localPath) {
  throw new Error('Usage: node scripts/audit-schema-drift.mjs <remote.json> <local.json>')
}

const unwrap = path => {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const row = parsed.rows?.[0] ?? parsed
  return row.schema_snapshot ?? row.jsonb_build_object ?? row
}

const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  }
  return value
}
const stable = value => JSON.stringify(canonicalize(value))
const keyed = (values, key) => new Map(values.map(value => [key(value), value]))
const compare = (category, localValues, remoteValues, key, normalize = value => value) => {
  const local = keyed(localValues, key)
  const remote = keyed(remoteValues, key)
  const differences = []
  for (const [id, value] of local) {
    if (!remote.has(id)) differences.push({ category, kind: 'local_only', id, local: value })
    else if (stable(normalize(value)) !== stable(normalize(remote.get(id)))) {
      differences.push({ category, kind: 'different', id, local: value, remote: remote.get(id) })
    }
  }
  for (const [id, value] of remote) {
    if (!local.has(id)) differences.push({ category, kind: 'remote_only', id, remote: value })
  }
  return differences
}

const normalizeIndex = value => ({ ...value, name: undefined, definition: value.definition.replace(/CREATE (UNIQUE )?INDEX \S+ ON/, 'CREATE $1INDEX ON') })
const normalizeConstraint = value => ({ ...value, name: undefined })
const relationKey = value => `${value.schema}.${value.name}`
const nested = (remote, local, category, field, key, normalize) => compare(
  category,
  local.flatMap(relation => (relation[field] ?? []).map(value => ({ relation: relationKey(relation), ...value }))),
  remote.flatMap(relation => (relation[field] ?? []).map(value => ({ relation: relationKey(relation), ...value }))),
  value => `${value.relation}.${key(value)}`,
  normalize,
)

const remote = unwrap(remotePath)
const local = unwrap(localPath)
const rawDifferences = [
  ...compare('schema', local.schemas, remote.schemas, value => value.name),
  ...compare('extension', local.extensions, remote.extensions, value => value.name),
  ...compare('relation', local.relations, remote.relations, relationKey, value => ({ ...value, columns: undefined, constraints: undefined, indexes: undefined, policies: undefined, triggers: undefined, grants: undefined })),
  ...nested(remote.relations, local.relations, 'column', 'columns', value => value.name),
  ...nested(remote.relations, local.relations, 'constraint', 'constraints', value => value.name, normalizeConstraint),
  ...nested(remote.relations, local.relations, 'index', 'indexes', value => value.name, normalizeIndex),
  ...nested(remote.relations, local.relations, 'policy', 'policies', value => value.name),
  ...nested(remote.relations, local.relations, 'trigger', 'triggers', value => value.name),
  ...nested(remote.relations, local.relations, 'grant', 'grants', value => `${value.grantee}.${value.privilege}`),
  ...compare('function', local.functions, remote.functions, value => `${value.schema}.${value.name}(${value.identity_arguments})`),
]

const categoryLetter = difference => {
  if (difference.category === 'column') {
    if (difference.kind === 'different' && ['type', 'default', 'not_null', 'identity', 'generated']
      .some(field => difference.local[field] !== difference.remote[field])) return 'D'
    return 'C'
  }
  return ({ schema: 'A/B', extension: 'A/B', relation: 'A/B', constraint: 'E', index: 'F', function: 'G', trigger: 'H', grant: 'I', policy: 'I' })[difference.category]
}

const assess = difference => {
  const id = difference.id
  const target = id === 'public.cancel_purchase_receiving(p_purchase_id uuid, p_reason text, p_confirm boolean)'
  const branchPresentation = id.startsWith('public.branches.') && /invoice_display_|show_(company|branch)_display_name|thermal_density|a4_template_id|document_template_version|logo_asset_version|compliance_identity_mode/.test(id)
  const remoteZatca = id.includes('zatca_sandbox') || id.includes('zatca_production_debug') || id.includes('tenants_single_permanent_demo_uidx')
  const generated = /^(extensions|realtime|net|pgbouncer)\./.test(id) || id.includes('.MAINTAIN') || id.includes('.REFERENCES') || id.includes('.TRIGGER') || id.includes('.TRUNCATE')
  if (target) return { risk: 'critical', purchase_dependency: 'direct', recommended_action: 'preserve remote and separately merge any proven package-reversal change', provenance: 'tracked local baseline plus remote-only role expansion; manual or untracked origin not proven' }
  if (branchPresentation) return { risk: 'high', purchase_dependency: 'indirect', recommended_action: 'preserve remote pending application-compatibility decision', provenance: 'local columns introduced by 20260721000300; remote history records it but its deployed effect is absent' }
  if (remoteZatca) return { risk: 'high', purchase_dependency: 'none', recommended_action: 'preserve remote; capture separately if it must become migration-managed', provenance: 'matches manual Phase 5Q foundation script, not a recorded migration' }
  if (generated) return { risk: 'low', purchase_dependency: 'none', recommended_action: 'no action until version/default-ACL normalization is separately reviewed', provenance: 'environment-generated or default-ACL metadata; not treated as business behavior' }
  return { risk: 'medium', purchase_dependency: 'review', recommended_action: 'preserve remote pending focused provenance and behavioral review', provenance: 'not automatically attributable by the comparator' }
}
const differences = rawDifferences.map(difference => ({
  ...difference,
  drift_category: categoryLetter(difference),
  assessment: assess(difference),
}))

const byCategory = Object.fromEntries([...new Set(differences.map(item => item.category))]
  .sort()
  .map(category => [category, differences.filter(item => item.category === category).length]))

process.stdout.write(`${JSON.stringify({
  summary: { total: differences.length, by_category: byCategory },
  differences,
}, null, 2)}\n`)
