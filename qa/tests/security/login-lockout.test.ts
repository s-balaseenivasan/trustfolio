/**
 * TC-AUTH-LOCKOUT-* — dual login rate limiter (QA priority 1, highest).
 *
 * Drives the REAL `src/auth.ts` `signIn("credentials", …)` → `authorize()` path and the REAL
 * `src/lib/rate-limit.ts` functions against the live, disposable QA Postgres database. Nothing
 * here is reimplemented: `hashIdentifier`, `rateLimit`, `resetRateLimit` and the Credentials
 * provider's own `authorize()` closure (reached only through NextAuth's own `signIn()`, not called
 * directly — it is not exported) are the exact functions shipped in `src/`.
 *
 * `authorize()` calls `next/headers` via `getClientIp()`, which throws outside a real Next.js
 * request. `qa/tests/_harness/next-request-scope.cjs` constructs the same AsyncLocalStorage
 * request-scope Next's own server installs per request, so `signIn()` runs for real. See that
 * file's header comment for what was tried and rejected first (`--conditions=react-server`,
 * a second `next dev` instance, dynamic `import()`).
 *
 * Run (from repo root; DATABASE_URL/AUTH_SECRET below are QA-only, never the project's .env):
 *   node --require ./node_modules/tsx/dist/cjs/index.cjs \
 *        --require ./qa/tests/_harness/server-only-stub.cjs \
 *        ./qa/tests/security/login-lockout.test.ts
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://qa:qa_throwaway@127.0.0.1:55432/trustfolio_qa";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "qa-selftest-secret-at-least-32-characters-long";

const { withRequestScope } = require("../_harness/next-request-scope.cjs");

type Result = { id: string; title: string; pass: boolean; detail: string };

async function main() {
  const bcrypt = require("bcryptjs");
  const { db } = require("../../../src/lib/db.ts");
  const { hashIdentifier, rateLimit, resetRateLimit } = require("../../../src/lib/rate-limit.ts");
  const authMod = require("../../../src/auth.ts");

  const results: Result[] = [];
  function record(id: string, title: string, pass: boolean, detail: string) {
    results.push({ id, title, pass, detail });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${id} — ${title} :: ${detail}`);
  }

  async function signInAttempt(email: string, password: string, ip: string) {
    try {
      const result = await withRequestScope(ip, () =>
        authMod.signIn("credentials", { email, password, redirect: false }),
      );
      return { ok: true as const, result };
    } catch (e: any) {
      return { ok: false as const, name: e?.name, message: e?.message };
    }
  }

  const limiterRow = (key: string) => db.rateLimit.findUnique({ where: { key } });
  // Exact key construction copied from src/auth.ts:35-36 — not reinterpreted.
  const ipEmailKey = (ip: string, email: string) => `login:${hashIdentifier(`${ip}:${email}`)}`;
  const accountKey = (email: string) => `login:account:${hashIdentifier(email)}`;

  const suffix = randomUUID().slice(0, 8);
  const userA = { email: `qa-lockout-a-${suffix}@example.test`, password: "Qa!LockoutA2026" };
  const userB = { email: `qa-lockout-b-${suffix}@example.test`, password: "Qa!LockoutB2026" };
  const createdUserIds: string[] = [];
  const allIpsTouched = new Set<string>();

  async function resetKeysFor(email: string, ips: string[]) {
    await resetRateLimit(accountKey(email));
    for (const ip of ips) await resetRateLimit(ipEmailKey(ip, email));
  }

  for (const u of [userA, userB]) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    const row = await db.user.create({
      data: { email: u.email, passwordHash, role: "EDITOR", name: "QA lockout fixture (disposable)" },
    });
    createdUserIds.push(row.id);
  }

  try {
    // TC-AUTH-LOCKOUT-001 — per-(IP,email) limiter trips at the 6th attempt from one IP,
    // independently of the per-account limiter, which still has headroom.
    {
      const ip = "198.51.100.10";
      allIpsTouched.add(ip);
      await resetKeysFor(userA.email, [ip]);
      for (let i = 1; i <= 5; i++) {
        const r = await signInAttempt(userA.email, "wrong-password", ip);
        assert.equal(r.ok, false, `attempt ${i} must fail (wrong password)`);
      }
      const ipRow = await limiterRow(ipEmailKey(ip, userA.email));
      const acctRow = await limiterRow(accountKey(userA.email));
      assert.ok(ipRow?.count === 5, `expected ip+email count 5, got ${ipRow?.count}`);
      assert.ok(acctRow?.count === 5, `expected account count 5, got ${acctRow?.count}`);

      // Same IP, 6th attempt, CORRECT password — must still fail: only the (ip,email) limiter
      // (now 6 > limit 5) explains this, ruling out bad credentials as the cause.
      const r6 = await signInAttempt(userA.email, userA.password, ip);
      record(
        "TC-AUTH-LOCKOUT-001",
        "per-(IP,email) limiter blocks the 6th attempt from the same IP even with the correct password",
        r6.ok === false,
        JSON.stringify(r6),
      );

      const acctRowAfter = await limiterRow(accountKey(userA.email));
      record(
        "TC-AUTH-LOCKOUT-001b",
        "the per-account limiter kept counting independently through the IP+email trip and had not itself tripped (6 <= 20)",
        acctRowAfter?.count === 6,
        `count=${acctRowAfter?.count}`,
      );
    }

    // TC-AUTH-LOCKOUT-002 — the (IP,email) limiter is scoped per pair: a fresh IP for the SAME
    // account gets its own budget and the correct-password login succeeds.
    {
      const freshIp = "198.51.100.11";
      allIpsTouched.add(freshIp);
      const r = await signInAttempt(userA.email, userA.password, freshIp);
      record(
        "TC-AUTH-LOCKOUT-002",
        "a different source IP for the same account is not blocked by the other IP's limiter; correct password succeeds",
        r.ok === true,
        JSON.stringify(r),
      );
    }

    // TC-AUTH-LOCKOUT-003 — a successful login clears BOTH limiter keys. Regression guard: an
    // earlier version cleared only the per-IP key, which could lock a busy account out for up to
    // an hour even after a correct login (filed as QA-REG-001).
    {
      const ipUsed = "198.51.100.11";
      const ipRow = await limiterRow(ipEmailKey(ipUsed, userA.email));
      const acctRow = await limiterRow(accountKey(userA.email));
      record(
        "TC-AUTH-LOCKOUT-003",
        "successful login clears both the per-(IP,email) key and the per-account key (src/auth.ts:52) — not just the IP key",
        ipRow === null && acctRow === null,
        `ipRow=${JSON.stringify(ipRow)} acctRow=${JSON.stringify(acctRow)}`,
      );
    }

    // TC-AUTH-LOCKOUT-004 — the per-account limiter trips on its own across 21 distinct source
    // IPs; the 21st attempt is refused even from a brand-new IP with the CORRECT password.
    {
      await resetKeysFor(userB.email, []);
      const ips = Array.from({ length: 20 }, (_, i) => `198.51.100.${30 + i}`);
      ips.forEach((ip) => allIpsTouched.add(ip));
      for (const ip of ips) {
        const r = await signInAttempt(userB.email, "wrong-password", ip);
        assert.equal(r.ok, false);
      }
      const acctRow = await limiterRow(accountKey(userB.email));
      record(
        "TC-AUTH-LOCKOUT-004a",
        "after 20 failed attempts from 20 distinct IPs the account counter reads 20 (not yet tripped: 20 <= limit 20)",
        acctRow?.count === 20,
        `count=${acctRow?.count}`,
      );

      const freshIp21 = "198.51.100.201";
      allIpsTouched.add(freshIp21);
      const r21 = await signInAttempt(userB.email, userB.password, freshIp21);
      record(
        "TC-AUTH-LOCKOUT-004b",
        "the 21st attempt, from a never-used IP, with the CORRECT password, is still refused — the account limiter alone blocks it",
        r21.ok === false,
        JSON.stringify(r21),
      );

      const ipRow21 = await limiterRow(ipEmailKey(freshIp21, userB.email));
      record(
        "TC-AUTH-LOCKOUT-004c",
        "the fresh IP's own (ip,email) counter is nowhere near its own limit (1 <= 5) — the block is attributable only to the account limiter",
        ipRow21?.count === 1,
        `count=${ipRow21?.count}`,
      );
    }

    // TC-AUTH-LOCKOUT-005 — rateLimit()'s single-statement upsert is atomic under concurrency.
    {
      const key = `qa:concurrency:${suffix}`;
      await resetRateLimit(key);
      const CONCURRENCY = 30;
      const LIMIT = 10;
      const outcomes = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => rateLimit(key, { limit: LIMIT, windowMs: 60_000 })),
      );
      const successCount = outcomes.filter((o: { success: boolean }) => o.success).length;
      const finalRow = await limiterRow(key);
      record(
        "TC-AUTH-LOCKOUT-005",
        `${CONCURRENCY} concurrent rateLimit() calls on one fresh key (limit ${LIMIT}) yield exactly ${LIMIT} successes and a final row count of ${CONCURRENCY} — no lost updates`,
        successCount === LIMIT && finalRow?.count === CONCURRENCY,
        `successes=${successCount} finalCount=${finalRow?.count}`,
      );
      await resetRateLimit(key);
    }
  } finally {
    for (const email of [userA.email, userB.email]) {
      await resetRateLimit(accountKey(email)).catch(() => undefined);
      for (const ip of allIpsTouched) await resetRateLimit(ipEmailKey(ip, email)).catch(() => undefined);
    }
    await db.activityLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} passed`);
  return results;
}

main()
  .then((results) => {
    if (results.some((r) => !r.pass)) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  });
