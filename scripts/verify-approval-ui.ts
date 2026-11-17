/** Headed Chrome smoke test against a disposable local PostgreSQL schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const port = 3187;
const origin = `http://127.0.0.1:${port}`;

async function waitForServer(server: ChildProcess) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next.js server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/admin/login`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      if (response.status === 200 || response.status === 307) return;
    } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Next.js server did not become ready within 90 seconds");
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const parsed = new URL(base);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Headed approval test accepts local PostgreSQL only");
  const schema = `trustfolio_phase1_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base });
  await root.connect();
  let created = false;
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await root.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scopedUrl = new URL(base);
    scopedUrl.searchParams.set("schema", schema);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    const testEnv = {
      ...process.env,
      DATABASE_URL: scopedUrl.toString(),
      AUTH_SECRET: "phase1-browser-test-secret-2026-only",
      AUTH_TRUST_HOST: "true",
      NEXT_PUBLIC_SITE_URL: origin,
      SEED_DEMO: "false",
      STORAGE_DRIVER: "local",
      TRUSTFOLIO_TEST_SCHEMA: schema,
    };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: process.cwd(), env: testEnv, encoding: "utf8", timeout: 120_000,
    });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const connection = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await connection.connect();
    try {
      const adminHash = await bcrypt.hash("Phase1Admin!2026", 12);
      const editorHash = await bcrypt.hash("Phase1Editor!2026", 12);
      await connection.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now()),($6,$7,$8,$9,$10,now())', [
        "phase1-admin", "phase1-admin@example.test", "Phase 1 Admin", adminHash, "ADMIN",
        "phase1-editor", "phase1-editor@example.test", "Phase 1 Editor", editorHash, "EDITOR",
      ]);
      await connection.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Phase 1 Test Trust"]);
      await connection.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Phase 1 Test Trust", "Isolated test content", [], "[]"]);
    } finally { await connection.end(); }
    const adapterCheck = new PrismaClient({ adapter: new PrismaPg({ connectionString: scopedUrl.toString() }, { schema }) });
    try {
      assert.equal(await adapterCheck.user.count(), 2, "Prisma adapter must use the isolated schema");
    } finally { await adapterCheck.$disconnect(); }
    console.log("Isolated schema and Prisma adapter ready.");

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(), env: testEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let serverErrors = "";
    let serverOutput = "";
    server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-3000); });
    server.stdout?.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-3000); });
    try { await waitForServer(server); } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${serverErrors.slice(-1200)}`); }
    console.log("Next.js test server ready.");

    browser = await chromium.launch({ channel: "chrome", headless: false });
    console.log("Headed Chrome launched.");
    const adminContext = await browser.newContext({ viewport: { width: 1365, height: 850 } });
    const page = await adminContext.newPage();
    await page.goto(`${origin}/admin/approvals`);
    await page.getByLabel("Email").fill("phase1-admin@example.test");
    await page.getByLabel("Password").fill("Phase1Admin!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.getByRole("heading", { name: "Approval framework" }).waitFor({ timeout: 30000 });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      console.error(JSON.stringify({ step: "admin-login", url: page.url(), body: body.slice(0, 500), serverOutput: serverOutput.slice(-800), serverErrors: serverErrors.slice(-800) }));
      throw error;
    }
    await page.getByText("Draft engine only").waitFor();
    const policyForm = page.locator("form:has(#policy-key)");
    await policyForm.locator("#policy-key").fill("TEST_APPROVAL");
    await policyForm.locator("#policy-name").fill("Test approval");
    await policyForm.locator("#min-amount").fill("100.00");
    await policyForm.locator("#max-amount").fill("1000.00");
    await policyForm.locator("#currency").fill("INR");
    await policyForm.getByRole("group", { name: "Groups for step 1" }).getByLabel("Finance Manager").check();
    await policyForm.getByRole("button", { name: "Add sequential step" }).click();
    await policyForm.getByRole("group", { name: "Groups for step 2" }).getByLabel("Trustee Approver").check();
    await policyForm.getByRole("button", { name: "Save draft policy version" }).click();
    await page.getByText(/Draft policy TEST_APPROVAL v1 saved/).waitFor();
    const simulation = page.locator('form:has(input[name="policyId"])');
    await simulation.locator('input[name="amount"]').fill("500");
    await simulation.locator('input[name="currency"]').fill("INR");
    await simulation.getByRole("button", { name: "Simulate" }).click();
    await page.getByText(/Matches draft v1/).waitFor();
    console.log("Admin draft builder and simulation passed.");
    await page.goto(`${origin}/en`);
    await page.getByRole("main").waitFor();

    const editorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const editorPage = await editorContext.newPage();
    await editorPage.goto(`${origin}/admin/login`);
    await editorPage.getByLabel("Email").fill("phase1-editor@example.test");
    await editorPage.getByLabel("Password").fill("Phase1Editor!2026");
    await editorPage.getByRole("button", { name: "Sign in" }).click();
    await editorPage.waitForURL(`${origin}/admin`);
    await editorPage.goto(`${origin}/admin/approvals`);
    await editorPage.waitForURL(`${origin}/admin`);
    assert.equal(await editorPage.getByRole("heading", { name: "Approval framework" }).count(), 0);
    const verify = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await verify.connect();
    try {
      const result = await verify.query('SELECT (SELECT count(*) FROM "ApprovalPolicy" WHERE status=\'ACTIVE\') AS active, (SELECT count(*) FROM "AccessGroupMembership") AS members, (SELECT count(*) FROM "ApprovalInstance") AS instances');
      assert.equal(Number(result.rows[0].active), 0);
      assert.equal(Number(result.rows[0].members), 0);
      assert.equal(Number(result.rows[0].instances), 0);
    } finally { await verify.end(); }
    console.log("Headed Chrome: admin draft builder/simulation, public page, editor denial, and zero live authority passed.");
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null && server.pid) {
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    }
    if (created && /^trustfolio_phase1_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Headed approval test failed");
  process.exitCode = 1;
});
