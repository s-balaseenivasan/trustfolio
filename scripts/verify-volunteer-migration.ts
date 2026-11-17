/** Apply every migration to a disposable local schema and exercise volunteer constraints. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase3_test_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let created = false;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: scoped.toString() }, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', ["volunteer", "volunteer@example.test", "test-only", "PORTAL_USER"]);
      await db.query('INSERT INTO "VolunteerProfile" ("id","userId","consentVersion","consentAt","adultAttestedAt","updatedAt") VALUES ($1,$2,$3,now(),now(),now())', ["profile", "volunteer", "test-consent"]);
      await assert.rejects(db.query('INSERT INTO "VolunteerProfile" ("id","userId","consentVersion","consentAt","adultAttestedAt","updatedAt") VALUES ($1,$2,$3,now(),now(),now())', ["duplicate", "volunteer", "test-consent"]));
      await assert.rejects(db.query('INSERT INTO "VolunteerAvailability" ("id","profileId","weekday","startMinute","endMinute","timeZone") VALUES ($1,$2,$3,$4,$5,$6)', ["bad-slot", "profile", 7, 600, 300, "Asia/Kolkata"]));
      await db.query('INSERT INTO "VolunteerAvailability" ("id","profileId","weekday","startMinute","endMinute","timeZone") VALUES ($1,$2,$3,$4,$5,$6)', ["slot", "profile", 1, 540, 720, "Asia/Kolkata"]);
      await assert.rejects(db.query('INSERT INTO "VolunteerAvailability" ("id","profileId","weekday","startMinute","endMinute","timeZone") VALUES ($1,$2,$3,$4,$5,$6)', ["duplicate-slot", "profile", 1, 540, 720, "Asia/Kolkata"]));
      await db.query('INSERT INTO "Club" ("id","code","nameEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,now())', ["club", "CLB-VOL-TEST", "Test club", "volunteer"]);
      await db.query('INSERT INTO "VolunteerAttendance" ("id","profileId","clubId","serviceDate","activityTitle","updatedAt") VALUES ($1,$2,$3,CURRENT_DATE,$4,now())', ["attendance", "profile", "club", "Test activity"]);
      await assert.rejects(db.query('INSERT INTO "VolunteerAttendance" ("id","profileId","clubId","serviceDate","activityTitle","updatedAt") VALUES ($1,$2,$3,CURRENT_DATE,$4,now())', ["duplicate-attendance", "profile", "club", "test activity"]));
      await assert.rejects(db.query('UPDATE "VolunteerAttendance" SET "status"=$1 WHERE "id"=$2', ["APPROVED", "attendance"]));
      await assert.rejects(db.query('INSERT INTO "VolunteerServiceLog" ("id","profileId","attendanceId","minutes","description","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["bad-hours", "profile", "attendance", 0, "Invalid hours"]));
      await db.query('INSERT INTO "VolunteerServiceLog" ("id","profileId","attendanceId","minutes","description","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["hours", "profile", "attendance", 90, "Test work"]);
      await assert.rejects(db.query('INSERT INTO "VolunteerServiceLog" ("id","profileId","attendanceId","minutes","description","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["duplicate-hours", "profile", "attendance", 90, "Test work"]));
      await db.query('INSERT INTO "VolunteerAttendanceHistory" ("id","attendanceId","actorId","toStatus","snapshot") VALUES ($1,$2,$3,$4,$5)', ["history", "attendance", "volunteer", "SUBMITTED", {}]);
      await assert.rejects(db.query('DELETE FROM "VolunteerAttendanceHistory" WHERE "id"=$1', ["history"]));
      await db.query('INSERT INTO "VolunteerServiceLogHistory" ("id","serviceLogId","actorId","toStatus","snapshot") VALUES ($1,$2,$3,$4,$5)', ["hours-history", "hours", "volunteer", "SUBMITTED", {}]);
      await assert.rejects(db.query('UPDATE "VolunteerServiceLogHistory" SET "reason"=$1 WHERE "id"=$2', ["changed", "hours-history"]));
      console.log("Volunteer migration: isolated schema, profile uniqueness, availability window, minute bounds, unique attendance hours and append-only history passed.");
    } finally { await db.end(); }
  } finally {
    if (created && /^trustfolio_phase3_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Volunteer migration check failed"); process.exitCode = 1; });
