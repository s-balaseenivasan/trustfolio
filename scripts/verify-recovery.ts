/** Rehearse database and local private-file recovery using only disposable fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

function run(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: environment, encoding: "utf8", timeout: 180_000 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown error").slice(-1200)}`);
}

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required");
  const connection = new URL(source);
  if (!["localhost", "127.0.0.1", "::1"].includes(connection.hostname)) throw new Error("Recovery rehearsal requires local PostgreSQL");
  const bin = process.env.PG_BIN;
  if (!bin) throw new Error("Set PG_BIN to the local PostgreSQL bin directory");
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `trustfolio_recovery_test_${suffix}`;
  const storageKey = `private/recovery-test/${suffix}.txt`;
  const privateFile = path.resolve(process.cwd(), "private-uploads", "recovery-test", `${suffix}.txt`);
  const temp = await mkdtemp(path.join(os.tmpdir(), "trustfolio-recovery-"));
  const archive = path.join(temp, "database.dump");
  const fileBackup = path.join(temp, "private-file.txt");
  const binary = (name: string) => path.join(bin, process.platform === "win32" ? `${name}.exe` : name);
  const pgEnv = {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || "5432",
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: connection.pathname.slice(1),
  };
  const root = new Client({ connectionString: source });
  let schemaExists = false;
  await root.connect();
  try {
    await root.query(`CREATE SCHEMA "${schema}"`);
    schemaExists = true;
    const scoped = new URL(source);
    scoped.searchParams.set("schema", schema);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { ...process.env, DATABASE_URL: scoped.toString() });

    const db = new Client({ connectionString: source, options: `-c search_path=${schema}` });
    await db.connect();
    try {
      await db.query('INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ($1,$2,$3,$4,now())', [`user-${suffix}`, `recovery-${suffix}@example.test`, "test-only", "ADMIN"]);
      await db.query('INSERT INTO "Media" ("id","url","storageKey","filename","mimeType","size","visibility","uploadedById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', [`media-${suffix}`, `private:${storageKey}`, storageKey, "recovery-test.txt", "text/plain", 20, "PRIVATE", `user-${suffix}`]);
    } finally { await db.end(); }
    await mkdir(path.dirname(privateFile), { recursive: true });
    await writeFile(privateFile, `recovery fixture ${suffix}`);
    await writeFile(fileBackup, await readFile(privateFile));

    run(binary("pg_dump"), ["--format=custom", "--schema", schema, "--file", archive], pgEnv);
    await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    schemaExists = false;
    await rm(privateFile);
    run(binary("pg_restore"), ["--dbname", pgEnv.PGDATABASE!, "--no-owner", "--no-privileges", archive], pgEnv);
    schemaExists = true;
    await writeFile(privateFile, await readFile(fileBackup));

    const restored = new Client({ connectionString: source, options: `-c search_path=${schema}` });
    await restored.connect();
    try {
      const user = await restored.query('SELECT "email" FROM "User" WHERE "id"=$1', [`user-${suffix}`]);
      const media = await restored.query('SELECT "storageKey","visibility" FROM "Media" WHERE "id"=$1', [`media-${suffix}`]);
      assert.equal(user.rows.length, 1);
      assert.deepEqual(media.rows[0], { storageKey, visibility: "PRIVATE" });
      assert.equal((await readFile(privateFile, "utf8")), `recovery fixture ${suffix}`);
      console.log("Recovery rehearsal passed: custom-format database dump, isolated restore, private file restore and reference checks.");
    } finally { await restored.end(); }
  } finally {
    if (schemaExists && /^trustfolio_recovery_test_[a-f0-9]{32}$/.test(schema)) await root.query(`DROP SCHEMA "${schema}" CASCADE`);
    await root.end();
    await rm(privateFile, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
