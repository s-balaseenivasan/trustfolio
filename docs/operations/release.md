# Release and recovery runbook

Trustfolio uses PostgreSQL and either local uploads or Vercel Blob. The database and file store form one recovery set. The operating team must assign an owner and approve recovery point and recovery time targets before handling live financial records.

## Before release

1. Run `npm ci`, `npm run check`, `npm run check:db`, and `npm audit --omit=dev --audit-level=moderate` in CI. Run the headed portal scripts against a disposable local database and review their traces.
2. Record the application commit, migration list, target database, storage driver, backup timestamp, and rollback owner. Verify the backup can be read before applying migrations.
3. Keep checkout, donation confirmation, financial posting, and public financial totals disabled until their separate policy and acceptance gates are complete.
4. Run `prisma migrate deploy` once per release, before serving the new application version. Confirm `prisma migrate status` and smoke test `/en`, `/ta`, `/admin/login`, the private portals, and public document links.

## Back up and restore

1. Take a consistent PostgreSQL backup with `pg_dump --format=custom` and record the matching upload or Blob inventory. Encrypt backups at rest and restrict access to designated operators.
2. Restore into an isolated database with `pg_restore`, restore the matching file set, and point a test deployment at both. Check row counts, migration status, access to private files with an authorized account, denial without authorization, and public document links.
3. Record actual recovery time and data loss against approved targets. Repeat the rehearsal after storage, schema, or hosting changes and on a regular schedule set by the operator.
4. For an incident, stop writes, preserve logs and the current database, restore into a new isolated environment, verify it, then switch traffic. Do not reset or overwrite the source database as a rollback shortcut.

For a local rehearsal, set `PG_BIN` to the PostgreSQL binary directory and run `npm run test:recovery`. The script creates a disposable schema and private file, dumps both, restores them, verifies their references, and removes its fixtures. It never changes the live application schema. This confirms the local dump and restore procedure; it does not set production recovery targets or replace a rehearsal with the deployed storage provider.

## Monitoring

Alert on failed migrations, repeated 5xx responses, authentication spikes, upload failures, database connection saturation, missing backups, and failed contact notification delivery. Once payments or posting are approved, add alerts for unmatched provider events, duplicate or failed posting attempts, and reconciliation lag. Keep logs free of private document contents, passwords, tokens, and donor payment references.

The backup schedule, retention period, targets, monitoring provider, and on-call owner are deployment decisions. This file is a procedure, not evidence that a restore rehearsal has passed.
