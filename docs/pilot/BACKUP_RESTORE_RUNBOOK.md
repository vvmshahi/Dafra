# Kubri POS Backup And Restore Runbook

## Why Backup And Restore Matters Before Pilot

Before onboarding paying pilot customers, Kubri POS needs a clear way to recover from failed migrations, accidental destructive actions, deployment mistakes, or service incidents. A backup is only useful if the team knows what it contains, where it is stored, who can access it, and how to restore from it.

Run backups before risky migrations, before major onboarding waves, and before production changes that affect financial, tenant, branch, ZATCA, or authentication data.

## What Must Be Backed Up

Back up or record the following before pilot operations:

- Supabase database.
- Storage buckets and important uploaded files, including receipts, purchase bills, product images, and invoice-related assets.
- Edge Function source code in git.
- Deployed frontend commit/version.
- SQL migration files that have been applied.
- Environment and secret names, without actual secret values.
- Supabase project reference and deployment target.
- Desktop app installer versions if distributed.

Do not include actual passwords, access tokens, service role keys, private keys, OTPs, or customer secrets in this runbook.

## Env And Secrets Inventory

Maintain a private inventory of required secret names and where they are configured.

Examples of names to track without values:

- Supabase URL
- Supabase anon key
- Supabase service role key
- ZATCA-related secrets or certificates
- Edge Function environment variables
- Frontend hosting environment variables
- Desktop build signing/notarization variables, if used

Store actual values only in approved secret stores.

## Supabase Dashboard Backup Options

Use the Supabase dashboard to confirm available backup features for the project plan.

Minimum operational steps:

1. Open Supabase project `bkbphkpqcxuejozayrsy`.
2. Confirm point-in-time recovery or scheduled backups if available.
3. Record backup retention window.
4. Confirm who has permission to trigger restore.
5. Confirm restore target behavior before relying on it.
6. Take screenshots of backup status if needed for internal readiness records.

Do not test production restore casually. Use a staging or temporary restore target when possible.

## SQL Dump Backup Option

If `pg_dump` is available locally, create a database dump before risky SQL.

Example command shape:

```bash
pg_dump "postgresql://postgres:<PASSWORD>@db.bkbphkpqcxuejozayrsy.supabase.co:5432/postgres" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "kubri-pos-production-YYYYMMDD-HHMM.dump"
```

Notes:

- Replace `<PASSWORD>` at runtime only.
- Do not commit dump files to git.
- Store dumps in a private encrypted location.
- Record dump timestamp, project ref, and git commit.
- Avoid putting passwords in shell history when possible.

## Storage Bucket Backup Option

For storage, maintain a separate process to export or mirror important bucket objects.

Important buckets may include:

- Expense receipts
- Purchase bills
- Product images
- Any invoice or ZATCA-related generated files if stored

Minimum record for each storage backup:

- Bucket name
- Backup timestamp
- Object count
- Backup location
- Operator

## Restore Test Process

A restore process must be tested outside production before relying on it.

Suggested staging test:

1. Create or use a non-production Supabase project.
2. Restore a recent database dump.
3. Restore a small representative storage sample.
4. Configure non-production frontend envs.
5. Confirm auth, tenant, branch, POS read paths, reports, receipts, and storage URLs.
6. Document restore duration and blockers.

## Minimum Restore Test Checklist

- [ ] Database schema restored.
- [ ] Key tables contain expected row counts.
- [ ] Auth/user profile relationship is understood.
- [ ] Storage objects are available or known to be external to the dump.
- [ ] Super admin can log in in the test environment.
- [ ] Owner can log in in the test environment.
- [ ] Branch user can log in in the test environment.
- [ ] Invoice list/detail loads.
- [ ] Receipt view loads.
- [ ] Reports load.
- [ ] ZATCA test/sandbox behavior is isolated from production.
- [ ] No production secrets are exposed in staging.

## Backup Frequency During Pilot

Recommended minimum:

- Before every manual production SQL migration.
- Before onboarding each batch of customers.
- Daily during the first active customer week.
- Weekly after pilot workflows stabilize.
- Immediately before any risky data correction.

Adjust frequency upward if customer transaction volume grows.

## Before Risky Migrations

1. Confirm the exact SQL file and git commit.
2. Run SELECT-only preflight checks if available.
3. Confirm current backup exists and is usable.
4. Confirm no active incident is ongoing.
5. Apply SQL manually with `ON_ERROR_STOP=1`.
6. Save command output.
7. Run smoke tests.

## Before Customer Onboarding

1. Confirm latest production deployment is known.
2. Confirm support channel is monitored.
3. Confirm backup status.
4. Confirm owner setup flow.
5. Confirm branch username login.
6. Confirm POS, receipt print, and reports.
7. Confirm billing and branch limit process.

## Emergency Rollback Thinking

Use the least destructive recovery path:

1. Frontend issue: roll back frontend deployment.
2. Edge Function issue: redeploy last known-good function source.
3. SQL issue without data damage: prefer forward fix after review.
4. Data corruption or destructive mistake: stop writes if possible, preserve evidence, and evaluate restore.

Never improvise a destructive database rollback during customer hours without a clear plan.

## What Not To Do

- Do not delete production tenants casually.
- Do not reset the database password without updating all dependent envs.
- Do not expose backups publicly.
- Do not commit backup files to git.
- Do not paste secrets into tickets or chats.
- Do not restore production over production without approval and a downtime plan.
- Do not assume a backup works until restore has been tested.

