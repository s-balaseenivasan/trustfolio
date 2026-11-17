/** Headed Chrome fundraising draft workflow on a disposable local PostgreSQL schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "@playwright/test";
import { Client } from "pg";

const port = 3192;
const origin = `http://127.0.0.1:${port}`;
async function poll(condition: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 60; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 500)); }
  throw new Error(message);
}
async function login(page: Page, email: string, password: string, route: string) {
  await page.goto(`${origin}${route}`);
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase5_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base }); await root.connect();
  let created = false; let server: ChildProcess | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined; const storedKeys: string[] = [];
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema); scoped.searchParams.set("options", `-c search_path=${schema}`);
    const env = { ...process.env, DATABASE_URL: scoped.toString(), TRUSTFOLIO_TEST_SCHEMA: schema, AUTH_SECRET: "phase5-headed-browser-test-only-secret", AUTH_TRUST_HOST: "true", NEXT_PUBLIC_SITE_URL: origin, SEED_DEMO: "false" };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` }); await db.connect();
    try {
      const password = "Phase5Test!2026"; const hash = await bcrypt.hash(password, 12);
      for (const [id, role] of [["admin", "ADMIN"], ["editor", "EDITOR"]]) await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, `${id}@phase5.test`, id, hash, role]);
      await db.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Phase 5 Test Trust"]);
      await db.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Phase 5 Test Trust", "Isolated test", [], "[]"]);
      await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","updatedAt") VALUES ($1,$2,$3,$4,now())', ["project", "phase5-project", "Phase 5 Project", "Test project"]);
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let serverErrors = ""; server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-4000); }); server.stdout?.on("data", () => {});
      await poll(async () => { if (server?.exitCode !== null) throw new Error(`Server exited: ${server?.exitCode}\n${serverErrors}`); try { return (await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; } }, "Next.js server did not start");
      browser = await chromium.launch({ channel: "chrome", headless: false });
      const admin = await browser.newContext({ viewport: { width: 390, height: 844 } }); const adminPage = await admin.newPage();
      await login(adminPage, "admin@phase5.test", password, "/admin/fundraising/project");
      await adminPage.goto(`${origin}/admin/fundraising/project`);
      await adminPage.getByLabel("Purpose (English)").fill("School kits");
      await adminPage.getByLabel("Justification (English)").fill("Purchase new learning kits for children");
      await adminPage.getByLabel("Target (INR)").fill("1234.56");
      await adminPage.getByRole("button", { name: "Create request draft" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "DonationRequest"')).rows[0].n) === 1, "Request draft not created");
      const request = (await db.query('SELECT "id","targetPaise","status" FROM "DonationRequest" LIMIT 1')).rows[0];
      assert.equal(String(request.targetPaise), "123456"); assert.equal(request.status, "DRAFT");
      await adminPage.goto(`${origin}/admin/fundraising/requests/${request.id}`);
      await adminPage.getByText(/₹1,234.56 target/).waitFor();
      await adminPage.getByLabel("Supporting file").setInputFiles({ name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n") });
      await adminPage.getByLabel("Evidence title").fill("Need assessment");
      const uploadResponse = adminPage.waitForResponse((response) => response.url().includes(`/api/admin/fundraising/requests/${request.id}/evidence`) && response.request().method() === "POST");
      await adminPage.getByRole("button", { name: "Upload privately" }).click();
      const uploadedResponse = await uploadResponse;
      if (uploadedResponse.status() !== 201) throw new Error(`Evidence upload HTTP ${uploadedResponse.status()}: ${(await uploadedResponse.text()).slice(0, 1200)}\n${serverErrors}`);
      const evidence = (await db.query('SELECT e."id",m."storageKey" FROM "DonationRequestEvidence" e JOIN "Media" m ON m."id"=e."mediaId" WHERE e."requestId"=$1', [request.id])).rows[0];
      assert.ok(evidence); storedKeys.push(evidence.storageKey);
      assert.equal((await adminPage.request.get(`${origin}/api/admin/fundraising/evidence/${evidence.id}/file`)).status(), 200);
      assert.equal((await adminPage.request.post(`${origin}/api/admin/fundraising/requests/${request.id}/evidence`, { headers: { origin: "https://unrelated.example" }, multipart: { title: "Blocked origin", file: { name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") } } })).status(), 403);
      await adminPage.goto(`${origin}/admin/fundraising/requests/${request.id}`);
      await adminPage.getByLabel("Title (English)").fill("School kit drive");
      await adminPage.getByLabel("Summary (English)").fill("Provide new school kits privately planned");
      await adminPage.getByRole("button", { name: "Create campaign draft" }).click();
      await poll(async () => Number((await db.query('SELECT count(*)::int AS n FROM "DonationCampaign"')).rows[0].n) === 1, "Campaign draft not created");
      const campaign = (await db.query('SELECT "id","status","publicationStatus" FROM "DonationCampaign" LIMIT 1')).rows[0];
      assert.deepEqual({ status: campaign.status, publicationStatus: campaign.publicationStatus }, { status: "DRAFT", publicationStatus: "DRAFT" });
      await adminPage.goto(`${origin}/admin/fundraising/requests/${request.id}`);
      await adminPage.getByRole("heading", { name: "Private campaign preview" }).waitFor();
      await adminPage.getByLabel("Purpose (English)").fill("School kits updated");
      await adminPage.getByRole("button", { name: "Save request draft" }).click();
      await poll(async () => Number((await db.query('SELECT "version" FROM "DonationRequest" WHERE "id"=$1', [request.id])).rows[0].version) === 1, "Request edit not saved");
      await adminPage.goto(`${origin}/admin/fundraising/requests/${request.id}`);
      await db.query('UPDATE "DonationRequest" SET "version"=2 WHERE "id"=$1', [request.id]);
      await adminPage.getByRole("button", { name: "Save request draft" }).click();
      await adminPage.getByText("This request changed. Reload it before saving.").waitFor();
      assert.equal(Number((await db.query('SELECT "version" FROM "DonationRequest" WHERE "id"=$1', [request.id])).rows[0].version), 2);
      const editor = await browser.newContext(); const editorPage = await editor.newPage(); await login(editorPage, "editor@phase5.test", password, "/admin/fundraising");
      await editorPage.goto(`${origin}/admin/fundraising`); await editorPage.waitForURL(`${origin}/admin`);
      assert.equal((await editorPage.request.get(`${origin}/api/admin/fundraising/evidence/${evidence.id}/file`)).status(), 401);
      assert.equal((await editorPage.request.post(`${origin}/api/admin/fundraising/requests/${request.id}/evidence`, { headers: { origin }, multipart: { title: "Editor denied", file: { name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") } } })).status(), 401);
      const publicPage = await browser.newPage(); await publicPage.goto(`${origin}/en`); assert.equal((await publicPage.locator("body").innerText()).includes("School kit drive"), false);
      await publicPage.goto(`${origin}/ta`); assert.equal((await publicPage.locator("body").innerText()).includes("School kit drive"), false);
      console.log("Headed Chrome: admin-only request and campaign drafts, exact INR paise, private evidence, invalid-origin/editor denial, stale edit denial and no public campaign leakage passed.");
    } finally { await db.end(); }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    for (const key of storedKeys) if (key.startsWith("private/donation-request-evidence/")) await rm(path.resolve("private-uploads", key.slice("private/".length)), { force: true });
    if (created && /^trustfolio_phase5_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
