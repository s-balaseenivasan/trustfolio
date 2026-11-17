/** Headed Chrome volunteer/admin workflow on a disposable local PostgreSQL schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const port = 3190;
const origin = `http://127.0.0.1:${port}`;
async function poll(condition: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 50; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 500)); }
  throw new Error(message);
}
async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase3_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let created = false;
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema); scoped.searchParams.set("options", `-c search_path=${schema}`);
    const env = { ...process.env, DATABASE_URL: scoped.toString(), TRUSTFOLIO_TEST_SCHEMA: schema, AUTH_SECRET: "phase3-headed-browser-test-only", AUTH_TRUST_HOST: "true", NEXT_PUBLIC_SITE_URL: origin, SEED_DEMO: "false" };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      const password = "Phase3Test!2026";
      const hash = await bcrypt.hash(password, 12);
      for (const [id, email, role] of [["admin", "vol-admin@example.test", "ADMIN"], ["volunteer", "vol-member@example.test", "PORTAL_USER"], ["coordinator", "vol-coordinator@example.test", "PORTAL_USER"], ["outsider", "vol-outsider@example.test", "PORTAL_USER"], ["editor", "vol-editor@example.test", "EDITOR"]]) {
        await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, email, id, hash, role]);
      }
      await db.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Phase 3 Test Trust"]);
      await db.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Phase 3 Test Trust", "Isolated test", [], "[]"]);
      for (const [id, code, coordinatorId] of [["club-a", "CLB-VOLA", "coordinator"], ["club-b", "CLB-VOLB", null]]) {
        await db.query('INSERT INTO "Club" ("id","code","nameEn","status","coordinatorId","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [id, code, id, "ACTIVE", coordinatorId, "admin"]);
      }
      for (const [id, clubId, userId, role] of [["member", "club-a", "volunteer", "MEMBER"], ["coordinator-member", "club-a", "coordinator", "COORDINATOR"]]) {
        await db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","role","status","consentAt","consentVersion","adultAttestedAt","joinedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now(),$6,now(),now(),now())', [id, clubId, userId, role, "ACTIVE", "club-membership-v1"]);
      }
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let serverErrors = "";
      server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-4000); });
      server.stdout?.on("data", () => {});
      await poll(async () => { if (server?.exitCode !== null) throw new Error(`Server exited: ${server?.exitCode}\n${serverErrors}`); try { const response = await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(2000) }); return response.status === 200; } catch { return false; } }, "Next.js server did not start");
      browser = await chromium.launch({ channel: "chrome", headless: false });
      const volunteer = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const volunteerPage = await volunteer.newPage();
      await volunteerPage.goto(`${origin}/volunteer`);
      await volunteerPage.getByLabel("Email").fill("vol-member@example.test");
      await volunteerPage.getByLabel("Password").fill(password);
      await volunteerPage.getByRole("button", { name: "Sign in" }).click();
      await volunteerPage.getByRole("heading", { name: "Volunteer portal" }).waitFor({ timeout: 30000 });
      await volunteerPage.getByLabel("Skills (comma separated)").fill("Teaching, First aid");
      await volunteerPage.getByLabel("Interests (comma separated)").fill("Learning");
      await volunteerPage.getByLabel("Share my skills").check();
      await volunteerPage.getByLabel("I confirm I am an adult.").check();
      await volunteerPage.getByLabel("I consent to this data use.").check();
      await volunteerPage.getByRole("button", { name: "Create volunteer profile" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerProfile" WHERE "userId"=$1', ["volunteer"])).rows[0].n) === 1, "Profile not saved");
      assert.equal((await db.query('SELECT "shareSkillsWithClubs" FROM "VolunteerProfile" WHERE "userId"=$1', ["volunteer"])).rows[0].shareSkillsWithClubs, true);
      await volunteerPage.reload();
      await volunteerPage.getByLabel("Start time").fill("09:00");
      await volunteerPage.getByLabel("End time").fill("12:00");
      await volunteerPage.getByRole("button", { name: "Add time" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerAvailability"')).rows[0].n) === 1, "Availability not saved");
      await volunteerPage.locator('select[name="clubId"]').evaluate((select) => { const option = document.createElement("option"); option.value = "club-b"; option.textContent = "Unauthorized club"; select.append(option); });
      await volunteerPage.locator('select[name="clubId"]').selectOption("club-b");
      await volunteerPage.getByLabel("Activity").fill("Unauthorized activity");
      await volunteerPage.getByLabel("Date").fill(new Date().toISOString().slice(0, 10));
      await volunteerPage.getByRole("button", { name: "Submit attendance" }).click();
      await volunteerPage.getByText("An active approved club membership is required.").waitFor();
      assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerAttendance"')).rows[0].n), 0);
      await volunteerPage.locator('select[name="clubId"]').selectOption("club-a");
      await volunteerPage.getByLabel("Activity").fill("Reading session");
      await volunteerPage.getByLabel("Date").fill(new Date().toISOString().slice(0, 10));
      await volunteerPage.getByRole("button", { name: "Submit attendance" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerAttendance"')).rows[0].n) === 1, "Attendance not submitted");
      const attendanceId = String((await db.query('SELECT "id" FROM "VolunteerAttendance" LIMIT 1')).rows[0].id);
      const coordinator = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const coordinatorPage = await coordinator.newPage();
      await coordinatorPage.goto(`${origin}/club/club-a`);
      await coordinatorPage.getByLabel("Email").fill("vol-coordinator@example.test");
      await coordinatorPage.getByLabel("Password").fill(password);
      await coordinatorPage.getByRole("button", { name: "Sign in" }).click();
      await coordinatorPage.waitForURL(`${origin}/club`);
      await coordinatorPage.goto(`${origin}/club/club-a`);
      await coordinatorPage.getByText(/Skills: Teaching, First aid/).waitFor();
      await volunteerPage.getByLabel("Share my skills").uncheck();
      await volunteerPage.getByRole("button", { name: "Save profile" }).click();
      await poll(async () => (await db.query('SELECT "shareSkillsWithClubs" FROM "VolunteerProfile" WHERE "userId"=$1', ["volunteer"])).rows[0].shareSkillsWithClubs === false, "Skill privacy change not saved");
      await coordinatorPage.reload();
      assert.equal(await coordinatorPage.getByText(/Skills: Teaching, First aid/).count(), 0);
      await coordinatorPage.goto(`${origin}/club/club-b`);
      await coordinatorPage.getByText(/404|not found/i).first().waitFor();
      const admin = await browser.newContext({ viewport: { width: 1365, height: 850 } });
      const adminPage = await admin.newPage();
      await adminPage.goto(`${origin}/admin/volunteers`);
      await adminPage.getByLabel("Email").fill("vol-admin@example.test");
      await adminPage.getByLabel("Password").fill(password);
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await adminPage.getByRole("heading", { name: "Volunteers" }).waitFor({ timeout: 30000 });
      await adminPage.locator("#attendance-review").getByRole("button", { name: "Decide" }).click();
      await poll(async () => (await db.query('SELECT "status" FROM "VolunteerAttendance" WHERE "id"=$1', [attendanceId])).rows[0]?.status === "APPROVED", "Attendance approval missing");
      await volunteerPage.reload();
      await volunteerPage.getByLabel("Minutes").fill("90");
      await volunteerPage.getByLabel("Work done").fill("Led reading session");
      await volunteerPage.getByRole("button", { name: "Submit hours" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerServiceLog"')).rows[0].n) === 1, "Service hours not submitted");
      await adminPage.reload();
      await adminPage.locator("#service-review").getByRole("button", { name: "Decide" }).click();
      await poll(async () => (await db.query('SELECT "status" FROM "VolunteerServiceLog" LIMIT 1')).rows[0]?.status === "APPROVED", "Service approval missing");
      await volunteerPage.reload();
      await volunteerPage.getByText(/Confirmed total:/).getByText("1 h 30 min").waitFor();
      await adminPage.goto(`${origin}/admin/volunteers?serviceStatus=APPROVED#service-review`);
      await adminPage.locator("#service-review").getByLabel("Review reason").fill("Correcting recorded hours");
      await adminPage.locator("#service-review").getByRole("button", { name: "Decide" }).click();
      await poll(async () => (await db.query('SELECT "status" FROM "VolunteerServiceLog" LIMIT 1')).rows[0]?.status === "VOIDED", "Service correction missing");
      await volunteerPage.reload();
      await volunteerPage.getByText(/Confirmed total:/).getByText("0 h 0 min").waitFor();
      assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM "VolunteerServiceLogHistory"')).rows[0].n), 3);
      await db.query('INSERT INTO "VolunteerProfile" ("id","userId","consentVersion","consentAt","adultAttestedAt","updatedAt") VALUES ($1,$2,$3,now(),now(),now())', ["admin-profile", "admin", "volunteer-profile-2026-10-v1"]);
      await db.query('INSERT INTO "VolunteerAttendance" ("id","profileId","clubId","serviceDate","activityTitle","updatedAt") VALUES ($1,$2,$3,CURRENT_DATE,$4,now())', ["admin-attendance", "admin-profile", "club-a", "Admin work"]);
      await adminPage.goto(`${origin}/admin/volunteers#attendance-review`);
      await adminPage.locator("#attendance-review").getByRole("button", { name: "Decide" }).click();
      await adminPage.getByText("You cannot review your own record.").waitFor();
      assert.equal((await db.query('SELECT "status" FROM "VolunteerAttendance" WHERE "id"=$1', ["admin-attendance"])).rows[0].status, "SUBMITTED");
      const editor = await browser.newContext(); const editorPage = await editor.newPage();
      await editorPage.goto(`${origin}/admin/volunteers`);
      await editorPage.getByLabel("Email").fill("vol-editor@example.test"); await editorPage.getByLabel("Password").fill(password); await editorPage.getByRole("button", { name: "Sign in" }).click();
      await editorPage.waitForURL(`${origin}/admin`);
      const publicPage = await browser.newPage(); await publicPage.goto(`${origin}/en`);
      assert.equal((await publicPage.locator("body").innerText()).includes("vol-member@example.test"), false);
      console.log("Headed Chrome: consent/profile, availability, opted-in and revoked skills, cross-club and self-approval denial, attendance and hours review, corrected totals, editor denial, public privacy passed.");
    } finally { await db.end(); }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    if (created && /^trustfolio_phase3_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
