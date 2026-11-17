/** Headed Chrome project authorization and task workflow on a disposable local schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "@playwright/test";
import { Client } from "pg";

const port = 3191;
const origin = `http://127.0.0.1:${port}`;
async function poll(condition: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 60; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 500)); }
  throw new Error(message);
}
async function login(page: Page, email: string, password: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
}
async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase4_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base }); await root.connect();
  let created = false; let server: ChildProcess | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined; const storedKeys: string[] = [];
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema); scoped.searchParams.set("options", `-c search_path=${schema}`);
    const env = { ...process.env, DATABASE_URL: scoped.toString(), TRUSTFOLIO_TEST_SCHEMA: schema, AUTH_SECRET: "phase4-headed-browser-test-only-secret", AUTH_TRUST_HOST: "true", NEXT_PUBLIC_SITE_URL: origin, SEED_DEMO: "false" };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` }); await db.connect();
    try {
      const password = "Phase4Test!2026"; const hash = await bcrypt.hash(password, 12);
      for (const [id, role] of [["admin", "ADMIN"], ["coordinator", "PORTAL_USER"], ["other", "PORTAL_USER"], ["volunteer", "PORTAL_USER"]]) await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, `${id}@phase4.test`, id, hash, role]);
      await db.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Phase 4 Test Trust"]);
      await db.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Phase 4 Test Trust", "Isolated test", [], "[]"]);
      await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","operationalStatus","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["project", "phase4-project", "Phase 4 Project", "Test project", "ACTIVE"]);
      for (const [id, coordinator] of [["a", "coordinator"], ["b", "other"]]) await db.query('INSERT INTO "Club" ("id","code","nameEn","status","coordinatorId","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [id, `CLB-P4${id.toUpperCase()}`, `Club ${id.toUpperCase()}`, "ACTIVE", coordinator, "admin"]);
      for (const [id, clubId, userId, role] of [["coord-member", "a", "coordinator", "COORDINATOR"], ["other-member", "b", "other", "COORDINATOR"], ["vol-member", "a", "volunteer", "MEMBER"]]) await db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","role","status","consentAt","consentVersion","adultAttestedAt","joinedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now(),$6,now(),now(),now())', [id, clubId, userId, role, "ACTIVE", "club-membership-v1"]);
      await db.query('INSERT INTO "VolunteerProfile" ("id","userId","consentVersion","consentAt","adultAttestedAt","updatedAt") VALUES ($1,$2,$3,now(),now(),now())', ["profile", "volunteer", "volunteer-profile-2026-10-v1"]);
      for (const [id, clubId, userId] of [["assignment-a", "a", "coordinator"], ["assignment-b", "b", "other"]]) await db.query('INSERT INTO "ProjectClubAssignment" ("id","projectId","clubId","coordinatorId","responsibilities","canViewTasks","canReportContribution","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,true,true,$6,now())', [id, "project", clubId, userId, `${clubId} work`, "admin"]);
      for (const [id, assignmentId] of [["task-a", "assignment-a"], ["task-b", "assignment-b"]]) await db.query('INSERT INTO "ProjectTask" ("id","projectId","clubAssignmentId","titleEn","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, "project", assignmentId, `Task ${id}`, "admin"]);
      await db.query('INSERT INTO "TaskAssignment" ("id","taskId","profileId") VALUES ($1,$2,$3)', ["task-volunteer", "task-a", "profile"]);
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let serverErrors = ""; server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-4000); }); server.stdout?.on("data", () => {});
      await poll(async () => { if (server?.exitCode !== null) throw new Error(`Server exited: ${server?.exitCode}\n${serverErrors}`); try { return (await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; } }, "Next.js server did not start");
      browser = await chromium.launch({ channel: "chrome", headless: false });
      const coordinator = await browser.newContext({ viewport: { width: 390, height: 844 } }); const coordinatorPage = await coordinator.newPage();
      await login(coordinatorPage, "coordinator@phase4.test", password, "/club/projects");
      await coordinatorPage.goto(`${origin}/club/projects`); await coordinatorPage.getByRole("link", { name: "Phase 4 Project" }).waitFor();
      await coordinatorPage.goto(`${origin}/club/projects/assignment-a`); await coordinatorPage.getByText("Task task-a").waitFor();
      assert.equal(await coordinatorPage.getByText("Task task-b").count(), 0);
      await coordinatorPage.goto(`${origin}/club/projects/assignment-b`); assert.equal(await coordinatorPage.getByText("This page could not be found.").count() > 0 || (await coordinatorPage.title()).includes("404"), true);
      const volunteer = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const volunteerPage = await volunteer.newPage();
      await login(volunteerPage, "volunteer@phase4.test", password, "/volunteer/tasks");
      await volunteerPage.goto(`${origin}/volunteer/tasks/task-a`); await volunteerPage.getByRole("heading", { name: "Task task-a" }).waitFor();
      await volunteerPage.getByLabel("Evidence file").setInputFiles({ name: "completion.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n") });
      await volunteerPage.getByLabel("Title").fill("Private task evidence");
      const uploadResponse = volunteerPage.waitForResponse((response) => response.url().includes("/api/project-tasks/task-a/evidence") && response.request().method() === "POST");
      await volunteerPage.getByRole("button", { name: "Upload privately" }).click();
      const uploadedResponse = await uploadResponse;
      if (uploadedResponse.status() !== 201) throw new Error(`Evidence upload HTTP ${uploadedResponse.status()}: ${(await uploadedResponse.text()).slice(0, 1200)}\n${serverErrors}`);
      const uploaded = (await db.query('SELECT e."id",m."storageKey" FROM "ProjectTaskEvidence" e JOIN "Media" m ON m."id"=e."mediaId" WHERE e."taskId"=$1', ["task-a"])).rows[0];
      assert.ok(uploaded); storedKeys.push(uploaded.storageKey);
      assert.equal((await volunteerPage.request.get(`${origin}/api/task-evidence/${uploaded.id}/file`)).status(), 200);
      assert.equal((await coordinatorPage.request.get(`${origin}/api/task-evidence/${uploaded.id}/file`)).status(), 200);
      const outsider = await browser.newContext(); const outsiderPage = await outsider.newPage(); await login(outsiderPage, "other@phase4.test", password, "/club/projects");
      assert.equal((await outsiderPage.request.get(`${origin}/api/task-evidence/${uploaded.id}/file`)).status(), 404);
      await volunteerPage.getByLabel("Progress (%)").fill("100"); await volunteerPage.getByLabel("Work update or completion evidence note").fill("Completed assigned work"); await volunteerPage.getByLabel(/Submit completed work/).check();
      await volunteerPage.getByRole("button", { name: "Save task update" }).click();
      await poll(async () => (await db.query('SELECT "status" FROM "ProjectTask" WHERE "id"=$1', ["task-a"])).rows[0].status === "SUBMITTED", "Task submission not saved");
      await volunteerPage.goto(`${origin}/volunteer/tasks/task-b`); assert.equal(await volunteerPage.getByText("This page could not be found.").count() > 0 || (await volunteerPage.title()).includes("404"), true);
      const admin = await browser.newContext(); const adminPage = await admin.newPage(); await login(adminPage, "admin@phase4.test", password, "/admin/project-operations/project");
      await adminPage.goto(`${origin}/admin/project-operations/project`); await adminPage.getByRole("heading", { name: "Task task-a" }).waitFor(); await adminPage.getByRole("button", { name: "Decide" }).click();
      await poll(async () => (await db.query('SELECT "status" FROM "ProjectTask" WHERE "id"=$1', ["task-a"])).rows[0].status === "APPROVED", "Task approval not saved");
      assert.equal((await db.query('SELECT "status" FROM "Project" WHERE "id"=$1', ["project"])).rows[0].status, "DRAFT");
      console.log("Headed Chrome: club and volunteer cross-scope denial, private evidence upload/read isolation, assigned task submission, independent admin review, publication status unchanged passed.");
    } finally { await db.end(); }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    for (const key of storedKeys) if (key.startsWith("private/project-task-evidence/")) await rm(path.resolve("private-uploads", key.slice("private/".length)), { force: true });
    if (created && /^trustfolio_phase4_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
