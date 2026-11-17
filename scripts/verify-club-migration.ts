/** Isolated local PostgreSQL migration and club-integrity check. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const parsed = new URL(base);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Club migration test accepts local PostgreSQL only");
  const schema = `trustfolio_phase2_test_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let created = false;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scopedUrl = new URL(base);
    scopedUrl.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: scopedUrl.toString() }, encoding: "utf8", timeout: 120_000,
    });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      const count = async (table: string) => Number((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
      assert.equal(await count("Club"), 0);
      assert.equal(await count("ClubMembership"), 0);
      assert.equal(await count("AccessGroup"), 8);
      for (const [id, email, role] of [["admin", "club-admin@example.test", "ADMIN"], ["member", "club-member@example.test", "PORTAL_USER"]]) {
        await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, email, "test-only", role]);
      }
      for (const [id, code] of [["club_a", "CLB-TESTA"], ["club_b", "CLB-TESTB"]]) {
        await db.query('INSERT INTO "Club" ("id","code","nameEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,now())', [id, code, `Test ${id}`, "admin"]);
      }
      await assert.rejects(db.query('INSERT INTO "Club" ("id","code","nameEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,now())', ["duplicate", "CLB-TESTA", "Duplicate", "admin"]));
      const club = await db.query('SELECT "status","publicationStatus" FROM "Club" WHERE "id"=$1', ["club_a"]);
      assert.equal(club.rows[0].status, "DRAFT");
      assert.equal(club.rows[0].publicationStatus, "DRAFT");
      await assert.rejects(db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","status","updatedAt") VALUES ($1,$2,$3,$4,now())', ["invalid_active", "club_a", "member", "ACTIVE"]));
      const consent = new Date();
      for (const [id, clubId] of [["membership_a", "club_a"], ["membership_b", "club_b"]]) {
        await db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","status","consentAt","consentVersion","adultAttestedAt","joinedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', [id, clubId, "member", "ACTIVE", consent, "club-membership-v1", consent, consent]);
      }
      assert.equal(await count("ClubMembership"), 2);
      await assert.rejects(db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","updatedAt") VALUES ($1,$2,$3,now())', ["duplicate_membership", "club_a", "member"]));
      await db.query('INSERT INTO "ClubMembershipHistory" ("id","membershipId","actorId","toStatus","toRole") VALUES ($1,$2,$3,$4,$5)', ["history_a", "membership_a", "admin", "ACTIVE", "MEMBER"]);
      await assert.rejects(db.query('UPDATE "ClubMembershipHistory" SET "reason"=$1 WHERE "id"=$2', ["changed", "history_a"]));
      await assert.rejects(db.query('DELETE FROM "ClubMembershipHistory" WHERE "id"=$1', ["history_a"]));
      console.log("Club migration: isolated schema applied; portal role, draft defaults, multi-club membership, unique pairs, consent guard and immutable history passed.");
    } finally { await db.end(); }
  } finally {
    if (created && /^trustfolio_phase2_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Club migration check failed");
  process.exitCode = 1;
});
