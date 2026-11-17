/** Deploy all migrations to a disposable local schema and exercise Phase 6 pending-only gates. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase6_test_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base }); await root.connect(); let created = false;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: scoped.toString() }, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` }); await db.connect();
    try {
      await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now()),($5,$6,$3,$7,now())', ["admin", "admin@phase6.test", "test-only", "ADMIN", "donor", "donor@phase6.test", "PORTAL_USER"]);
      await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","status","publishedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now(),now())', ["project", "phase6-project", "Published test project", "Private test fixture", "PUBLISHED"]);
      await db.query('INSERT INTO "DonorProfile" ("id","userId","createdById","updatedAt") VALUES ($1,$2,$3,now())', ["profile", "donor", "admin"]);
      await assert.rejects(db.query('INSERT INTO "DonorProfile" ("id","userId","createdById","updatedAt") VALUES ($1,$2,$3,now())', ["duplicate-profile", "donor", "admin"]));
      await db.query('INSERT INTO "Donation" ("id","idempotencyKey","requestFingerprint","donorProfileId","projectId","createdById","amountPaise","method","receivedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', ["donation", "request-key", "fingerprint", "profile", "project", "admin", "123456", "CASH"]);
      assert.equal((await db.query('SELECT "amountPaise"::text AS amount,"currency","status" FROM "Donation" WHERE "id"=$1', ["donation"])).rows[0].amount, "123456");
      await assert.rejects(db.query('INSERT INTO "Donation" ("id","idempotencyKey","requestFingerprint","donorProfileId","projectId","createdById","amountPaise","method","receivedAt") VALUES ($1,$2,$3,$4,$5,$6,0,$7,now())', ["zero", "zero-key", "zero", "profile", "project", "admin", "UPI"]));
      await assert.rejects(db.query('INSERT INTO "Donation" ("id","idempotencyKey","requestFingerprint","donorProfileId","projectId","createdById","amountPaise","method","receivedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', ["duplicate-key", "request-key", "same", "profile", "project", "admin", "100", "UPI"]));
      await assert.rejects(db.query('UPDATE "Donation" SET "status"=$1 WHERE "id"=$2', ["CONFIRMED", "donation"]));
      await assert.rejects(db.query('UPDATE "Donation" SET "currency"=$1 WHERE "id"=$2', ["USD", "donation"]));
      await db.query('INSERT INTO "DonationHistory" ("id","donationId","actorId","toStatus","snapshot") VALUES ($1,$2,$3,$4,$5)', ["event", "donation", "admin", "PENDING_VERIFICATION", { amountPaise: "123456" }]);
      await assert.rejects(db.query('UPDATE "DonationHistory" SET "snapshot"=$1 WHERE "id"=$2', [{ tampered: true }, "event"]));
      await assert.rejects(db.query('DELETE FROM "DonationHistory" WHERE "id"=$1', ["event"]));
      await assert.rejects(db.query('DELETE FROM "User" WHERE "id"=$1', ["donor"]));
      console.log("Phase 6 migration: isolated deploy, unique existing-account profile, unique intake idempotency key, exact INR paise, positive-only/pending-only gates, immutable history and retention FKs passed.");
    } finally { await db.end(); }
  } finally {
    if (created && /^trustfolio_phase6_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
