/** Deploy Phase 1–5 migrations to a disposable local schema and test draft gates. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase5_test_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base }); await root.connect(); let created = false;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: scoped.toString() }, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` }); await db.connect();
    try {
      await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', ["admin", "admin@phase5.test", "test-only", "ADMIN"]);
      await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","updatedAt") VALUES ($1,$2,$3,$4,now())', ["project", "phase5-project", "Test project", "Draft only"]);
      for (const id of ["request-a", "request-b"]) await db.query('INSERT INTO "DonationRequest" ("id","projectId","createdById","purposeEn","justificationEn","targetPaise","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [id, "project", "admin", id, "Test justification", id === "request-a" ? "1" : "200"]);
      assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM "DonationRequest" WHERE "projectId"=$1', ["project"])).rows[0].n), 2);
      await assert.rejects(db.query('INSERT INTO "DonationRequest" ("id","projectId","createdById","purposeEn","justificationEn","targetPaise","updatedAt") VALUES ($1,$2,$3,$4,$5,0,now())', ["zero", "project", "admin", "Zero", "Test justification"]));
      await assert.rejects(db.query('UPDATE "DonationRequest" SET "status"=$1 WHERE "id"=$2', ["SUBMITTED", "request-a"]));
      await db.query('INSERT INTO "DonationRequestHistory" ("id","requestId","actorId","toStatus","toVersion","snapshot") VALUES ($1,$2,$3,$4,$5,$6)', ["request-history", "request-a", "admin", "DRAFT", 0, {}]);
      await assert.rejects(db.query('DELETE FROM "DonationRequestHistory" WHERE "id"=$1', ["request-history"]));
      await db.query('INSERT INTO "DonationCampaign" ("id","requestId","slug","titleEn","summaryEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', ["campaign-a", "request-a", "campaign-a", "Campaign A", "Private draft", "admin"]);
      await assert.rejects(db.query('INSERT INTO "DonationCampaign" ("id","requestId","slug","titleEn","summaryEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', ["duplicate", "request-a", "duplicate", "Duplicate", "Private draft", "admin"]));
      await db.query('INSERT INTO "DonationCampaign" ("id","requestId","slug","titleEn","summaryEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', ["campaign-b", "request-b", "campaign-b", "Campaign B", "Private draft", "admin"]);
      await assert.rejects(db.query('UPDATE "DonationCampaign" SET "publicationStatus"=$1 WHERE "id"=$2', ["PUBLISHED", "campaign-a"]));
      await assert.rejects(db.query('UPDATE "DonationCampaign" SET "status"=$1 WHERE "id"=$2', ["ACTIVE", "campaign-a"]));
      await assert.rejects(db.query('UPDATE "DonationCampaign" SET "endsOn"=$1,"startsOn"=$2 WHERE "id"=$3', ["2026-11-01", "2026-12-01", "campaign-a"]));
      await db.query('INSERT INTO "DonationCampaignHistory" ("id","campaignId","actorId","toStatus","toVersion","snapshot") VALUES ($1,$2,$3,$4,$5,$6)', ["campaign-history", "campaign-a", "admin", "DRAFT", 0, {}]);
      await assert.rejects(db.query('UPDATE "DonationCampaignHistory" SET "reason"=$1 WHERE "id"=$2', ["tampered", "campaign-history"]));
      await db.query('INSERT INTO "Media" ("id","url","storageKey","filename","mimeType","size","visibility","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())', ["media", "private:test", "private/donation-request-evidence/test.pdf", "test.pdf", "application/pdf", 8, "PRIVATE"]);
      await db.query('INSERT INTO "DonationRequestEvidence" ("id","requestId","mediaId","title","createdById") VALUES ($1,$2,$3,$4,$5)', ["evidence", "request-a", "media", "Proof", "admin"]);
      await assert.rejects(db.query('DELETE FROM "Media" WHERE "id"=$1', ["media"]));
      console.log("Fundraising migration: isolated deployment, multiple requests per project, positive paise, one campaign per request, hard draft gates, immutable history and evidence FK protection passed.");
    } finally { await db.end(); }
  } finally {
    if (created && /^trustfolio_phase5_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
