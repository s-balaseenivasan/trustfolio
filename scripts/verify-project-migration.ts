/** Apply all migrations to a disposable local schema and verify Phase 4 constraints. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase4_test_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let created = false;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: scoped.toString() }, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      for (const id of ["admin", "coordinator", "volunteer"]) await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, `${id}@phase4.test`, "test-only", id === "admin" ? "ADMIN" : "PORTAL_USER"]);
      for (const id of ["one", "two"]) await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, `phase4-${id}`, id, "Private test"]);
      for (const id of ["a", "b"]) await db.query('INSERT INTO "Club" ("id","code","nameEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, `CLB-P4${id.toUpperCase()}`, id, "admin"]);
      for (const [id, projectId, clubId] of [["one-a", "one", "a"], ["one-b", "one", "b"], ["two-a", "two", "a"]]) await db.query('INSERT INTO "ProjectClubAssignment" ("id","projectId","clubId","coordinatorId","responsibilities","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [id, projectId, clubId, "coordinator", "Test", "admin"]);
      assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM "ProjectClubAssignment"')).rows[0].n), 3);
      await assert.rejects(db.query('INSERT INTO "ProjectClubAssignment" ("id","projectId","clubId","coordinatorId","responsibilities","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', ["duplicate", "one", "a", "coordinator", "Test", "admin"]));
      await assert.rejects(db.query('UPDATE "Project" SET "operationalStartDate"=$1,"operationalEndDate"=$2 WHERE "id"=$3', ["2026-12-01", "2026-11-01", "one"]));
      await db.query('INSERT INTO "ProjectClubAssignmentHistory" ("id","assignmentId","actorId","toStatus","snapshot") VALUES ($1,$2,$3,$4,$5)', ["history", "one-a", "admin", "ACTIVE", {}]);
      await assert.rejects(db.query('DELETE FROM "ProjectClubAssignmentHistory" WHERE "id"=$1', ["history"]));
      await db.query('INSERT INTO "ProjectTask" ("id","projectId","clubAssignmentId","titleEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["task", "one", "one-a", "Test task", "admin"]);
      await assert.rejects(db.query('UPDATE "ProjectTask" SET "progressPercent"=101 WHERE "id"=$1', ["task"]));
      await assert.rejects(db.query('UPDATE "ProjectTask" SET "status"=$1 WHERE "id"=$2', ["APPROVED", "task"]));
      await assert.rejects(db.query('INSERT INTO "ProjectTaskDependency" ("taskId","predecessorId") VALUES ($1,$2)', ["task", "task"]));
      await db.query('INSERT INTO "ProjectTaskHistory" ("id","taskId","actorId","toStatus","toProgress") VALUES ($1,$2,$3,$4,$5)', ["task-history", "task", "admin", "TODO", 0]);
      await assert.rejects(db.query('UPDATE "ProjectTaskHistory" SET "note"=$1 WHERE "id"=$2', ["tampered", "task-history"]));
      const project = (await db.query('SELECT "slug","status","operationalStatus" FROM "Project" WHERE "id"=$1', ["one"])).rows[0];
      assert.deepEqual(project, { slug: "phase4-one", status: "DRAFT", operationalStatus: "DRAFT" });
      console.log("Project migration: isolated deploy, many-to-many assignments, unique pairs, schedule and task constraints, immutable history, separate publication status passed.");
    } finally { await db.end(); }
  } finally {
    if (created && /^trustfolio_phase4_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Project migration check failed"); process.exitCode = 1; });
