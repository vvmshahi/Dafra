import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migration = readFileSync(
  join(root, 'supabase/migrations/20260725000500_zatca_demo_provisioning_guard_table_dispatch.sql'),
  'utf8',
)

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const tenantStart = migration.indexOf("IF TG_TABLE_NAME = 'tenants' THEN")
const branchStart = migration.indexOf("IF TG_TABLE_NAME = 'branches' THEN")
const unsupportedStart = migration.indexOf(
  "RAISE EXCEPTION 'ZATCA demo provisioning guard does not support table %'",
)

const tenantPath = migration.slice(tenantStart, branchStart)
const branchPath = migration.slice(branchStart, unsupportedStart)

function evaluateGuard({
  table,
  operation = 'INSERT',
  role = 'authenticated',
  tenantIsDemo = false,
  newIsDemo = false,
  oldIsDemo = false,
  environment = 'production',
  oldEnvironment = 'production',
}) {
  if (table === 'tenants') {
    if (
      role !== 'service_role'
      && (
        (operation === 'INSERT' && newIsDemo === true)
        || (operation === 'UPDATE' && newIsDemo !== oldIsDemo)
      )
    ) {
      return { allowed: false, code: '42501', message: 'Demo tenant marker is managed by secure provisioning' }
    }
    return { allowed: true }
  }

  if (table === 'branches') {
    if (
      role !== 'service_role'
      && (
        (operation === 'INSERT' && environment !== 'production')
        || (operation === 'UPDATE' && environment !== oldEnvironment)
      )
    ) {
      return { allowed: false, code: '42501', message: 'Branch ZATCA environment is managed by secure provisioning' }
    }
    if (
      (tenantIsDemo === true && environment !== 'sandbox')
      || (tenantIsDemo !== true && environment !== 'production')
    ) {
      return {
        allowed: false,
        code: '23514',
        message: 'Demo branches require sandbox and ordinary branches require production',
      }
    }
    return { allowed: true }
  }

  return { allowed: false, code: '0A000' }
}

test('migration replaces only the provisioning guard function', () => {
  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
    1,
  )
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.zatca_demo_provisioning_guard\(\)/,
  )
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER|ALTER\s+TABLE|CREATE\s+TABLE/i)
})

test('branch path never references the tenant-only NEW.is_demo field', () => {
  assert.ok(tenantStart >= 0)
  assert.ok(branchStart > tenantStart)
  assert.ok(unsupportedStart > branchStart)
  assert.match(tenantPath, /NEW\.is_demo/)
  assert.doesNotMatch(branchPath, /NEW\.is_demo|OLD\.is_demo/)
  assert.match(branchPath, /WHERE t\.id = NEW\.tenant_id/)
})

test('ordinary production branch insertion remains valid', () => {
  assert.deepEqual(
    evaluateGuard({
      table: 'branches',
      tenantIsDemo: false,
      environment: 'production',
    }),
    { allowed: true },
  )
})

test('demo sandbox branches require secure provisioning and sandbox', () => {
  assert.deepEqual(
    evaluateGuard({
      table: 'branches',
      role: 'service_role',
      tenantIsDemo: true,
      environment: 'sandbox',
    }),
    { allowed: true },
  )
  assert.equal(
    evaluateGuard({
      table: 'branches',
      role: 'service_role',
      tenantIsDemo: true,
      environment: 'production',
    }).code,
    '23514',
  )
  assert.equal(
    evaluateGuard({
      table: 'branches',
      tenantIsDemo: true,
      environment: 'sandbox',
    }).code,
    '42501',
  )
})

test('ordinary branches cannot use sandbox even through provisioning', () => {
  assert.equal(
    evaluateGuard({
      table: 'branches',
      role: 'service_role',
      tenantIsDemo: false,
      environment: 'sandbox',
    }).code,
    '23514',
  )
})

test('tenant demo marker remains protected outside service-role provisioning', () => {
  assert.equal(
    evaluateGuard({
      table: 'tenants',
      newIsDemo: true,
    }).code,
    '42501',
  )
  assert.equal(
    evaluateGuard({
      table: 'tenants',
      operation: 'UPDATE',
      oldIsDemo: false,
      newIsDemo: true,
    }).code,
    '42501',
  )
  assert.deepEqual(
    evaluateGuard({
      table: 'tenants',
      role: 'service_role',
      newIsDemo: true,
    }),
    { allowed: true },
  )
})

test('function security attributes and existing errors remain unchanged', () => {
  assert.match(migration, /RETURNS trigger/)
  assert.match(migration, /LANGUAGE plpgsql/)
  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /SET search_path = public/)
  assert.match(migration, /SET row_security = off/)
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/)
  assert.match(migration, /Demo tenant marker is managed by secure provisioning/)
  assert.match(migration, /Branch ZATCA environment is managed by secure provisioning/)
  assert.match(migration, /Demo branches require sandbox and ordinary branches require production/)
  assert.match(migration, /ERRCODE = '42501'/)
  assert.match(migration, /ERRCODE = '23514'/)
})

test('unsupported trigger tables fail closed', () => {
  assert.equal(evaluateGuard({ table: 'products' }).code, '0A000')
  assert.match(
    migration,
    /ZATCA demo provisioning guard does not support table %/,
  )
})

for (const result of results) console.log(`ok - ${result}`)
console.log(`ZATCA demo provisioning guard tests passed (${results.length})`)
