/** Headed Chrome club workflow against a disposable local PostgreSQL schema. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const port = 3188;
const origin = `http://127.0.0.1:${port}`;

async function waitForServer(server: ChildProcess) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next.js server exited with ${server.exitCode}`);
    try { const response = await fetch(`${origin}/admin/login`, { redirect: "manual", signal: AbortSignal.timeout(2000) }); if (response.status === 200 || response.status === 307) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Next.js test server did not become ready");
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const parsed = new URL(base);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Headed club test accepts local PostgreSQL only");
  const schema = `trustfolio_phase2_ui_${randomUUID().replaceAll("-", "")}`;
  const privateRoot = path.resolve(process.cwd(), "private-uploads");
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
    const testEnv = { ...process.env, DATABASE_URL: scopedUrl.toString(), AUTH_SECRET: "phase2-browser-test-secret-2026-only", AUTH_TRUST_HOST: "true", NEXT_PUBLIC_SITE_URL: origin, SEED_DEMO: "false", STORAGE_DRIVER: "local", TRUSTFOLIO_TEST_SCHEMA: schema };
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: testEnv, encoding: "utf8", timeout: 120_000 });
    if (migration.status !== 0) throw new Error(`Migration failed: ${(migration.stderr || migration.stdout).slice(-1500)}`);
    const db = new Client({ connectionString: base, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      const hash = await bcrypt.hash("Phase2Test!2026", 12);
      for (const [id, email, name, role] of [["club-admin", "club-admin@example.test", "Club Admin", "ADMIN"], ["coordinator", "club-coordinator@example.test", "Club Coordinator", "PORTAL_USER"], ["outsider", "club-outsider@example.test", "Unrelated Account", "PORTAL_USER"], ["editor", "club-editor@example.test", "Content Editor", "EDITOR"]]) {
        await db.query('INSERT INTO "User" ("id","email","name","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, email, name, hash, role]);
      }
      await db.query('INSERT INTO "TrustProfile" ("id","nameEn","updatedAt") VALUES ($1,$2,now())', ["default", "Phase 2 Test Trust"]);
      await db.query('INSERT INTO "SiteSetting" ("id","seoTitleEn","seoDescriptionEn","seoKeywords","navigation","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["default", "Phase 2 Test Trust", "Isolated test content", [], "[]"]);

      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: testEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let serverErrors = "";
      server.stderr?.on("data", (chunk: Buffer) => { serverErrors = `${serverErrors}${chunk.toString()}`.slice(-3000); });
      server.stdout?.on("data", () => {});
      try { await waitForServer(server); } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${serverErrors.slice(-1200)}`); }
      console.log("Isolated schema and Next.js test server ready.");
      browser = await chromium.launch({ channel: "chrome", headless: false });
      const admin = await browser.newContext({ viewport: { width: 1365, height: 850 } });
      const adminPage = await admin.newPage();
      await adminPage.goto(`${origin}/admin/clubs`);
      await adminPage.getByLabel("Email").fill("club-admin@example.test");
      await adminPage.getByLabel("Password").fill("Phase2Test!2026");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await adminPage.getByRole("heading", { name: "Clubs" }).waitFor({ timeout: 30000 });
      await adminPage.getByLabel("Name (English)").fill("Test River Club");
      await adminPage.getByRole("button", { name: "Create draft club" }).click();
      await adminPage.getByText(/Draft club CLB-/).waitFor();
      await adminPage.getByRole("link", { name: "Open the new club" }).click();
      await adminPage.getByRole("heading", { name: "Test River Club" }).waitFor();
      const clubId = adminPage.url().split("/").at(-1)!;
      await adminPage.getByRole("button", { name: "Apply status" }).click();
      await adminPage.getByText("Club set to active.").waitFor();
      const stalePage = await admin.newPage();
      await stalePage.goto(`${origin}/admin/clubs/${clubId}`);
      await stalePage.getByRole("heading", { name: "Test River Club" }).waitFor();
      await adminPage.getByLabel("Invite account").selectOption("coordinator");
      await adminPage.getByRole("button", { name: "Invite", exact: true }).click();
      await adminPage.getByText(/Existing account invited/).waitFor();

      const coordinator = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const coordinatorPage = await coordinator.newPage();
      await coordinatorPage.goto(`${origin}/club`);
      await coordinatorPage.getByLabel("Email").fill("club-coordinator@example.test");
      await coordinatorPage.getByLabel("Password").fill("Phase2Test!2026");
      await coordinatorPage.getByRole("button", { name: "Sign in" }).click();
      await coordinatorPage.getByRole("heading", { name: "Club portal" }).waitFor({ timeout: 30000 });
      await coordinatorPage.getByText("Your membership status: invited.").count().then((count) => assert.equal(count, 0));
      await coordinatorPage.getByRole("checkbox", { name: /18 or older/ }).check();
      await coordinatorPage.getByRole("checkbox", { name: /agree that Trustfolio staff/ }).check();
      await coordinatorPage.getByRole("button", { name: "Request membership" }).click();
      await coordinatorPage.getByText("Your membership status: requested.").waitFor();
      await coordinatorPage.goto(`${origin}/club/${clubId}`);
      await coordinatorPage.getByText(/404|not found/i).first().waitFor();
      await coordinatorPage.goto(`${origin}/admin`);
      await coordinatorPage.waitForURL(`${origin}/club`);

      await adminPage.reload();
      await adminPage.getByRole("button", { name: "Approve" }).click();
      await adminPage.getByLabel("Approved member").locator('option[value="coordinator"]').waitFor({ state: "attached" });
      await adminPage.getByLabel("Approved member").selectOption("coordinator");
      await adminPage.getByRole("button", { name: "Appoint" }).click();
      await adminPage.getByText("Coordinator appointed from approved members.").waitFor();
      await stalePage.getByLabel("Change to").selectOption("SUSPENDED");
      await stalePage.getByRole("button", { name: "Apply status" }).click();
      await stalePage.getByText("This club changed. Reload it before continuing.").waitFor();
      await stalePage.close();
      await adminPage.getByLabel("Private file").setInputFiles({ name: "club-evidence.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% Club test document\n") });
      await adminPage.getByLabel("Title (English)").fill("Club evidence");
      await adminPage.getByRole("button", { name: "Upload document" }).click();
      await adminPage.getByText("Club evidence").waitFor();
      const document = await db.query('SELECT "id","mediaId" FROM "ClubDocument" WHERE "clubId"=$1', [clubId]);
      const documentId = document.rows[0]?.id as string;
      const mediaId = document.rows[0]?.mediaId as string;
      assert.ok(documentId);
      assert.ok(mediaId);

      const editor = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const editorPage = await editor.newPage();
      await editorPage.goto(`${origin}/admin/media`);
      await editorPage.getByLabel("Email").fill("club-editor@example.test");
      await editorPage.getByLabel("Password").fill("Phase2Test!2026");
      await editorPage.getByRole("button", { name: "Sign in" }).click();
      await editorPage.getByRole("heading", { name: "Media library" }).waitFor();
      const editorMedia = await editorPage.request.get(`${origin}/api/admin/media`);
      assert.equal(editorMedia.status(), 200);
      assert.equal((await editorMedia.json() as { items: { id: string }[] }).items.some((item) => item.id === mediaId), false);
      const editorFile = await editorPage.request.get(`${origin}/api/admin/media/${mediaId}/file`);
      assert.equal(editorFile.status(), 404);

      const joined = new Date();
      await db.query('INSERT INTO "Club" ("id","code","nameEn","status","coordinatorId","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', ["other-club", "CLB-OTHER", "Other Club", "ACTIVE", "outsider", "club-admin"]);
      await db.query('INSERT INTO "ClubMembership" ("id","clubId","userId","role","status","consentAt","consentVersion","adultAttestedAt","joinedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', ["other-member", "other-club", "outsider", "COORDINATOR", "ACTIVE", joined, "club-membership-v1", joined, joined]);

      await coordinatorPage.goto(`${origin}/club/${clubId}`);
      await coordinatorPage.getByRole("heading", { name: "Test River Club" }).waitFor();
      await coordinatorPage.getByText("Club evidence").waitFor();
      const allowed = await coordinatorPage.request.get(`${origin}/api/club/documents/${documentId}/file`);
      assert.equal(allowed.status(), 200);
      assert.match(await allowed.text(), /Club test document/);

      const outsider = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const outsiderPage = await outsider.newPage();
      await outsiderPage.goto(`${origin}/club`);
      await outsiderPage.getByLabel("Email").fill("club-outsider@example.test");
      await outsiderPage.getByLabel("Password").fill("Phase2Test!2026");
      await outsiderPage.getByRole("button", { name: "Sign in" }).click();
      await outsiderPage.getByRole("heading", { name: "Club portal" }).waitFor();
      await outsiderPage.goto(`${origin}/club/other-club`);
      await outsiderPage.getByRole("heading", { name: "Other Club" }).waitFor();
      const denied = await outsiderPage.request.get(`${origin}/api/club/documents/${documentId}/file`);
      assert.equal(denied.status(), 404);
      const deniedUpload = await outsiderPage.request.post(`${origin}/api/admin/clubs/${clubId}/documents`, { headers: { Origin: origin }, multipart: { titleEn: "Unauthorized document", file: { name: "denied.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nDenied\n") } } });
      assert.equal(deniedUpload.status(), 401);
      await outsiderPage.goto(`${origin}/club/${clubId}`);
      await outsiderPage.getByText(/404|not found/i).first().waitFor();

      await adminPage.goto(`${origin}/club`);
      const ownRequest = adminPage.locator("article", { hasText: "Test River Club" });
      await ownRequest.getByRole("checkbox", { name: /18 or older/ }).check();
      await ownRequest.getByRole("checkbox", { name: /agree that Trustfolio staff/ }).check();
      await ownRequest.getByRole("button", { name: "Request membership" }).click();
      await adminPage.getByText("Your membership status: requested.").waitFor();
      await adminPage.goto(`${origin}/admin/clubs/${clubId}`);
      const selfRow = adminPage.getByRole("row", { name: /club-admin@example.test/ });
      await selfRow.getByRole("button", { name: "Approve" }).click();
      await adminPage.getByText("You cannot approve your own membership.").waitFor();

      await adminPage.getByLabel("Change to").selectOption("SUSPENDED");
      await adminPage.getByRole("button", { name: "Apply status" }).click();
      await adminPage.getByText("Club set to suspended.").waitFor();
      await coordinatorPage.goto(`${origin}/club/${clubId}`);
      await coordinatorPage.getByText(/404|not found/i).first().waitFor();
      await adminPage.getByLabel("Change to").selectOption("ARCHIVED");
      await adminPage.getByRole("button", { name: "Apply status" }).click();
      await adminPage.getByText("Club set to archived.").waitFor();
      const retained = await db.query('SELECT (SELECT "status" FROM "Club" WHERE "id"=$1) AS status, (SELECT count(*) FROM "ClubMembership" WHERE "clubId"=$1) AS members, (SELECT count(*) FROM "ClubDocument" WHERE "clubId"=$1) AS documents, (SELECT count(*) FROM "ClubMembershipHistory" WHERE "membershipId" IN (SELECT "id" FROM "ClubMembership" WHERE "clubId"=$1)) AS history', [clubId]);
      assert.equal(retained.rows[0].status, "ARCHIVED");
      assert.ok(Number(retained.rows[0].members) >= 2);
      assert.equal(Number(retained.rows[0].documents), 1);
      assert.ok(Number(retained.rows[0].history) >= 3);
      await adminPage.goto(`${origin}/en`);
      await adminPage.getByRole("main").waitFor();
      await adminPage.goto(`${origin}/ta`);
      await adminPage.getByRole("main").waitFor();
      console.log("Headed Chrome: club create, activation, invite, consent, admin approval, self-approval and stale-update denial, cross-club scope, private file and upload denial (including legacy editor media paths), suspension, archive history and public locale smoke checks passed.");
    } finally { await db.end(); }
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null && server.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    if (created && /^trustfolio_phase2_ui_[a-f0-9]{32}$/.test(schema)) {
      const files = await root.query(`SELECT "storageKey" FROM "${schema}"."Media" WHERE "storageKey" LIKE 'private/club-documents/%'`).catch(() => ({ rows: [] as { storageKey: string }[] }));
      for (const row of files.rows as { storageKey: string }[]) {
        const file = path.resolve(privateRoot, row.storageKey.split("/").slice(1).join("/"));
        if (file.startsWith(privateRoot + path.sep)) await unlink(file).catch(() => undefined);
      }
    }
    if (created && /^trustfolio_phase2_ui_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Headed club test failed"); process.exitCode = 1; });
