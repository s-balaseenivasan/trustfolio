/**
 * Full club → volunteer → project/task workflow in headed-less Chrome on a disposable local schema.
 *
 * Everything that can be created through the product UI is created that way:
 * portal accounts, project content, club, memberships, volunteer profile/availability,
 * operational plan, club assignment, milestone, tasks, volunteer assignments,
 * dependency, private evidence, attendance, service hours and every review decision.
 *
 * Negative checks cover the publication boundary, role boundaries, cross-scope reads,
 * stale writes, invalid transitions, consent/approval gates, dependency cycles,
 * completion gates and private-file isolation.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

const port = 3193;
const origin = `http://127.0.0.1:${port}`;
const adminEmail = "workflow-admin@example.test";
const editorEmail = "workflow-editor@example.test";
const outsiderEmail = "workflow-outsider@example.test";
const coordinatorEmail = "workflow-coordinator@example.test";
const volunteerEmail = "workflow-volunteer@example.test";
const seededPassword = "WorkflowSeed!2026";
const projectTitle = "Workflow Community Library";
const projectSlug = "workflow-community-library";
const projectSummary = "A private workflow project for community library sessions.";
const clubName = "Workflow River Club";
const clubSummary = "A test club created through the club administration UI.";
const milestoneTitle = "Reading circles running weekly";
const taskOneTitle = "Run the Saturday reading circle";
const taskTwoTitle = "Prepare weekly attendance sheets";

const day = (offset = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

type CheckResult = { area: string; name: string; status: "PASS" | "FAIL" };
const results: CheckResult[] = [];

function printResults() {
  console.log("\n=== WORKFLOW VERIFICATION MATRIX ===");
  for (const result of results) console.log(`${result.status.padEnd(4)} | ${result.area.padEnd(14)} | ${result.name}`);
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total checks`);
}

async function check(area: string, name: string, work: () => Promise<void>) {
  try {
    await work();
    results.push({ area, name, status: "PASS" });
    console.log(`PASS  ${area.padEnd(14)} ${name}`);
  } catch (error) {
    results.push({ area, name, status: "FAIL" });
    console.error(`FAIL  ${area.padEnd(14)} ${name}`);
    throw error;
  }
}

async function poll(condition: () => Promise<boolean>, message: string, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (await condition()) return;
    } catch {
      // The dev-server action may still be in flight.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function login(page: Page, pathName: string, email: string, password: string) {
  await page.goto(`${origin}${pathName}`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 90_000 });
}

async function expectNotFound(page: Page, pathName: string) {
  const response = await page.goto(`${origin}${pathName}`);
  const visible = await page.getByText(/This page could not be found|404/i).first().isVisible().catch(() => false);
  assert.ok(response?.status() === 404 || visible, `Expected a 404 for ${pathName}, received HTTP ${response?.status()}`);
}

async function addPortalUser(page: Page, email: string, name: string, previousPassword: string | null) {
  const panel = page.locator("section[aria-labelledby='add-user']");
  await panel.locator("#new-email").fill(email);
  await panel.locator("#new-name").fill(name);
  await panel.locator('input[name="role"][value="PORTAL_USER"]').check();
  await panel.getByRole("button", { name: "Add user" }).click();
  const code = panel.locator("[role='status'] code");
  await poll(async () => {
    const text = (await code.textContent().catch(() => null))?.trim();
    return Boolean(text && text.length >= 8 && text !== previousPassword);
  }, `Temporary password was not shown for ${email}`);
  return (await code.textContent())!.trim();
}

function opsSection(page: Page, heading: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).first();
}

function taskRow(page: Page, title: string) {
  return page.locator("li").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first();
}

async function applyPlanStatus(page: Page, target: string) {
  const plan = opsSection(page, "Operational plan");
  await plan.locator('select[name="target"]').selectOption(target);
  await plan.getByRole("button", { name: "Apply status" }).click();
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const parsedBase = new URL(base);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsedBase.hostname)) throw new Error("This workflow test accepts local PostgreSQL only.");

  const schema = `trustfolio_phase4_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let createdSchema = false;
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  let db: Client | undefined;
  let serverErrors = "";
  const storedKeys: string[] = [];

  try {
    await root.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    const scoped = new URL(base);
    scoped.searchParams.set("schema", schema);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    const env = {
      ...process.env,
      DATABASE_URL: scoped.toString(),
      TRUSTFOLIO_TEST_SCHEMA: schema,
      AUTH_SECRET: "phase4-workflow-browser-test-only-secret",
      AUTH_TRUST_HOST: "true",
      NEXT_PUBLIC_SITE_URL: origin,
      SEED_DEMO: "false",
      STORAGE_DRIVER: "local",
    };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 180_000,
    });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);

    db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();

    const hash = await bcrypt.hash(seededPassword, 12);
    for (const [id, email, name, role] of [
      ["admin", adminEmail, "Workflow Admin", "ADMIN"],
      ["editor", editorEmail, "Workflow Editor", "EDITOR"],
      ["outsider", outsiderEmail, "Unrelated Portal User", "PORTAL_USER"],
    ] as const) {
      await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, email, name, hash, role]);
    }
    await db.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Workflow Test Trust"]);
    await db.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Workflow Test Trust", "Isolated workflow test", [], "[]"]);

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-8000); });
    server.stdout?.on("data", () => {});
    await poll(async () => {
      if (server?.exitCode !== null) throw new Error(`Next.js server exited with ${server?.exitCode}\n${serverErrors}`);
      try {
        return (await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(3000) })).status === 200;
      } catch {
        return false;
      }
    }, "Next.js workflow server did not start");

    browser = await chromium.launch({ channel: "chrome", headless: true });
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(90_000);
    await login(adminPage, "/admin/users", adminEmail, seededPassword);
    await adminPage.getByRole("heading", { name: "Users" }).waitFor();

    let coordinatorPassword = "";
    let volunteerPassword = "";
    let coordinatorId = "";
    let volunteerId = "";
    let projectId = "";
    let clubId = "";
    let assignmentId = "";
    let milestoneId = "";
    let taskOneId = "";
    let taskTwoId = "";
    let evidenceId = "";
    let attendanceOneId = "";
    let attendanceTwoId = "";
    let serviceLogId = "";
    let volunteerProfileId = "";
    let editorProfileId = "";

    await check("accounts", "Coordinator portal account created through /admin/users", async () => {
      coordinatorPassword = await addPortalUser(adminPage, coordinatorEmail, "Workflow Coordinator", null);
      const row = (await db!.query('SELECT "id","role" FROM "User" WHERE "email"=$1', [coordinatorEmail])).rows[0];
      assert.ok(row && row.role === "PORTAL_USER");
      coordinatorId = String(row.id);
    });

    await check("accounts", "Volunteer portal account created through /admin/users", async () => {
      volunteerPassword = await addPortalUser(adminPage, volunteerEmail, "Workflow Volunteer", coordinatorPassword);
      const row = (await db!.query('SELECT "id","role" FROM "User" WHERE "email"=$1', [volunteerEmail])).rows[0];
      assert.ok(row && row.role === "PORTAL_USER");
      volunteerId = String(row.id);
    });

    await check("accounts", "Admin list shows both accounts with Portal user role", async () => {
      await adminPage.goto(`${origin}/admin/users`);
      await adminPage.getByRole("heading", { name: "Users" }).waitFor();
      for (const email of [coordinatorEmail, volunteerEmail]) {
        await adminPage.getByText(email).waitFor();
        await adminPage.getByLabel(`Role of ${email}`).getByText("Portal user").waitFor();
      }
    });

    await check("project", "Public project content created through the admin UI as DRAFT", async () => {
      await adminPage.goto(`${origin}/admin/projects/new`);
      await adminPage.getByRole("heading", { name: "New project" }).waitFor();
      await adminPage.locator('input[name="titleEn"]').fill(projectTitle);
      await adminPage.locator('input[name="slug"]').fill(projectSlug);
      await adminPage.locator('textarea[name="summaryEn"]').fill(projectSummary);
      await adminPage.getByRole("button", { name: "Create project", exact: true }).click();
      await adminPage.waitForURL((url) => /^\/admin\/projects\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"), { timeout: 90_000 });
      await adminPage.getByRole("heading", { name: projectTitle }).waitFor();
      projectId = new URL(adminPage.url()).pathname.split("/").at(-1)!;
      const project = (await db!.query('SELECT "status","publishedAt","operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.status, "DRAFT");
      assert.equal(project.publishedAt, null);
      assert.equal(project.operationalStatus, "DRAFT");
    });

    await check("project", "Project operations list shows DRAFT publication and DRAFT operations", async () => {
      await adminPage.goto(`${origin}/admin/project-operations`);
      await adminPage.getByRole("heading", { name: "Project operations" }).waitFor();
      const row = adminPage.getByRole("row").filter({ hasText: projectTitle });
      await row.waitFor();
      const text = await row.innerText();
      assert.match(text, /DRAFT/);
    });

    await check("publication", "DRAFT project is absent from the English and Tamil public project lists", async () => {
      const publicContext = await browser!.newContext();
      const publicPage = await publicContext.newPage();
      for (const locale of ["en", "ta"]) {
        const response = await publicPage.goto(`${origin}/${locale}/projects`);
        assert.equal(response?.status(), 200);
        await publicPage.getByRole("main").waitFor();
        assert.equal((await publicPage.locator("body").innerText()).includes(projectTitle), false);
      }
      await expectNotFound(publicPage, `/en/projects/${projectSlug}`);
      await publicContext.close();
    });

    await adminPage.goto(`${origin}/admin/project-operations/${projectId}`);
    await adminPage.getByRole("heading", { name: projectTitle }).waitFor();
    await adminPage.getByRole("heading", { name: "Operational plan" }).waitFor();

    const stalePlanPage = await adminContext.newPage();
    stalePlanPage.setDefaultTimeout(90_000);
    await stalePlanPage.goto(`${origin}/admin/project-operations/${projectId}`);
    await opsSection(stalePlanPage, "Operational plan").waitFor();

    await check("project", "Task creation is disabled while the operational plan is DRAFT", async () => {
      assert.equal(await adminPage.getByRole("button", { name: "Create task" }).isDisabled(), true);
      const targets = await opsSection(adminPage, "Operational plan").locator('select[name="target"] option').allTextContents();
      assert.deepEqual(targets, ["PLANNED", "CANCELLED"]);
    });

    await check("project", "Plan saved with owner, manager, dates and private notes", async () => {
      const plan = opsSection(adminPage, "Operational plan");
      await plan.locator('select[name="ownerId"]').selectOption("admin");
      await plan.locator('select[name="managerId"]').selectOption(coordinatorId);
      await plan.locator('input[name="operationalStartDate"]').fill(day(0));
      await plan.locator('input[name="operationalEndDate"]').fill(day(60));
      await plan.locator('textarea[name="beneficiaryPlan"]').fill("Two weekly reading circles for 30 children.");
      await plan.locator('textarea[name="budgetPlanningNote"]').fill("Volunteer-led; only book and printing costs.");
      await plan.getByRole("button", { name: "Save plan" }).click();
      await plan.getByText("Project plan saved. Public project content is unchanged.").waitFor();
      await poll(async () => Number((await db!.query('SELECT "operationalVersion" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalVersion) === 1, "Plan version was not incremented");
      const project = (await db!.query('SELECT "ownerId","managerId","beneficiaryPlan","budgetPlanningNote" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.ownerId, "admin");
      assert.equal(project.managerId, coordinatorId);
      assert.match(project.beneficiaryPlan, /30 children/);
      assert.match(project.budgetPlanningNote, /printing/);
    });

    await check("project", "Stale plan page cannot overwrite a newer plan version", async () => {
      const stalePlan = opsSection(stalePlanPage, "Operational plan");
      await stalePlan.locator('textarea[name="beneficiaryPlan"]').fill("Stale overwrite attempt");
      await stalePlan.getByRole("button", { name: "Save plan" }).click();
      await stalePlan.getByText("The project plan changed. Reload it before saving.").waitFor();
      const project = (await db!.query('SELECT "beneficiaryPlan" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.match(project.beneficiaryPlan, /30 children/);
      await stalePlanPage.close();
    });

    await check("project", "Invalid DRAFT → ACTIVE transition is rejected", async () => {
      const plan = opsSection(adminPage, "Operational plan");
      const target = plan.locator('select[name="target"]');
      await target.evaluate((select) => {
        const option = document.createElement("option");
        option.value = "ACTIVE";
        option.textContent = "ACTIVE";
        select.append(option);
      });
      await target.selectOption("ACTIVE");
      await plan.getByRole("button", { name: "Apply status" }).click();
      await plan.getByText("That operational status change is unavailable.").waitFor();
      const project = (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.operationalStatus, "DRAFT");
    });

    await check("project", "DRAFT → PLANNED and PLANNED → ACTIVE succeed", async () => {
      await applyPlanStatus(adminPage, "PLANNED");
      await poll(async () => (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalStatus === "PLANNED", "Project did not become PLANNED");
      await adminPage.reload();
      await opsSection(adminPage, "Operational plan").waitFor();
      await applyPlanStatus(adminPage, "ACTIVE");
      await poll(async () => (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalStatus === "ACTIVE", "Project did not become ACTIVE");
      const project = (await db!.query('SELECT "status","operationalStatus","operationalVersion" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.status, "DRAFT");
      assert.equal(project.operationalStatus, "ACTIVE");
      assert.ok(Number(project.operationalVersion) >= 3);
    });

    await check("club", "Club created through the admin UI as DRAFT with a generated code", async () => {
      await adminPage.goto(`${origin}/admin/clubs`);
      await adminPage.getByRole("heading", { name: "Clubs" }).waitFor();
      await adminPage.locator("#club-name-en").fill(clubName);
      await adminPage.locator("#club-name-ta").fill("பணிப்பாய்வு ஆற்று மன்றம்");
      await adminPage.locator("#club-summary-en").fill(clubSummary);
      await adminPage.locator("#club-description-en").fill("Members meet weekly to run reading activities for neighbourhood children.");
      await adminPage.getByRole("button", { name: "Create draft club" }).click();
      await adminPage.getByText(/Draft club CLB-/).waitFor();
      const link = adminPage.getByRole("link", { name: "Open the new club" });
      await link.waitFor();
      const href = await link.getAttribute("href");
      clubId = href!.split("/").at(-1)!;
      await link.click();
      await adminPage.locator("#coordinator").waitFor();
      const club = (await db!.query('SELECT "code","status","publicationStatus" FROM "Club" WHERE "id"=$1', [clubId])).rows[0];
      assert.match(club.code, /^CLB-[0-9A-F]{12}$/);
      assert.equal(club.status, "DRAFT");
      assert.equal(club.publicationStatus, "DRAFT");
    });

    await check("club", "Invitation controls stay hidden until the club is active", async () => {
      assert.equal(await adminPage.getByLabel("Invite account").count(), 0);
    });

    await check("club", "Invalid DRAFT → SUSPENDED transition is rejected", async () => {
      await adminPage.locator("#club-status").evaluate((select) => {
        const option = document.createElement("option");
        option.value = "SUSPENDED";
        option.textContent = "Suspended";
        select.append(option);
      });
      await adminPage.locator("#club-status").selectOption("SUSPENDED");
      await adminPage.getByRole("button", { name: "Apply status" }).click();
      await adminPage.getByText("That club status change is not allowed.").waitFor();
      const club = (await db!.query('SELECT "status" FROM "Club" WHERE "id"=$1', [clubId])).rows[0];
      assert.equal(club.status, "DRAFT");
    });

    await check("club", "Club activates with an audit event", async () => {
      await adminPage.locator("#club-status").selectOption("ACTIVE");
      await adminPage.getByRole("button", { name: "Apply status" }).click();
      await adminPage.getByText("Club set to active.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "Club" WHERE "id"=$1', [clubId])).rows[0].status === "ACTIVE", "Club did not become active");
      const audit = (await db!.query('SELECT count(*)::int AS n FROM "AuditEvent" WHERE "eventType"=$1 AND "subjectId"=$2', ["CLUB_ACTIVE", clubId])).rows[0];
      assert.equal(Number(audit.n), 1);
    });

    await check("club", "Coordinator and volunteer are invited but remain unapproved", async () => {
      await adminPage.getByLabel("Invite account").selectOption(coordinatorId);
      await adminPage.getByRole("button", { name: "Invite", exact: true }).click();
      await adminPage.getByText("Existing account invited. Membership remains inactive until consent and approval.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ClubMembership" WHERE "clubId"=$1', [clubId])).rows[0].n) === 1, "Coordinator invitation was not stored");
      await adminPage.reload();
      await adminPage.getByRole("heading", { name: clubName }).waitFor();
      await adminPage.getByLabel("Invite account").selectOption(volunteerId);
      await adminPage.getByRole("button", { name: "Invite", exact: true }).click();
      await adminPage.getByText("Existing account invited. Membership remains inactive until consent and approval.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ClubMembership" WHERE "clubId"=$1', [clubId])).rows[0].n) === 2, "Volunteer invitation was not stored");
      const memberships = (await db!.query('SELECT "userId","role","status","consentAt","adultAttestedAt" FROM "ClubMembership" WHERE "clubId"=$1 ORDER BY "userId"', [clubId])).rows;
      assert.equal(memberships.length, 2);
      for (const membership of memberships) {
        assert.equal(membership.status, "INVITED");
        assert.equal(membership.role, "MEMBER");
        assert.equal(membership.consentAt, null);
        assert.equal(membership.adultAttestedAt, null);
      }
    });

    const coordinatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const coordinatorPage = await coordinatorContext.newPage();
    coordinatorPage.setDefaultTimeout(90_000);
    await login(coordinatorPage, "/club", coordinatorEmail, coordinatorPassword);
    await coordinatorPage.getByRole("heading", { name: "Club portal" }).waitFor();

    await check("membership", "Invited coordinator sees the invitation state but cannot open the club workspace", async () => {
      const membership = coordinatorPage.locator("#my-clubs article", { hasText: clubName });
      await membership.getByText("INVITED", { exact: true }).waitFor();
      await coordinatorPage.locator("#explore-clubs article", { hasText: clubName }).getByRole("button", { name: "Request membership" }).waitFor();
      await expectNotFound(coordinatorPage, `/club/${clubId}`);
      await coordinatorPage.goto(`${origin}/club`);
    });

    await check("membership", "Coordinator records adult declaration and data-use consent", async () => {
      const article = coordinatorPage.locator("#explore-clubs article", { hasText: clubName });
      await article.getByRole("checkbox", { name: /18 or older/ }).check();
      await article.getByRole("checkbox", { name: /agree that Trustfolio staff/ }).check();
      await article.getByRole("button", { name: "Request membership" }).click();
      await coordinatorPage.getByText("Your membership status: requested.").waitFor();
      const membership = (await db!.query('SELECT "status","consentVersion","consentAt","adultAttestedAt" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, coordinatorId])).rows[0];
      assert.equal(membership.status, "REQUESTED");
      assert.equal(membership.consentVersion, "club-membership-v1");
      assert.ok(membership.consentAt);
      assert.ok(membership.adultAttestedAt);
    });

    await check("authorization", "Portal user is redirected from admin routes to the club portal", async () => {
      await coordinatorPage.goto(`${origin}/admin`);
      await coordinatorPage.waitForURL(`${origin}/club`);
      await coordinatorPage.goto(`${origin}/admin/clubs`);
      await coordinatorPage.waitForURL(`${origin}/club`);
    });

    const volunteerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const volunteerPage = await volunteerContext.newPage();
    volunteerPage.setDefaultTimeout(90_000);
    await login(volunteerPage, "/volunteer", volunteerEmail, volunteerPassword);
    await volunteerPage.getByRole("heading", { name: "Volunteer portal" }).waitFor();

    await check("volunteer", "Volunteer creates a consented profile with skills and opt-in sharing", async () => {
      await volunteerPage.getByLabel("About your volunteering").fill("I enjoy reading with children and organising library sessions.");
      await volunteerPage.getByLabel("Skills (comma separated)").fill("Teaching, First aid");
      await volunteerPage.getByLabel("Interests (comma separated)").fill("Reading");
      await volunteerPage.getByLabel(/Share my skills/).check();
      await volunteerPage.getByLabel("I confirm I am an adult.").check();
      await volunteerPage.getByLabel("I consent to this data use.").check();
      await volunteerPage.getByRole("button", { name: "Create volunteer profile" }).click();
      await volunteerPage.getByText("Volunteer profile saved.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerProfile" WHERE "userId"=$1', [volunteerId])).rows[0].n) === 1, "Volunteer profile was not created");
      const profile = (await db!.query('SELECT "id","skills","interests","shareSkillsWithClubs","consentVersion" FROM "VolunteerProfile" WHERE "userId"=$1', [volunteerId])).rows[0];
      volunteerProfileId = String(profile.id);
      assert.deepEqual(profile.skills, ["Teaching", "First aid"]);
      assert.deepEqual(profile.interests, ["Reading"]);
      assert.equal(profile.shareSkillsWithClubs, true);
      assert.equal(profile.consentVersion, "volunteer-profile-2026-10-v1");
    });

    await check("volunteer", "Volunteer availability is saved and visible to admins", async () => {
      await volunteerPage.reload();
      await volunteerPage.locator("#availability select[name='weekday']").selectOption("1");
      await volunteerPage.getByLabel("Start time").fill("09:00");
      await volunteerPage.getByLabel("End time").fill("12:00");
      await volunteerPage.getByLabel("Time zone").fill("Asia/Kolkata");
      await volunteerPage.getByRole("button", { name: "Add time" }).click();
      await volunteerPage.getByText("Availability saved.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerAvailability" WHERE "profileId"=$1', [volunteerProfileId])).rows[0].n) === 1, "Availability was not saved");
      const slot = (await db!.query('SELECT "weekday","startMinute","endMinute","timeZone" FROM "VolunteerAvailability" WHERE "profileId"=$1', [volunteerProfileId])).rows[0];
      assert.deepEqual(slot, { weekday: 1, startMinute: 540, endMinute: 720, timeZone: "Asia/Kolkata" });
      await adminPage.goto(`${origin}/admin/volunteers?q=${encodeURIComponent(volunteerEmail)}`);
      await adminPage.getByText("Mon 09:00–12:00 Asia/Kolkata").waitFor();
    });

    await check("membership", "Attendance is blocked without an approved active membership", async () => {
      await volunteerPage.goto(`${origin}/volunteer`);
      await volunteerPage.getByText("You need an approved active club membership.").waitFor();
      assert.equal(await volunteerPage.locator("#attendance select[name='clubId']").count(), 0);
    });

    await check("membership", "Volunteer requests membership with consent", async () => {
      await volunteerPage.goto(`${origin}/club`);
      await volunteerPage.getByRole("heading", { name: "Club portal" }).waitFor();
      const article = volunteerPage.locator("#explore-clubs article", { hasText: clubName });
      await article.getByRole("checkbox", { name: /18 or older/ }).check();
      await article.getByRole("checkbox", { name: /agree that Trustfolio staff/ }).check();
      await article.getByRole("button", { name: "Request membership" }).click();
      await volunteerPage.getByText("Your membership status: requested.").waitFor();
      const membership = (await db!.query('SELECT "status","consentVersion" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, volunteerId])).rows[0];
      assert.equal(membership.status, "REQUESTED");
      assert.equal(membership.consentVersion, "club-membership-v1");
    });

    const outsiderContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const outsiderPage = await outsiderContext.newPage();
    outsiderPage.setDefaultTimeout(90_000);
    await login(outsiderPage, "/club", outsiderEmail, seededPassword);
    await outsiderPage.getByRole("heading", { name: "Club portal" }).waitFor();

    await check("membership", "Unrelated portal user can request membership but still has no club access", async () => {
      const article = outsiderPage.locator("#explore-clubs article", { hasText: clubName });
      await article.getByRole("checkbox", { name: /18 or older/ }).check();
      await article.getByRole("checkbox", { name: /agree that Trustfolio staff/ }).check();
      await article.getByRole("button", { name: "Request membership" }).click();
      await outsiderPage.getByText("Your membership status: requested.").waitFor();
      await expectNotFound(outsiderPage, `/club/${clubId}`);
      const membership = (await db!.query('SELECT "status" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, "outsider"])).rows[0];
      assert.equal(membership.status, "REQUESTED");
    });

    await adminPage.goto(`${origin}/admin/clubs/${clubId}`);
    await adminPage.getByRole("heading", { name: clubName }).waitFor();

    await check("membership", "Admin rejects the outsider request with a required reason", async () => {
      const outsiderRow = adminPage.getByRole("row").filter({ hasText: outsiderEmail });
      await outsiderRow.getByLabel(`Reason to reject ${outsiderEmail}`).fill("Not connected to this club");
      await outsiderRow.getByRole("button", { name: "Reject" }).click();
      await adminPage.getByText("Membership rejected.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, "outsider"])).rows[0].status === "REJECTED", "Outsider membership was not rejected");
      const history = (await db!.query('SELECT "toStatus","reason" FROM "ClubMembershipHistory" WHERE "membershipId"=(SELECT "id" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2) ORDER BY "createdAt"', [clubId, "outsider"])).rows;
      assert.equal(history.at(-1).toStatus, "REJECTED");
      assert.match(history.at(-1).reason, /Not connected/);
    });

    await check("membership", "Admin independently approves coordinator and volunteer memberships", async () => {
      for (const [email, userId] of [[coordinatorEmail, coordinatorId], [volunteerEmail, volunteerId]] as const) {
        const row = adminPage.getByRole("row").filter({ hasText: email });
        await row.getByRole("button", { name: "Approve" }).click();
        await adminPage.getByText("Membership approved.").waitFor();
        await poll(async () => (await db!.query('SELECT "status" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, userId])).rows[0].status === "ACTIVE", `${email} membership was not approved`);
        await adminPage.reload();
        await adminPage.getByRole("heading", { name: clubName }).waitFor();
      }
      const memberships = (await db!.query('SELECT "userId","role","status","joinedAt" FROM "ClubMembership" WHERE "clubId"=$1 AND "status"=$2 ORDER BY "userId"', [clubId, "ACTIVE"])).rows;
      assert.equal(memberships.length, 2);
      for (const membership of memberships) {
        assert.equal(membership.role, "MEMBER");
        assert.ok(membership.joinedAt);
      }
    });

    await check("club", "Coordinator appointment rejects an unapproved account", async () => {
      await adminPage.reload();
      await adminPage.getByRole("heading", { name: clubName }).waitFor();
      const coordinatorSelect = adminPage.locator("#coordinator");
      await coordinatorSelect.evaluate((select) => {
        const option = document.createElement("option");
        option.value = "outsider";
        option.textContent = "Injected outsider";
        select.append(option);
      });
      await coordinatorSelect.selectOption("outsider");
      await coordinatorSelect.evaluate((select) => { (select.closest("form") as HTMLFormElement).noValidate = true; });
      await adminPage.getByRole("button", { name: "Appoint" }).click();
      const feedback = adminPage.locator("form:has(#coordinator) + div");
      await poll(async () => Boolean((await feedback.innerText()).trim()), "Coordinator action did not return feedback", 30);
      assert.match(await feedback.innerText(), /Approve the account's membership before appointing a coordinator\./);
      const club = (await db!.query('SELECT "coordinatorId" FROM "Club" WHERE "id"=$1', [clubId])).rows[0];
      assert.equal(club.coordinatorId, null);
    });

    await check("club", "Approved coordinator is appointed and the membership role is updated", async () => {
      await adminPage.locator("#coordinator").selectOption(coordinatorId);
      await adminPage.getByRole("button", { name: "Appoint" }).click();
      await adminPage.getByText("Coordinator appointed from approved members.").waitFor();
      await poll(async () => (await db!.query('SELECT "coordinatorId" FROM "Club" WHERE "id"=$1', [clubId])).rows[0].coordinatorId === coordinatorId, "Coordinator was not appointed");
      const membership = (await db!.query('SELECT "role","status" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, coordinatorId])).rows[0];
      assert.equal(membership.role, "COORDINATOR");
      assert.equal(membership.status, "ACTIVE");
      const volunteer = (await db!.query('SELECT "role" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, volunteerId])).rows[0];
      assert.equal(volunteer.role, "MEMBER");
    });

    await check("coordinator", "Coordinator workspace shows approved members and the volunteer's opted-in skills", async () => {
      await coordinatorPage.goto(`${origin}/club`);
      await coordinatorPage.getByRole("heading", { name: "Club portal" }).waitFor();
      await coordinatorPage.locator("#my-clubs").getByText("Club coordinator").waitFor();
      await coordinatorPage.getByRole("link", { name: "Open club workspace" }).click();
      await coordinatorPage.waitForURL(`${origin}/club/${clubId}`);
      await coordinatorPage.getByRole("heading", { name: clubName }).waitFor();
      await coordinatorPage.locator("section[aria-labelledby='members-heading']").getByText("Workflow Volunteer").waitFor();
      await coordinatorPage.getByText(/Skills: Teaching, First aid/).waitFor();
      await coordinatorPage.getByText(/Interests: Reading/).waitFor();
    });

    await check("coordinator", "No project assignment exists before an admin grants one", async () => {
      await coordinatorPage.goto(`${origin}/club/projects`);
      await coordinatorPage.getByRole("heading", { name: "Assigned projects" }).waitFor();
      await coordinatorPage.getByText("No active project assignments.").waitFor();
    });

    await adminPage.goto(`${origin}/admin/project-operations/${projectId}`);
    await adminPage.getByRole("heading", { name: "Operational plan" }).waitFor();

    await check("project", "Admin assigns the active club to the project with both contribution permissions", async () => {
      const section = opsSection(adminPage, "Assigned clubs");
      await section.locator('select[name="clubId"]').selectOption(clubId);
      await section.locator('select[name="coordinatorId"]').selectOption(coordinatorId);
      await section.locator('textarea[name="responsibilities"]').fill("Coordinate the Saturday reading circle and report progress.");
      assert.equal(await section.getByRole("checkbox", { name: /Coordinator may view/ }).isChecked(), true);
      await section.getByRole("checkbox", { name: /Coordinator may record contribution/ }).check();
      await section.getByRole("button", { name: "Assign club" }).click();
      await adminPage.getByText("Club assigned to this project.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectClubAssignment" WHERE "projectId"=$1 AND "clubId"=$2', [projectId, clubId])).rows[0].n) === 1, "Club assignment was not created");
      const row = (await db!.query('SELECT "id","coordinatorId","status","canViewTasks","canReportContribution" FROM "ProjectClubAssignment" WHERE "projectId"=$1 AND "clubId"=$2', [projectId, clubId])).rows[0];
      assignmentId = String(row.id);
      assert.equal(row.coordinatorId, coordinatorId);
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.canViewTasks, true);
      assert.equal(row.canReportContribution, true);
      const history = (await db!.query('SELECT count(*)::int AS n FROM "ProjectClubAssignmentHistory" WHERE "assignmentId"=$1', [assignmentId])).rows[0];
      assert.equal(Number(history.n), 1);
    });

    await check("project", "The same club cannot be assigned twice", async () => {
      const section = opsSection(adminPage, "Assigned clubs");
      assert.equal(await section.locator('select[name="clubId"]').locator(`option[value="${clubId}"]`).count(), 0);
      assert.equal(await section.getByRole("button", { name: "Assign club" }).isDisabled(), true);
    });

    await check("project", "Milestone is created in PLANNED state", async () => {
      const section = opsSection(adminPage, "Milestones");
      await section.locator('input[name="titleEn"]').fill(milestoneTitle);
      await section.locator('input[name="dueDate"]').fill(day(14));
      await section.locator('input[name="description"]').fill("Run four Saturday sessions and record attendance.");
      await section.getByRole("button", { name: "Add milestone" }).click();
      await adminPage.getByText("Milestone added.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectMilestone" WHERE "projectId"=$1', [projectId])).rows[0].n) === 1, "Milestone was not created");
      const milestone = (await db!.query('SELECT "id","status" FROM "ProjectMilestone" WHERE "projectId"=$1', [projectId])).rows[0];
      milestoneId = String(milestone.id);
      assert.equal(milestone.status, "PLANNED");
    });

    await check("project", "Two tasks are created for the club assignment", async () => {
      const section = opsSection(adminPage, "Tasks and subtasks");
      assert.equal(await section.getByRole("button", { name: "Create task" }).isDisabled(), false);
      for (const [title, priority, description, dueOffset] of [
        [taskOneTitle, "HIGH", "Lead the session at the community hall, mark attendance and record the books read.", 7],
        [taskTwoTitle, "NORMAL", "Print one sheet per session and hand them to the club coordinator.", 5],
      ] as const) {
        await section.locator('select[name="clubAssignmentId"]').selectOption(assignmentId);
        await section.locator('select[name="milestoneId"]').selectOption(milestoneId);
        await section.locator('select[name="priority"]').selectOption(priority);
        await section.locator('input[name="titleEn"]').fill(title);
        await section.locator('textarea[name="description"]').fill(description);
        await section.locator('input[name="startDate"]').fill(day(0));
        await section.locator('input[name="dueDate"]').fill(day(dueOffset));
        await section.getByRole("button", { name: "Create task" }).click();
        await adminPage.getByText("Task created for this project and club.").waitFor();
        await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectTask" WHERE "projectId"=$1 AND "titleEn"=$2', [projectId, title])).rows[0].n) === 1, `Task ${title} was not created`);
      }
      taskOneId = String((await db!.query('SELECT "id" FROM "ProjectTask" WHERE "projectId"=$1 AND "titleEn"=$2', [projectId, taskOneTitle])).rows[0].id);
      taskTwoId = String((await db!.query('SELECT "id" FROM "ProjectTask" WHERE "projectId"=$1 AND "titleEn"=$2', [projectId, taskTwoTitle])).rows[0].id);
      const tasks = (await db!.query('SELECT "titleEn","status","progressPercent","milestoneId" FROM "ProjectTask" WHERE "projectId"=$1 ORDER BY "titleEn"', [projectId])).rows;
      assert.equal(tasks.length, 2);
      for (const task of tasks) {
        assert.equal(task.status, "TODO");
        assert.equal(task.progressPercent, 0);
        assert.equal(task.milestoneId, milestoneId);
      }
    });

    const editorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const editorPage = await editorContext.newPage();
    editorPage.setDefaultTimeout(90_000);
    await login(editorPage, "/volunteer", editorEmail, seededPassword);
    await editorPage.getByRole("heading", { name: "Volunteer portal" }).waitFor();

    await check("volunteer", "An editor can hold a volunteer profile without gaining club membership", async () => {
      await editorPage.getByLabel("Skills (comma separated)").fill("Translation");
      await editorPage.getByLabel("I confirm I am an adult.").check();
      await editorPage.getByLabel("I consent to this data use.").check();
      await editorPage.getByRole("button", { name: "Create volunteer profile" }).click();
      await editorPage.getByText("Volunteer profile saved.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerProfile" WHERE "userId"=$1', ["editor"])).rows[0].n) === 1, "Editor volunteer profile was not created");
      editorProfileId = String((await db!.query('SELECT "id" FROM "VolunteerProfile" WHERE "userId"=$1', ["editor"])).rows[0].id);
      const membership = (await db!.query('SELECT count(*)::int AS n FROM "ClubMembership" WHERE "userId"=$1', ["editor"])).rows[0];
      assert.equal(Number(membership.n), 0);
    });

    await adminPage.reload();
    await adminPage.getByRole("heading", { name: taskOneTitle }).waitFor();

    await check("project", "Task assignment rejects a volunteer profile that is not an approved club member", async () => {
      const row = taskRow(adminPage, taskTwoTitle);
      const select = row.locator('select[name="userId"]');
      await select.evaluate((element, id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = "Injected editor";
        element.append(option);
      }, "editor");
      await select.selectOption("editor");
      await row.getByRole("button", { name: "Assign", exact: true }).click();
      await row.getByText("Choose an approved member of an active club.").waitFor();
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "TaskAssignment" WHERE "taskId"=$1 AND "profileId"=$2', [taskTwoId, editorProfileId])).rows[0].n), 0);
    });

    await adminPage.reload();
    await adminPage.getByRole("heading", { name: taskOneTitle }).waitFor();

    await check("project", "Volunteer is assigned to both tasks", async () => {
      for (const taskId of [taskOneId, taskTwoId]) {
        const row = taskRow(adminPage, taskId === taskOneId ? taskOneTitle : taskTwoTitle);
        await row.locator('select[name="userId"]').selectOption(volunteerId);
        await row.getByRole("button", { name: "Assign", exact: true }).click();
        await adminPage.getByText("Volunteer assigned to task.").waitFor();
        await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "TaskAssignment" WHERE "taskId"=$1 AND "profileId"=$2 AND "active"=true AND "endedAt" IS NULL', [taskId, volunteerProfileId])).rows[0].n) === 1, `Volunteer was not assigned to ${taskId}`);
      }
      const assignments = (await db!.query('SELECT count(*)::int AS n FROM "TaskAssignment" WHERE "profileId"=$1 AND "active"=true', [volunteerProfileId])).rows[0];
      assert.equal(Number(assignments.n), 2);
    });

    await check("project", "A volunteer already assigned is no longer offered for that task", async () => {
      const row = taskRow(adminPage, taskOneTitle);
      assert.equal(await row.locator('select[name="userId"]').locator(`option[value="${volunteerId}"]`).count(), 0);
      assert.equal(await row.getByRole("button", { name: "Assign", exact: true }).isDisabled(), true);
    });

    await check("project", "Dependency task two → task one is added", async () => {
      const row = taskRow(adminPage, taskTwoTitle);
      await row.locator('select[name="predecessorId"]').selectOption(taskOneId);
      await row.getByRole("button", { name: "Add dependency" }).click();
      await adminPage.getByText("Dependency added.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectTaskDependency" WHERE "taskId"=$1 AND "predecessorId"=$2', [taskTwoId, taskOneId])).rows[0].n) === 1, "Dependency was not created");
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectTaskDependency" WHERE "taskId"=$1', [taskTwoId])).rows[0].n), 1);
    });

    await check("project", "A reverse dependency is rejected as a cycle", async () => {
      const row = taskRow(adminPage, taskOneTitle);
      await row.locator('select[name="predecessorId"]').selectOption(taskTwoId);
      await row.getByRole("button", { name: "Add dependency" }).click();
      await row.getByText("This dependency would create a cycle.").waitFor();
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectTaskDependency" WHERE "predecessorId"=$1', [taskOneId])).rows[0].n), 1);
    });

    await check("coordinator", "Revoking task visibility hides the club task list but keeps contribution access", async () => {
      const section = opsSection(adminPage, "Assigned clubs");
      const row = section.locator("li").filter({ hasText: clubName }).first();
      await row.getByRole("checkbox", { name: /Coordinator may view/ }).uncheck();
      await row.getByRole("button", { name: "Save assignment" }).click();
      await adminPage.getByText("Club assignment saved; history retained.").waitFor();
      await poll(async () => (await db!.query('SELECT "canViewTasks" FROM "ProjectClubAssignment" WHERE "id"=$1', [assignmentId])).rows[0].canViewTasks === false, "Task visibility flag was not revoked");
      await coordinatorPage.goto(`${origin}/club/projects/${assignmentId}`);
      await coordinatorPage.getByRole("heading", { name: "This club’s responsibilities" }).waitFor();
      assert.equal(await coordinatorPage.getByRole("heading", { name: "This club’s tasks" }).count(), 0);
      await coordinatorPage.getByRole("heading", { name: "Contribution history" }).waitFor();
      await adminPage.reload();
      const refreshed = opsSection(adminPage, "Assigned clubs").locator("li").filter({ hasText: clubName }).first();
      await refreshed.getByRole("checkbox", { name: /Coordinator may view/ }).check();
      await refreshed.getByRole("button", { name: "Save assignment" }).click();
      await adminPage.getByText("Club assignment saved; history retained.").waitFor();
      await poll(async () => (await db!.query('SELECT "canViewTasks" FROM "ProjectClubAssignment" WHERE "id"=$1', [assignmentId])).rows[0].canViewTasks === true, "Task visibility flag was not restored");
    });

    await check("project", "Pausing the project removes volunteer task access; resuming restores it", async () => {
      await adminPage.reload();
      await applyPlanStatus(adminPage, "PAUSED");
      await poll(async () => (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalStatus === "PAUSED", "Project did not pause");
      await volunteerPage.goto(`${origin}/volunteer/tasks`);
      await volunteerPage.getByText("No active project tasks are assigned to you.").waitFor();
      await expectNotFound(volunteerPage, `/volunteer/tasks/${taskOneId}`);
      await adminPage.reload();
      await applyPlanStatus(adminPage, "ACTIVE");
      await poll(async () => (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalStatus === "ACTIVE", "Project did not resume");
      await volunteerPage.goto(`${origin}/volunteer/tasks`);
      await volunteerPage.getByRole("link", { name: taskOneTitle }).waitFor();
      await volunteerPage.getByRole("link", { name: taskTwoTitle }).waitFor();
    });

    await check("coordinator", "Coordinator sees the assigned project and both club tasks", async () => {
      await coordinatorPage.goto(`${origin}/club/projects`);
      await coordinatorPage.getByRole("heading", { name: "Assigned projects" }).waitFor();
      await coordinatorPage.getByRole("link", { name: projectTitle }).click();
      await coordinatorPage.getByRole("heading", { name: projectTitle }).waitFor();
      await coordinatorPage.getByText("This club’s responsibilities").waitFor();
      await coordinatorPage.getByText("Coordinate the Saturday reading circle and report progress.").waitFor();
      await coordinatorPage.getByRole("heading", { name: "This club’s tasks" }).waitFor();
      await coordinatorPage.getByText(taskOneTitle).waitFor();
      await coordinatorPage.getByText(taskTwoTitle).waitFor();
    });

    await check("coordinator", "Coordinator records a private contribution note", async () => {
      const section = coordinatorPage.locator("section").filter({ has: coordinatorPage.getByRole("heading", { name: "Contribution history" }) });
      await section.getByLabel("Date of contribution").fill(day(0));
      await section.getByLabel("Contribution note").fill("Ran the first reading circle with 12 children and recorded attendance.");
      await section.getByRole("button", { name: "Record contribution" }).click();
      await coordinatorPage.getByText("Private contribution recorded.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectClubActivity" WHERE "assignmentId"=$1', [assignmentId])).rows[0].n) === 1, "Contribution was not recorded");
    });

    await check("coordinator", "A future-dated contribution is rejected", async () => {
      const section = coordinatorPage.locator("section").filter({ has: coordinatorPage.getByRole("heading", { name: "Contribution history" }) });
      const date = section.getByLabel("Date of contribution");
      await date.evaluate((element) => element.removeAttribute("max"));
      await date.fill(day(1));
      await section.getByLabel("Contribution note").fill("Future contribution attempt");
      await section.getByRole("button", { name: "Record contribution" }).click();
      await coordinatorPage.getByText("Contribution date cannot be in the future.").waitFor();
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectClubActivity" WHERE "assignmentId"=$1', [assignmentId])).rows[0].n), 1);
    });

    await check("volunteer", "Volunteer sees exactly the two assigned tasks", async () => {
      await volunteerPage.goto(`${origin}/volunteer/tasks`);
      await volunteerPage.getByRole("heading", { name: "My assigned project tasks" }).waitFor();
      assert.equal(await volunteerPage.getByRole("link", { name: taskOneTitle }).count(), 1);
      assert.equal(await volunteerPage.getByRole("link", { name: taskTwoTitle }).count(), 1);
      assert.equal(await volunteerPage.getByText("Collect donated library books").count(), 0);
    });

    await check("volunteer", "Dependent task stays disabled while its predecessor is open", async () => {
      await volunteerPage.goto(`${origin}/volunteer/tasks/${taskTwoId}`);
      await volunteerPage.getByRole("heading", { name: taskTwoTitle }).waitFor();
      await volunteerPage.getByText("Complete predecessor tasks before updating this task.").waitFor();
      await volunteerPage.getByText(`${taskOneTitle} · TODO`).waitFor();
      assert.equal(await volunteerPage.getByLabel("Progress (%)").isDisabled(), true);
      assert.equal(await volunteerPage.getByRole("button", { name: "Save task update" }).isDisabled(), true);
    });

    await check("volunteer", "Submitting below 100% is rejected without changing the task", async () => {
      await volunteerPage.goto(`${origin}/volunteer/tasks/${taskOneId}`);
      await volunteerPage.getByRole("heading", { name: taskOneTitle }).waitFor();
      await volunteerPage.getByLabel("Progress (%)").fill("50");
      await volunteerPage.getByLabel("Work update or completion evidence note").fill("Halfway through the reading list.");
      await volunteerPage.getByLabel(/Submit completed work/).check();
      await volunteerPage.getByRole("button", { name: "Save task update" }).click();
      await volunteerPage.getByText("Set progress to 100% before submitting completion.").waitFor();
      const task = (await db!.query('SELECT "status","progressPercent","version" FROM "ProjectTask" WHERE "id"=$1', [taskOneId])).rows[0];
      assert.equal(task.status, "TODO");
      assert.equal(task.progressPercent, 0);
      assert.equal(task.version, 1);
    });

    await check("evidence", "Volunteer uploads private completion evidence", async () => {
      await volunteerPage.getByLabel("Evidence file").setInputFiles({
        name: "reading-circle.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n% Workflow reading circle\n%%EOF\n"),
      });
      await volunteerPage.getByLabel("Title").fill("Reading circle completion note");
      await volunteerPage.locator('select[name="kind"]').selectOption("COMPLETION");
      const responsePromise = volunteerPage.waitForResponse((response) => response.url().includes(`/api/project-tasks/${taskOneId}/evidence`) && response.request().method() === "POST");
      await volunteerPage.getByRole("button", { name: "Upload privately" }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 201, await response.text());
      await volunteerPage.getByText("Private evidence uploaded.").waitFor();
      const evidence = (await db!.query('SELECT e."id",e."mediaId",m."visibility",m."storageKey" FROM "ProjectTaskEvidence" e JOIN "Media" m ON m."id"=e."mediaId" WHERE e."taskId"=$1', [taskOneId])).rows[0];
      assert.ok(evidence);
      evidenceId = String(evidence.id);
      assert.equal(evidence.visibility, "PRIVATE");
      assert.match(evidence.storageKey, /^private\/project-task-evidence\//);
      storedKeys.push(String(evidence.storageKey));
    });

    await check("evidence", "Private evidence is readable by the volunteer, coordinator and admin only", async () => {
      assert.equal((await volunteerPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 200);
      assert.equal((await coordinatorPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 200);
      assert.equal((await adminPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 200);
      assert.equal((await outsiderPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 404);
      assert.equal((await fetch(`${origin}/api/task-evidence/${evidenceId}/file`)).status, 401);
    });

    await check("volunteer", "Progress 40% is saved as IN_PROGRESS", async () => {
      await volunteerPage.getByLabel("Progress (%)").fill("40");
      await volunteerPage.getByLabel("Work update or completion evidence note").fill("Prepared the reading list and printed the attendance sheet.");
      await volunteerPage.getByLabel(/Submit completed work/).uncheck();
      await volunteerPage.getByRole("button", { name: "Save task update" }).click();
      await volunteerPage.getByText("Progress saved.").waitFor();
      await poll(async () => {
        const task = (await db!.query('SELECT "status","progressPercent" FROM "ProjectTask" WHERE "id"=$1', [taskOneId])).rows[0];
        return task.status === "IN_PROGRESS" && task.progressPercent === 40;
      }, "Progress update was not saved");
    });

    await check("volunteer", "Completion at 100% moves the task to SUBMITTED", async () => {
      await volunteerPage.getByLabel("Progress (%)").fill("100");
      await volunteerPage.getByLabel("Work update or completion evidence note").fill("Completed the first Saturday reading circle with 12 children.");
      await volunteerPage.getByLabel(/Submit completed work/).check();
      await volunteerPage.getByRole("button", { name: "Save task update" }).click();
      await volunteerPage.getByText("Completion submitted for trust-admin review.").waitFor();
      await poll(async () => {
        const task = (await db!.query('SELECT "status","progressPercent" FROM "ProjectTask" WHERE "id"=$1', [taskOneId])).rows[0];
        return task.status === "SUBMITTED" && task.progressPercent === 100;
      }, "Task submission was not saved");
    });

    await check("volunteer", "Submitted task becomes read-only and rejects late evidence", async () => {
      await volunteerPage.reload();
      await volunteerPage.getByRole("heading", { name: taskOneTitle }).waitFor();
      assert.equal(await volunteerPage.getByLabel("Progress (%)").isDisabled(), true);
      assert.equal(await volunteerPage.getByRole("button", { name: "Save task update" }).isDisabled(), true);
      assert.equal(await volunteerPage.getByLabel("Evidence file").count(), 0);
      const response = await volunteerPage.request.post(`${origin}/api/project-tasks/${taskOneId}/evidence`, {
        headers: { Origin: origin },
        multipart: {
          title: "Late evidence",
          kind: "COMPLETION",
          file: { name: "late.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nlate\n%%EOF\n") },
        },
      });
      assert.equal(response.status(), 409);
      assert.match(await response.text(), /cannot accept evidence/);
    });

    await check("volunteer", "Dependent task remains blocked while the predecessor is SUBMITTED", async () => {
      await volunteerPage.goto(`${origin}/volunteer/tasks/${taskTwoId}`);
      await volunteerPage.getByText("Complete predecessor tasks before updating this task.").waitFor();
      await volunteerPage.getByText(`${taskOneTitle} · SUBMITTED`).waitFor();
      assert.equal(await volunteerPage.getByLabel("Progress (%)").isDisabled(), true);
    });

    await check("review", "Returning a submission requires a substantive reason", async () => {
      await adminPage.goto(`${origin}/admin/project-operations/${projectId}`);
      await adminPage.getByRole("heading", { name: taskOneTitle }).waitFor();
      const row = taskRow(adminPage, taskOneTitle);
      await row.locator('select[name="decision"]').selectOption("RETURN");
      await row.getByLabel("Reason if returning").fill("No");
      await row.getByRole("button", { name: "Decide" }).click();
      await row.getByText("Give a reason when returning a task.").waitFor();
      const task = (await db!.query('SELECT "status" FROM "ProjectTask" WHERE "id"=$1', [taskOneId])).rows[0];
      assert.equal(task.status, "SUBMITTED");
    });

    await check("review", "Admin approves task one with a recorded reason", async () => {
      await adminPage.reload();
      await adminPage.getByRole("heading", { name: taskOneTitle }).waitFor();
      const row = taskRow(adminPage, taskOneTitle);
      await row.locator('select[name="decision"]').selectOption("APPROVE");
      await row.getByLabel("Reason if returning").fill("Completion note and private evidence match the task.");
      await row.getByRole("button", { name: "Decide" }).click();
      await adminPage.getByText("Task completion approved.").waitFor();
      await poll(async () => {
        const task = (await db!.query('SELECT "status","completedAt" FROM "ProjectTask" WHERE "id"=$1', [taskOneId])).rows[0];
        return task.status === "APPROVED" && Boolean(task.completedAt);
      }, "Task one was not approved");
    });

    await check("review", "Milestone cannot complete while its linked task is still open", async () => {
      const row = adminPage.locator("li").filter({ hasText: milestoneTitle }).first();
      await row.locator('select[name="target"]').selectOption("COMPLETED");
      await row.getByRole("button", { name: "Apply" }).click();
      await row.getByText("Resolve linked tasks before completing this milestone.").waitFor();
      const milestone = (await db!.query('SELECT "status" FROM "ProjectMilestone" WHERE "id"=$1', [milestoneId])).rows[0];
      assert.equal(milestone.status, "PLANNED");
    });

    await check("review", "Project cannot complete while tasks or milestones are open", async () => {
      await applyPlanStatus(adminPage, "COMPLETED");
      await opsSection(adminPage, "Operational plan").getByText("Resolve every task and milestone before completion.").waitFor();
      const project = (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.operationalStatus, "ACTIVE");
    });

    await check("volunteer", "Dependent task unlocks after predecessor approval and is submitted", async () => {
      await volunteerPage.goto(`${origin}/volunteer/tasks/${taskTwoId}`);
      await volunteerPage.getByRole("heading", { name: taskTwoTitle }).waitFor();
      await volunteerPage.getByText(`${taskOneTitle} · APPROVED`).waitFor();
      assert.equal(await volunteerPage.getByLabel("Progress (%)").isDisabled(), false);
      await volunteerPage.getByLabel("Progress (%)").fill("100");
      await volunteerPage.getByLabel("Work update or completion evidence note").fill("Printed and handed over attendance sheets for four sessions.");
      await volunteerPage.getByLabel(/Submit completed work/).check();
      await volunteerPage.getByRole("button", { name: "Save task update" }).click();
      await volunteerPage.getByText("Completion submitted for trust-admin review.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "ProjectTask" WHERE "id"=$1', [taskTwoId])).rows[0].status === "SUBMITTED", "Task two was not submitted");
    });

    await check("review", "Admin approves task two and completes the milestone and project", async () => {
      await adminPage.goto(`${origin}/admin/project-operations/${projectId}`);
      await adminPage.getByRole("heading", { name: taskTwoTitle }).waitFor();
      const task = taskRow(adminPage, taskTwoTitle);
      await task.locator('select[name="decision"]').selectOption("APPROVE");
      await task.getByRole("button", { name: "Decide" }).click();
      await adminPage.getByText("Task completion approved.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "ProjectTask" WHERE "id"=$1', [taskTwoId])).rows[0].status === "APPROVED", "Task two was not approved");
      await adminPage.reload();
      const milestone = adminPage.locator("li").filter({ hasText: milestoneTitle }).first();
      await milestone.locator('select[name="target"]').selectOption("COMPLETED");
      await milestone.getByRole("button", { name: "Apply" }).click();
      await adminPage.getByText("Milestone status changed.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "ProjectMilestone" WHERE "id"=$1', [milestoneId])).rows[0].status === "COMPLETED", "Milestone was not completed");
      await adminPage.reload();
      await applyPlanStatus(adminPage, "COMPLETED");
      await poll(async () => (await db!.query('SELECT "operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0].operationalStatus === "COMPLETED", "Project was not completed");
      assert.equal(await adminPage.getByRole("button", { name: "Create task" }).isDisabled(), true);
    });

    await check("project", "Completed project rejects further assignment edits", async () => {
      const row = opsSection(adminPage, "Assigned clubs").locator("li").filter({ hasText: clubName }).first();
      await row.locator('textarea[name="responsibilities"]').fill("Attempted change after completion.");
      await row.getByRole("button", { name: "Save assignment" }).click();
      await row.getByText("This project is closed.").waitFor();
      const assignment = (await db!.query('SELECT "responsibilities" FROM "ProjectClubAssignment" WHERE "id"=$1', [assignmentId])).rows[0];
      assert.match(assignment.responsibilities, /Coordinate the Saturday/);
    });

    await check("authorization", "Completed project disappears from coordinator and volunteer scopes", async () => {
      await coordinatorPage.goto(`${origin}/club/projects`);
      await coordinatorPage.getByText("No active project assignments.").waitFor();
      await expectNotFound(coordinatorPage, `/club/projects/${assignmentId}`);
      await volunteerPage.goto(`${origin}/volunteer/tasks`);
      await volunteerPage.getByText("No active project tasks are assigned to you.").waitFor();
      await expectNotFound(volunteerPage, `/volunteer/tasks/${taskOneId}`);
      const project = (await db!.query('SELECT "status","operationalStatus" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.status, "DRAFT");
      assert.equal(project.operationalStatus, "COMPLETED");
    });

    await check("attendance", "Volunteer submits attendance for the approved club", async () => {
      await volunteerPage.goto(`${origin}/volunteer`);
      await volunteerPage.getByRole("heading", { name: "Volunteer portal" }).waitFor();
      await volunteerPage.locator("#attendance select[name='clubId']").selectOption(clubId);
      await volunteerPage.locator("#attendance input[name='serviceDate']").fill(day(0));
      await volunteerPage.locator("#attendance input[name='activityTitle']").fill("Saturday reading circle");
      await volunteerPage.getByRole("button", { name: "Submit attendance" }).click();
      await volunteerPage.getByText("Attendance submitted for trust-admin review.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerAttendance" WHERE "profileId"=$1', [volunteerProfileId])).rows[0].n) === 1, "Attendance was not submitted");
      attendanceOneId = String((await db!.query('SELECT "id" FROM "VolunteerAttendance" WHERE "profileId"=$1 ORDER BY "createdAt"', [volunteerProfileId])).rows[0].id);
      assert.equal(await volunteerPage.getByRole("button", { name: "Submit hours" }).count(), 0);
    });

    await check("attendance", "Admin approves attendance before hours can be submitted", async () => {
      await adminPage.goto(`${origin}/admin/volunteers`);
      await adminPage.getByRole("heading", { name: "Volunteers" }).waitFor();
      const item = adminPage.locator("#attendance-review li").filter({ hasText: "Workflow Volunteer" });
      await item.getByRole("button", { name: "Decide" }).click();
      await item.getByText("Attendance approved.").waitFor();
      await poll(async () => (await db!.query('SELECT "status","reviewedById" FROM "VolunteerAttendance" WHERE "id"=$1', [attendanceOneId])).rows[0].status === "APPROVED", "Attendance was not approved");
      const attendance = (await db!.query('SELECT "reviewedById" FROM "VolunteerAttendance" WHERE "id"=$1', [attendanceOneId])).rows[0];
      assert.equal(attendance.reviewedById, "admin");
    });

    await check("hours", "Volunteer submits 90 minutes against approved attendance", async () => {
      await volunteerPage.reload();
      const hours = volunteerPage.locator("#hours");
      await hours.getByLabel("Approved attendance").selectOption(attendanceOneId);
      await hours.getByLabel("Minutes").fill("90");
      await hours.getByLabel("Work done").fill("Led a 90-minute reading circle and recorded attendance.");
      await hours.getByRole("button", { name: "Submit hours" }).click();
      await volunteerPage.getByText("Service hours submitted for trust-admin review.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerServiceLog" WHERE "profileId"=$1', [volunteerProfileId])).rows[0].n) === 1, "Service hours were not submitted");
      serviceLogId = String((await db!.query('SELECT "id" FROM "VolunteerServiceLog" WHERE "profileId"=$1', [volunteerProfileId])).rows[0].id);
    });

    await check("hours", "Admin approval makes only approved hours count", async () => {
      await adminPage.goto(`${origin}/admin/volunteers`);
      await adminPage.getByRole("heading", { name: "Volunteers" }).waitFor();
      const item = adminPage.locator("#service-review li").filter({ hasText: "Workflow Volunteer" });
      await item.getByRole("button", { name: "Decide" }).click();
      await item.getByText("Service hours approved.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "VolunteerServiceLog" WHERE "id"=$1', [serviceLogId])).rows[0].status === "APPROVED", "Service hours were not approved");
      await volunteerPage.reload();
      await volunteerPage.getByText(/Confirmed total:/).getByText("1 h 30 min").waitFor();
      assert.equal(await volunteerPage.locator("#hours").getByRole("button", { name: "Submit hours" }).count(), 0);
    });

    await check("attendance", "Rejected attendance never becomes a submittable hours record", async () => {
      await volunteerPage.goto(`${origin}/volunteer`);
      await volunteerPage.locator("#attendance select[name='clubId']").selectOption(clubId);
      await volunteerPage.locator("#attendance input[name='serviceDate']").fill(day(0));
      await volunteerPage.locator("#attendance input[name='activityTitle']").fill("Cancelled planning session");
      await volunteerPage.getByRole("button", { name: "Submit attendance" }).click();
      await volunteerPage.getByText("Attendance submitted for trust-admin review.").waitFor();
      await poll(async () => Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerAttendance" WHERE "profileId"=$1', [volunteerProfileId])).rows[0].n) === 2, "Second attendance was not submitted");
      attendanceTwoId = String((await db!.query('SELECT "id" FROM "VolunteerAttendance" WHERE "activityTitle"=$1', ["Cancelled planning session"])).rows[0].id);
      await adminPage.goto(`${origin}/admin/volunteers`);
      const item = adminPage.locator("#attendance-review li").filter({ hasText: "Cancelled planning session" });
      await item.getByLabel("Review decision").selectOption("REJECTED");
      await item.getByLabel("Review reason").fill("Session did not take place");
      await item.getByRole("button", { name: "Decide" }).click();
      await item.getByText("Attendance rejected.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "VolunteerAttendance" WHERE "id"=$1', [attendanceTwoId])).rows[0].status === "REJECTED", "Second attendance was not rejected");
      await volunteerPage.reload();
      await volunteerPage.getByText(/Confirmed total:/).getByText("1 h 30 min").waitFor();
      assert.equal(await volunteerPage.locator("#hours").getByRole("button", { name: "Submit hours" }).count(), 0);
    });

    await check("hours", "Admin void correction removes the hours from the confirmed total", async () => {
      await adminPage.goto(`${origin}/admin/volunteers?serviceStatus=APPROVED#service-review`);
      const item = adminPage.locator("#service-review li").filter({ hasText: "Workflow Volunteer" });
      await item.getByLabel("Review reason").fill("Correcting recorded hours");
      await item.getByRole("button", { name: "Decide" }).click();
      await item.getByText("Service hours voided.").waitFor();
      await poll(async () => (await db!.query('SELECT "status" FROM "VolunteerServiceLog" WHERE "id"=$1', [serviceLogId])).rows[0].status === "VOIDED", "Service hours were not voided");
      await volunteerPage.reload();
      await volunteerPage.getByText(/Confirmed total:/).getByText("0 h 0 min").waitFor();
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "VolunteerServiceLogHistory" WHERE "serviceLogId"=$1', [serviceLogId])).rows[0].n), 3);
    });

    await check("authorization", "Editor is confined to content administration", async () => {
      const allowed = await editorPage.goto(`${origin}/admin/projects`);
      assert.equal(allowed?.status(), 200);
      await editorPage.getByRole("heading", { name: "Projects" }).waitFor();
      for (const pathName of ["/admin/clubs", "/admin/project-operations", "/admin/volunteers", "/admin/users"]) {
        await editorPage.goto(`${origin}${pathName}`);
        await editorPage.waitForURL(`${origin}/admin`);
      }
    });

    await check("authorization", "Outsider cannot read club, assignment, task or evidence scopes", async () => {
      await outsiderPage.goto(`${origin}/club`);
      await outsiderPage.getByRole("heading", { name: "Club portal" }).waitFor();
      await expectNotFound(outsiderPage, `/club/${clubId}`);
      await outsiderPage.goto(`${origin}/club/projects`);
      await outsiderPage.getByText("No active project assignments.").waitFor();
      await expectNotFound(outsiderPage, `/club/projects/${assignmentId}`);
      await outsiderPage.goto(`${origin}/volunteer/tasks`);
      await outsiderPage.getByText("No active project tasks are assigned to you.").waitFor();
      await expectNotFound(outsiderPage, `/volunteer/tasks/${taskOneId}`);
      assert.equal((await outsiderPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 404);
      await outsiderPage.goto(`${origin}/admin`);
      await outsiderPage.waitForURL(`${origin}/club`);
    });

    await check("authorization", "Plain member is denied coordinator workspace and project reads", async () => {
      await volunteerPage.goto(`${origin}/club`);
      await volunteerPage.getByRole("heading", { name: "Club portal" }).waitFor();
      await volunteerPage.locator("#my-clubs").getByText("Membership record").waitFor();
      assert.equal(await volunteerPage.getByRole("link", { name: "Open club workspace" }).count(), 0);
      await expectNotFound(volunteerPage, `/club/${clubId}`);
      await expectNotFound(volunteerPage, `/club/projects/${assignmentId}`);
      assert.equal((await coordinatorPage.request.get(`${origin}/api/task-evidence/${evidenceId}/file`)).status(), 200);
      await expectNotFound(coordinatorPage, `/volunteer/tasks/${taskOneId}`);
    });

    await check("authorization", "Signed-out visitors are redirected and the evidence API returns 401", async () => {
      const anonContext = await browser!.newContext();
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`${origin}/club`);
      await anonPage.waitForURL((url) => url.pathname === "/admin/login");
      await anonPage.goto(`${origin}/volunteer/tasks/${taskOneId}`);
      await anonPage.waitForURL((url) => url.pathname === "/admin/login");
      await anonPage.goto(`${origin}/admin/project-operations`);
      await anonPage.waitForURL((url) => url.pathname === "/admin/login");
      assert.equal((await fetch(`${origin}/api/task-evidence/${evidenceId}/file`)).status, 401);
      await anonContext.close();
    });

    await check("publication", "DRAFT project remains absent from public routes after operational completion", async () => {
      const publicContext = await browser!.newContext();
      const publicPage = await publicContext.newPage();
      await publicPage.goto(`${origin}/en/projects`);
      assert.equal((await publicPage.locator("body").innerText()).includes(projectTitle), false);
      await expectNotFound(publicPage, `/en/projects/${projectSlug}`);
      await publicPage.goto(`${origin}/ta/projects`);
      assert.equal((await publicPage.locator("body").innerText()).includes(projectTitle), false);
      await publicContext.close();
    });

    await check("membership", "Ending the volunteer membership removes live portal access but retains records", async () => {
      await adminPage.goto(`${origin}/admin/clubs/${clubId}`);
      await adminPage.getByRole("heading", { name: clubName }).waitFor();
      const row = adminPage.getByRole("row").filter({ hasText: volunteerEmail });
      await row.getByLabel(`Reason to close ${volunteerEmail}`).fill("Workflow test membership close");
      await row.locator('select[name="target"]').selectOption("ENDED");
      await row.getByRole("button", { name: "Apply" }).click();
      await adminPage.getByText("Membership ended; history retained.").waitFor();
      await poll(async () => (await db!.query('SELECT "status","endedAt" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, volunteerId])).rows[0].status === "ENDED", "Volunteer membership was not ended");
      const membership = (await db!.query('SELECT "endedAt" FROM "ClubMembership" WHERE "clubId"=$1 AND "userId"=$2', [clubId, volunteerId])).rows[0];
      assert.ok(membership.endedAt);
      await volunteerPage.goto(`${origin}/volunteer/tasks`);
      await volunteerPage.getByText("No active project tasks are assigned to you.").waitFor();
      await expectNotFound(volunteerPage, `/volunteer/tasks/${taskOneId}`);
      await volunteerPage.goto(`${origin}/volunteer`);
      await volunteerPage.getByText("You need an approved active club membership.").waitFor();
      await coordinatorPage.goto(`${origin}/club/${clubId}`);
      await coordinatorPage.getByRole("heading", { name: clubName }).waitFor();
      assert.equal(await coordinatorPage.getByText("Workflow Volunteer").count(), 0);
    });

    await check("database", "Membership, club, project, task, evidence and review invariants hold", async () => {
      const club = (await db!.query('SELECT "status","publicationStatus","coordinatorId" FROM "Club" WHERE "id"=$1', [clubId])).rows[0];
      assert.equal(club.status, "ACTIVE");
      assert.equal(club.publicationStatus, "DRAFT");
      assert.equal(club.coordinatorId, coordinatorId);
      const memberships = (await db!.query('SELECT "userId","role","status" FROM "ClubMembership" WHERE "clubId"=$1 ORDER BY "userId"', [clubId])).rows;
      const byUser = new Map(memberships.map((membership) => [membership.userId, membership]));
      assert.deepEqual(byUser.get(coordinatorId), { userId: coordinatorId, role: "COORDINATOR", status: "ACTIVE" });
      assert.deepEqual(byUser.get(volunteerId), { userId: volunteerId, role: "MEMBER", status: "ENDED" });
      assert.deepEqual(byUser.get("outsider"), { userId: "outsider", role: "MEMBER", status: "REJECTED" });
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "ClubMembershipHistory" WHERE "membershipId" IN (SELECT "id" FROM "ClubMembership" WHERE "clubId"=$1)', [clubId])).rows[0].n) >= 8, true);

      const project = (await db!.query('SELECT "status","publishedAt","operationalStatus","operationalVersion","ownerId","managerId" FROM "Project" WHERE "id"=$1', [projectId])).rows[0];
      assert.equal(project.status, "DRAFT");
      assert.equal(project.publishedAt, null);
      assert.equal(project.operationalStatus, "COMPLETED");
      assert.ok(Number(project.operationalVersion) >= 6);
      assert.equal(project.ownerId, "admin");
      assert.equal(project.managerId, coordinatorId);

      const assignment = (await db!.query('SELECT "status","coordinatorId","canViewTasks","canReportContribution" FROM "ProjectClubAssignment" WHERE "id"=$1', [assignmentId])).rows[0];
      assert.deepEqual(assignment, { status: "ACTIVE", coordinatorId, canViewTasks: true, canReportContribution: true });
      const activityCount = Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectClubActivity" WHERE "assignmentId"=$1', [assignmentId])).rows[0].n);
      assert.equal(activityCount, 1);
      const milestone = (await db!.query('SELECT "status" FROM "ProjectMilestone" WHERE "id"=$1', [milestoneId])).rows[0];
      assert.equal(milestone.status, "COMPLETED");

      const tasks = (await db!.query('SELECT "id","status","progressPercent","completedAt" FROM "ProjectTask" WHERE "projectId"=$1 ORDER BY "titleEn"', [projectId])).rows;
      assert.equal(tasks.length, 2);
      for (const task of tasks) {
        assert.equal(task.status, "APPROVED");
        assert.equal(task.progressPercent, 100);
        assert.ok(task.completedAt);
      }
      const activeAssignments = (await db!.query('SELECT count(*)::int AS n FROM "TaskAssignment" WHERE "profileId"=$1 AND "active"=true AND "endedAt" IS NULL', [volunteerProfileId])).rows[0];
      assert.equal(Number(activeAssignments.n), 2);
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "TaskAssignment" WHERE "profileId"=$1', [editorProfileId])).rows[0].n), 0);
      assert.equal(Number((await db!.query('SELECT count(*)::int AS n FROM "ProjectTaskDependency" WHERE "taskId"=$1 AND "predecessorId"=$2', [taskTwoId, taskOneId])).rows[0].n), 1);

      const evidence = (await db!.query('SELECT e."id",m."visibility",m."storageKey" FROM "ProjectTaskEvidence" e JOIN "Media" m ON m."id"=e."mediaId" WHERE e."taskId"=$1', [taskOneId])).rows[0];
      assert.equal(evidence.visibility, "PRIVATE");
      assert.match(evidence.storageKey, /^private\/project-task-evidence\//);

      const attendance = (await db!.query('SELECT "status" FROM "VolunteerAttendance" WHERE "profileId"=$1 ORDER BY "createdAt"', [volunteerProfileId])).rows;
      assert.deepEqual(attendance.map((row) => row.status), ["APPROVED", "REJECTED"]);
      const service = (await db!.query('SELECT "status","minutes" FROM "VolunteerServiceLog" WHERE "profileId"=$1', [volunteerProfileId])).rows[0];
      assert.equal(service.status, "VOIDED");
      assert.equal(service.minutes, 90);
      const approvedMinutes = (await db!.query('SELECT COALESCE(SUM(s."minutes"),0)::int AS total FROM "VolunteerServiceLog" s JOIN "VolunteerAttendance" a ON a."id"=s."attendanceId" WHERE s."profileId"=$1 AND s."status"=$2 AND a."status"=$3', [volunteerProfileId, "APPROVED", "APPROVED"])).rows[0].total;
      assert.equal(Number(approvedMinutes), 0);
      assert.ok(Number((await db!.query('SELECT count(*)::int AS n FROM "NotificationOutbox" WHERE "recipientId"=$1', [volunteerId])).rows[0].n) >= 4);

      const expectedEvents = [
        "CLUB_DRAFT_CREATED", "CLUB_ACTIVE", "CLUB_MEMBERSHIP_INVITED", "CLUB_MEMBERSHIP_REQUESTED", "CLUB_MEMBERSHIP_REJECTED",
        "CLUB_MEMBERSHIP_ACTIVE", "CLUB_COORDINATOR_APPOINTED", "CLUB_MEMBERSHIP_ENDED",
        "PROJECT_PLAN_UPDATED", "PROJECT_OPERATIONAL_PLANNED", "PROJECT_OPERATIONAL_ACTIVE", "PROJECT_OPERATIONAL_PAUSED", "PROJECT_OPERATIONAL_COMPLETED",
        "PROJECT_CLUB_ASSIGNED", "PROJECT_MILESTONE_CREATED", "PROJECT_TASK_CREATED", "PROJECT_TASK_VOLUNTEER_ASSIGNED", "PROJECT_TASK_DEPENDENCY_ADDED",
        "PROJECT_CLUB_CONTRIBUTION_RECORDED", "PROJECT_TASK_PROGRESS", "PROJECT_TASK_SUBMITTED", "PROJECT_TASK_APPROVED", "PROJECT_MILESTONE_STATUS",
        "VOLUNTEER_PROFILE_CREATED", "VOLUNTEER_AVAILABILITY_ADDED", "VOLUNTEER_ATTENDANCE_SUBMITTED", "VOLUNTEER_ATTENDANCE_APPROVED",
        "VOLUNTEER_ATTENDANCE_REJECTED", "VOLUNTEER_HOURS_SUBMITTED", "VOLUNTEER_HOURS_APPROVED", "VOLUNTEER_HOURS_VOIDED",
      ];
      const auditRows = (await db!.query('SELECT "eventType", count(*)::int AS n FROM "AuditEvent" GROUP BY "eventType"')).rows;
      const audit = new Map(auditRows.map((row) => [row.eventType, Number(row.n)]));
      for (const eventType of expectedEvents) assert.ok((audit.get(eventType) ?? 0) > 0, `Missing audit event ${eventType}`);
    });

    console.log("\nAll UI-driven workflow and business-rule checks passed.");
    printResults();
  } finally {
    await browser?.close().catch(() => undefined);
    if (server && server.exitCode === null && server.pid) {
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    for (const key of storedKeys) {
      if (!key.startsWith("private/project-task-evidence/")) continue;
      const file = path.resolve(process.cwd(), "private-uploads", key.slice("private/".length));
      const privateRoot = path.resolve(process.cwd(), "private-uploads") + path.sep;
      if (file.startsWith(privateRoot)) await rm(file, { force: true }).catch(() => undefined);
    }
    if (db && createdSchema && /^trustfolio_phase4_ui_[a-f0-9]{32}$/.test(schema)) {
      await root.query(`DROP SCHEMA "${schema}" CASCADE`).catch((error: unknown) => console.error(`Schema cleanup failed: ${error instanceof Error ? error.message : error}`));
    }
    await db?.end().catch(() => undefined);
    await root.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("\nWorkflow verification failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  printResults();
  process.exitCode = 1;
});
