/** Isolated local PostgreSQL migration and integrity check; never touches the public schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const parsed = new URL(base);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("This test accepts local PostgreSQL only");
  const schema = `trustfolio_phase1_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const testUrl = new URL(base);
    testUrl.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      encoding: "utf8",
      timeout: 120_000,
    });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const connection = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await connection.connect();
    try {
      const count = async (table: string) => Number((await connection.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
      assert.equal(await count("AccessGroup"), 8);
      assert.equal(await count("AccessGroupMembership"), 0);
      assert.equal(await count("ApprovalPolicy"), 0);
      const userA = `phase1_user_a_${schema}`;
      const userB = `phase1_user_b_${schema}`;
      for (const [id, email] of [[userA, "a@example.test"], [userB, "b@example.test"]]) {
        await connection.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, email, "test-only", "EDITOR"]);
      }
      await connection.query('INSERT INTO "ApprovalPolicy" ("id","key","version","name","subjectType","definition","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())', ["test_policy", "TEST_POLICY", 1, "Test policy", "EXPENSE", "{}", userA]);
      await assert.rejects(connection.query('UPDATE "ApprovalPolicy" SET "definition"=$1 WHERE "id"=$2', [JSON.stringify({ changed: true }), "test_policy"]));
      await connection.query('INSERT INTO "ApprovalInstance" ("id","policyId","policyVersion","policySnapshot","subjectType","subjectId","makerId","scopeType","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', ["test_instance", "test_policy", 1, "{}", "EXPENSE", "test_expense", userA, "GLOBAL"]);
      await assert.rejects(connection.query('INSERT INTO "ApprovalInstance" ("id","policyId","policyVersion","policySnapshot","subjectType","subjectId","makerId","scopeType","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', ["duplicate_instance", "test_policy", 1, "{}", "EXPENSE", "test_expense", userA, "GLOBAL"]));
      await assert.rejects(connection.query('INSERT INTO "ApprovalInstance" ("id","policyId","policyVersion","policySnapshot","subjectType","subjectId","makerId","scopeType","scopeId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', ["invalid_scope", "test_policy", 1, "{}", "EXPENSE", "another_expense", userA, "CLUB", ""]));
      await connection.query('INSERT INTO "ApprovalDecision" ("id","instanceId","stepIndex","actorId","kind","policyVersion") VALUES ($1,$2,$3,$4,$5,$6)', ["test_decision", "test_instance", 0, userB, "APPROVE", 1]);
      await assert.rejects(connection.query('UPDATE "ApprovalDecision" SET "reason"=$1 WHERE "id"=$2', ["changed", "test_decision"]));
      await assert.rejects(connection.query('DELETE FROM "ApprovalDecision" WHERE "id"=$1', ["test_decision"]));
      await assert.rejects(connection.query('INSERT INTO "ApprovalDecision" ("id","instanceId","stepIndex","actorId","kind","policyVersion") VALUES ($1,$2,$3,$4,$5,$6)', ["duplicate", "test_instance", 0, userB, "APPROVE", 1]));
      await connection.query('INSERT INTO "AuditEvent" ("id","actorId","eventType","subjectType","correlationId") VALUES ($1,$2,$3,$4,$5)', ["test_audit", userA, "TEST", "ApprovalInstance", "test-correlation"]);
      await assert.rejects(connection.query('DELETE FROM "AuditEvent" WHERE "id"=$1', ["test_audit"]));
      await assert.rejects(connection.query('UPDATE "ApprovalInstance" SET "policySnapshot"=$1 WHERE "id"=$2', [JSON.stringify({ changed: true }), "test_instance"]));
      const first = await connection.query('UPDATE "ApprovalInstance" SET "version"="version"+1 WHERE "id"=$1 AND "version"=0', ["test_instance"]);
      const stale = await connection.query('UPDATE "ApprovalInstance" SET "version"="version"+1 WHERE "id"=$1 AND "version"=0', ["test_instance"]);
      assert.equal(first.rowCount, 1);
      assert.equal(stale.rowCount, 0);
      console.log("Approval migration: isolated schema applied; proposed groups only; immutable history, duplicate decision, and stale-version checks passed.");
    } finally {
      await connection.end();
    }
  } finally {
    if (created && /^trustfolio_phase1_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Approval migration check failed");
  process.exitCode = 1;
});
