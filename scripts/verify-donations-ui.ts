/** Headed Chrome test for gated Phase 6 donor privacy and offline-intake workflow. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "@playwright/test";
import { Client } from "pg";

const port = 3196;
const origin = `http://127.0.0.1:${port}`;
async function poll(condition: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 60; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 500)); }
  throw new Error(message);
}
async function login(page: Page, email: string, password: string, route: string) {
  await page.goto(`${origin}/admin/login?callbackUrl=${encodeURIComponent(route)}`);
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === route, { timeout: 30000 });
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Local PostgreSQL only");
  const schema = `trustfolio_phase6_ui_${randomUUID().replaceAll("-", "")}`;
  const root = new Client({ connectionString: base }); await root.connect();
  let created = false; let server: ChildProcess | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined; const storedKeys: string[] = [];
  try {
    await root.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(base); scoped.searchParams.set("schema", schema); scoped.searchParams.set("options", `-c search_path=${schema}`);
    const password = "phase6-headed-password"; const passwordHash = await bcrypt.hash(password, 10);
    const env = { ...process.env, DATABASE_URL: scoped.toString(), TRUSTFOLIO_TEST_SCHEMA: schema, AUTH_SECRET: "phase6-headed-browser-test-only-secret", AUTH_TRUST_HOST: "true", NEXT_PUBLIC_SITE_URL: origin, SEED_DEMO: "false" };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1800)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` }); await db.connect();
    try {
      for (const [id, email, role, name] of [["admin", "admin@phase6.test", "ADMIN", "Phase Six Admin"], ["donor", "donor@phase6.test", "PORTAL_USER", "Private Donor"], ["outsider", "outsider@phase6.test", "PORTAL_USER", "Other Portal User"], ["editor", "editor@phase6.test", "EDITOR", "Editor"]]) {
        await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, email, name, passwordHash, role]);
      }
      await db.query('INSERT INTO "Project" ("id","slug","titleEn","summaryEn","status","publishedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now(),now())', ["project", "phase6-public-project", "Phase 6 Public Project", "A test fixture", "PUBLISHED"]);
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let serverErrors = ""; server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-4000); }); server.stdout?.on("data", () => {});
      await poll(async () => { if (server?.exitCode !== null) throw new Error(`Server exited: ${server?.exitCode}\n${serverErrors}`); try { return (await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; } }, "Next.js server did not start");
      browser = await chromium.launch({ channel: "chrome", headless: false });
      const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const admin = await adminContext.newPage();
      await login(admin, "admin@phase6.test", password, "/admin/donations");
      await admin.getByLabel("Account email").fill("donor@phase6.test");
      await admin.getByRole("button", { name: "Link account" }).click();
      await admin.getByRole("status").getByText("Existing portal account linked").waitFor();
      await poll(async () => (await db.query('SELECT count(*)::int AS n FROM "DonorProfile" WHERE "userId"=$1', ["donor"])).rows[0].n === 1, "Donor profile not linked");
      await admin.reload();
      const donationForm = admin.locator('form:has(select[name="donorProfileId"])');
      const profileId = (await db.query('SELECT "id" FROM "DonorProfile" WHERE "userId"=$1', ["donor"])).rows[0].id as string;
      await donationForm.locator('select[name="donorProfileId"]').selectOption(profileId);
      await donationForm.locator('select[name="projectId"]').selectOption("project");
      await donationForm.locator('input[name="amountRupees"]').fill("42.37");
      await donationForm.locator('select[name="method"]').selectOption("UPI");
      await donationForm.locator('input[name="reference"]').fill("private-reference-do-not-display");
      await donationForm.getByRole("button", { name: "Record pending intake" }).click();
      await donationForm.getByRole("status").getByText("excluded from confirmed totals").waitFor();
      await poll(async () => (await db.query('SELECT "amountPaise"::text AS amount,"status" FROM "Donation" LIMIT 1')).rows[0]?.amount === "4237", "Pending donation intake not stored in paise");
      assert.equal((await db.query('SELECT "status" FROM "Donation"')).rows[0].status, "PENDING_VERIFICATION");
      assert.equal((await db.query('SELECT count(*)::int AS n FROM "DonationHistory"')).rows[0].n, 1);
      const donationId = (await db.query('SELECT "id" FROM "Donation" LIMIT 1')).rows[0].id as string;
      const evidenceForm = admin.locator("article").filter({ hasText: "Private Donor" }).locator("form");
      await evidenceForm.getByLabel("Evidence file").setInputFiles({ name: "bank-proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n") });
      await evidenceForm.getByLabel("Title").fill("Private bank evidence");
      const evidenceResponse = admin.waitForResponse((response) => response.url().includes(`/api/admin/donations/${donationId}/evidence`) && response.request().method() === "POST");
      await evidenceForm.getByRole("button", { name: "Upload privately" }).click();
      const uploaded = await evidenceResponse;
      if (uploaded.status() !== 201) throw new Error(`Donation evidence upload HTTP ${uploaded.status()}: ${(await uploaded.text()).slice(0, 1000)}\n${serverErrors}`);
      const evidenceRow = (await db.query('SELECT e."id",m."storageKey",m."visibility" FROM "DonationEvidence" e JOIN "Media" m ON m."id"=e."mediaId" WHERE e."donationId"=$1', [donationId])).rows[0];
      assert.ok(evidenceRow); assert.equal(evidenceRow.visibility, "PRIVATE"); assert.ok(String(evidenceRow.storageKey).startsWith("private/donation-evidence/")); storedKeys.push(evidenceRow.storageKey);
      assert.equal((await admin.request.get(`${origin}/api/admin/donations/evidence/${evidenceRow.id}/file`)).status(), 200);

      const donorContext = await browser.newContext(); const donor = await donorContext.newPage();
      await login(donor, "donor@phase6.test", password, "/donor");
      await donor.getByRole("heading", { name: "Donor portal" }).waitFor(); await donor.getByText("₹42.37").waitFor();
      assert.equal(await donor.getByText("private-reference-do-not-display").count(), 0);
      assert.equal((await donor.request.get(`${origin}/api/admin/donations/evidence/${evidenceRow.id}/file`)).status(), 401);
      const outsiderContext = await browser.newContext(); const outsider = await outsiderContext.newPage();
      await login(outsider, "outsider@phase6.test", password, "/donor");
      await outsider.getByText("Donor access is not linked").waitFor();
      assert.equal(await outsider.getByText("₹42.37").count(), 0);

      const editorContext = await browser.newContext(); const editor = await editorContext.newPage();
      await login(editor, "editor@phase6.test", password, "/admin");
      await editor.goto(`${origin}/admin/donations`); await editor.waitForURL((url) => url.pathname === "/admin");
      await donor.goto(`${origin}/en/projects`); assert.equal(await donor.getByText("₹42.37").count(), 0);
      console.log("Headed Chrome: ADMIN-only intake, existing PORTAL_USER linking, exact INR paise, pending-only record, donor self-scope, private evidence access, private reference exclusion and public-route exclusion passed.");
      await adminContext.close(); await donorContext.close(); await outsiderContext.close(); await editorContext.close();
    } finally { await db.end(); }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    for (const key of storedKeys) if (key.startsWith("private/donation-evidence/")) await rm(path.resolve("private-uploads", key.slice("private/".length)), { force: true });
    if (created && /^trustfolio_phase6_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
