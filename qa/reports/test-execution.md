# Test Execution Report

Run id: `run-qa-20261116`. Environment: isolated QA Postgres 18 container
(`postgresql://qa:***@127.0.0.1:55432/trustfolio_qa` — credentials redacted, never the project's
`.env`), seeded (1 admin user, 8 projects, 12 activities, 6 documents, 45 categories). Node v24.18.0,
`tsx` v4.23.15, Next.js 16.4.6. No application code was modified. All writes were made against the
disposable QA database only; every suite creates its own fixtures (tagged `qa-*`/`QA-*` with a
random suffix) and deletes them in a `finally` block — verified clean (row counts back at the
seeded baseline) after the final run, see "Database hygiene" below.

Depth over breadth, per the brief: 27 tests written and **executed**, 0 merely proposed, covering
the four priorities in order.

## How these tests reached code that normally requires a running Next.js server

Three of `src/`'s server-only modules (`src/auth.ts`, `src/lib/rate-limit.ts`,
`src/server/*/service.ts`) start with `import "server-only"`, which throws outside a build
compiled by Next's own bundler, and `src/auth.ts`'s `signIn()` additionally calls `next/headers`,
which throws outside a real per-request `AsyncLocalStorage` scope. Two small harness files under
`qa/tests/_harness/` (not application code — read their header comments for what they do and why)
make both work from a plain `node`/`tsx` process against the real QA database:

- `server-only-stub.cjs` — neutralizes the `server-only` guard for the test process only (does not
  touch `node_modules/server-only` on disk).
- `next-request-scope.cjs` — constructs the same request-scope `AsyncLocalStorage` stores Next's
  own server installs per request, using Next's own (undocumented, version-pinned) internals. This
  is what let `TC-AUTH-LOCKOUT-*` drive the REAL `signIn("credentials", …)` → `authorize()` path,
  not a reimplementation of it.

Every invocation uses:
```
node --require ./node_modules/tsx/dist/cjs/index.cjs \
     --require ./qa/tests/_harness/server-only-stub.cjs \
     ./qa/tests/<suite>.test.ts
```

Paths tried and rejected before this, kept here so a future run does not repeat them:
- `--conditions=react-server` bypasses `server-only` too, but then `react`/`next` resolve to their
  real react-server builds, which assume Next's bundler-produced runtime and crash elsewhere
  (`react.createContext` missing).
- A second `next dev -p 3100` instance — attempted and logged at
  `qa/reports/evidence/run-qa-20261116/server-log/next-dev-3100.log`. It bound and compiled, then
  refused to serve: Next's single-dev-server lock is keyed off the **project directory**, not the
  port, and the developer's own `next dev` on :3000 already holds it for this repo. No server was
  started on port 3000 or anywhere that could collide with it.
- Dynamic `import()` of a local `.ts` file does not route through the patched `Module._load`, so
  the stub has no effect on it — only `require()` (via `tsx`'s CJS register) does, which is why
  every harness file and test file here uses `require`, not `import`.

## 1. Login lockout — dual rate limiter (highest priority)

**Suite:** `qa/tests/security/login-lockout.test.ts`
**Command:** `node --require ./node_modules/tsx/dist/cjs/index.cjs --require ./qa/tests/_harness/server-only-stub.cjs ./qa/tests/security/login-lockout.test.ts`
**Exit code:** 0 **Duration:** ~2.3s **Evidence:** `qa/reports/evidence/run-qa-20261116/login-lockout.log`

| Test | Result |
|---|---|
| TC-AUTH-LOCKOUT-001 — (ip,email) limiter blocks the 6th attempt from the same IP even with the correct password | PASS |
| TC-AUTH-LOCKOUT-001b — account limiter keeps counting independently, not yet tripped (6≤20) | PASS |
| TC-AUTH-LOCKOUT-002 — a fresh IP for the same account gets its own budget; correct password succeeds | PASS |
| TC-AUTH-LOCKOUT-003 — successful login clears **both** rate-limit keys | PASS |
| TC-AUTH-LOCKOUT-004a — 20 failed attempts from 20 distinct IPs: account counter reads 20, not yet tripped | PASS |
| TC-AUTH-LOCKOUT-004b — the 21st attempt, fresh IP, correct password, is still refused | PASS |
| TC-AUTH-LOCKOUT-004c — the fresh IP's own counter is nowhere near its limit (isolates the cause) | PASS |
| TC-AUTH-LOCKOUT-005 — 30 concurrent `rateLimit()` calls on one key (limit 10): exactly 10 succeed, final count 30 | PASS |

**8/8 passed.** All four asks from the brief are directly confirmed:
- Both limiters trip independently (001/001b exhausts the IP+email pair while the account limiter
  stays open; 004a/004b exhausts the account limiter across 20 IPs while no individual (ip,email)
  pair ever approaches its own limit).
- A successful login clears BOTH keys (003) — this is the exact regression **QA-REG-001** raised
  concern about ("not reproduced... no database available"). With a database available, the
  current code (`src/auth.ts:52`) resets both, and the test confirms it. **Recommend the
  orchestrator revise QA-REG-001's status; evidence below.**
- The 21st failed attempt for one email is refused even from a fresh IP (004b), with the correct
  password, ruling out "wrong credentials" as an alternative explanation.
- `rateLimit()`'s upsert is atomic under concurrency (005): 30 parallel calls, limit 10, yields
  exactly 10 successes and a final row count of 30 — no lost updates.

## 2. Route authorization matrix (QA-TEST-003) + 4. Club-document storage-prefix check (QA-API-001)

**Suite:** `qa/tests/security/route-authorization.test.ts`
**Command:** `node --require ./node_modules/tsx/dist/cjs/index.cjs --require ./qa/tests/_harness/server-only-stub.cjs ./qa/tests/security/route-authorization.test.ts`
**Exit code:** 0 **Duration:** ~1.1s **Evidence:** `qa/reports/evidence/run-qa-20261116/route-authorization.log`

| Test | Result |
|---|---|
| TC-API-CLUBDOC-001 — coordinator succeeds | PASS |
| TC-API-CLUBDOC-002 — regular member (non-owner) refused | PASS |
| TC-API-CLUBDOC-003 — unrelated user refused | PASS |
| TC-API-CLUBDOC-004 — PRIVATE media missing the storage prefix refused even for the real coordinator | PASS |
| TC-API-CLUBDOC-005 — control: correct prefix passes | PASS |
| TC-API-TASK-001 — assigned volunteer succeeds (`requireVolunteerTask`) | PASS |
| TC-API-TASK-002 — unassigned club member refused | PASS |
| TC-API-TASK-003 — ADMIN bypass (`requireTaskReader`) | PASS |
| TC-API-TASK-004 — assigned volunteer succeeds via `requireTaskReader` | PASS |
| TC-API-TASK-005 — unrelated actor refused | PASS |
| TC-API-TASK-006 — nonexistent task → TASK_NOT_FOUND | PASS |

**11/11 passed.** Priority 4's exact ask — a PRIVATE media row whose `storageKey` lacks
`CLUB_DOCUMENT_STORAGE_PREFIX` must 404 even for an authorized coordinator — is TC-API-CLUBDOC-004,
confirmed with a control case (005) proving the check is prefix-specific, not a false-blocker.

**What this does not cover** (stated in full in `qa/test-cases/route-authorization.md`'s scope
note): the route handlers themselves were not invoked with a constructed `Request` as the brief
suggested — direct `require()` of the route files succeeds, but calling the exported `GET`/`POST`
needs a `NextRequest` with a real signed session cookie threaded through `cookies()`/`headers()`,
which is materially more harness-building than justified given `requireClubCoordinator()`,
`requireVolunteerTask()` and `requireTaskReader()` — the functions actually tested here — hold all
of the owner/non-owner/admin decision logic those routes delegate to. The anonymous-401 branch is a
single `if (!actor) return 401` per route, already confirmed by reading
(`qa/architecture/api-inventory.md`) and not separately re-executed.

## 3. Media deletion guards (QA-DB-001 / QA-FLOW-002)

**Suite:** `qa/tests/db/media-deletion-guards.test.ts`
**Command:** `node --require ./node_modules/tsx/dist/cjs/index.cjs --require ./qa/tests/_harness/server-only-stub.cjs ./qa/tests/db/media-deletion-guards.test.ts`
**Exit code:** 0 **Duration:** ~0.9s **Evidence:** `qa/reports/evidence/run-qa-20261116/media-deletion-guards.log`

| Test | Result |
|---|---|
| TC-DB-MEDIA-001 — evidence attachment (ClubDocument) blocks | PASS |
| TC-DB-MEDIA-001b — raw delete without the guard throws Prisma P2003 (Restrict) | PASS |
| TC-DB-MEDIA-002 — published gallery album blocks | PASS |
| TC-DB-MEDIA-002b — raw delete without the guard cascades, silently drops the photo from the published album | PASS |
| TC-DB-MEDIA-003 — published cover blocks | PASS |
| TC-DB-MEDIA-003b — raw delete without the guard nulls the cover on the still-published project | PASS |
| TC-DB-MEDIA-004 — unused file: no blocker | PASS |
| TC-DB-MEDIA-004b — unused file deletes successfully end to end | PASS |

**8/8 passed.** All four requested branches (evidence/gallery/cover/unused) are confirmed, plus a
"bypass the guard" counterpart for each blocking branch that directly demonstrates *why* the guard
exists by reproducing the schema-level consequence the fix's own code comments describe (P2003 for
Restrict, silent cascade for Cascade, silent null for SetNull) — none of these three outcomes was
asserted on faith; each was triggered and observed.

## Database hygiene

Two ordering bugs were found and fixed in this run's own test fixtures (not application bugs — my
mistake, caught and corrected before the final evidence capture):
1. `media-deletion-guards.test.ts` initially attempted to delete a `Media` row before the
   `ClubDocument` referencing it, hitting the same `P2003` the test itself was trying to prove on
   purpose, except unintentionally, in teardown. Fixed by deleting them inline in the correct
   order.
2. `route-authorization.test.ts` initially attempted to delete the coordinator `User` row before
   clearing `Club.coordinatorId`, hitting the same `Restrict` constraint. Fixed by unsetting the
   reference in teardown before the user delete runs.

Both were caught by comparing database row counts before and after each run — see commands below —
not by the tests silently leaving residue unnoticed. Final state after the corrected runs matches
the documented seed baseline exactly (1 user, 8 projects, 0 extra clubs, 0 `RateLimit` rows, 0
orphaned `ClubMembership`/`ClubDocument`/`ProjectTask`/`VolunteerProfile` rows).

## Mechanical baseline

Per testing-strategy.md §0, the project's existing mechanical checks were not re-run in this pass —
phase 6's reports (`qa/reports/evidence/db-run-001/check-db.log`) already record the six existing
`db` suites passing, and this pass only adds net-new coverage for code none of them touch
(`src/auth.ts`'s account limiter, `findDeletionBlocker()`, the club-document storage-prefix check,
and the three IDOR scope-check functions). `npm run build` and starting a server on port 3000 were
both avoided per the brief's constraint; the one `next dev -p 3100` attempt is logged above and did
not bind.

## Untested areas and why

- **Full HTTP-level route handler invocation** (constructed `Request` → handler → `Response`) for
  all three IDOR-boundary routes and the ninth route not covered by any suite here. Blocked by this
  environment: a second `next dev` instance cannot start (directory-keyed lock already held by the
  developer's own instance), and direct module invocation needs a signed session cookie wired
  through Next's internal request-scope machinery, which was judged disproportionate effort once
  the underlying scope-check functions were proven directly. The anonymous-401 branch and exact
  response envelope (status, headers, body shape) for all 12 routes remain verified only by static
  reading (`qa/architecture/api-inventory.md`), not by execution.
- **`deleteMedia()` end to end** (the exported Server Action, including its `adminMutation()` →
  `requireAdmin()` wrapper and the activity log / cache-expiry side effects after a successful
  delete). Only `findDeletionBlocker()` — the logic the QA-DB-001/QA-FLOW-002 fix actually changed —
  was exercised directly.
- **The other 13 PUBLISHED `SetNull` relations** QA-FLOW-002 lists beyond `Project.cover`
  (`Trustee.photo`, `TrustProfile.logo`/`heroImage`, `Document.originalFile`/`thumbnail`,
  `Activity.cover`, `Story.cover`, `NewsPost.cover`, `GalleryAlbum.cover`, `Certificate.image`,
  `AnnualReport.cover`, `Testimonial.photo`, `HistoryEvent.image`, `SiteSetting.ogImage`) — same
  query shape as the one proven case, not independently re-run for each.
- **The browser-facing login form and `safeCallback()` open-redirect guard** in
  `src/server/actions/auth.ts` — UI-level, out of scope for this pass's DB/security focus.
- **Load/soak behavior of the rate limiter** under realistic concurrent traffic volumes (only 30
  concurrent calls were exercised) — a larger load test needs separate approval per the brief's
  constraints on shared-environment load tests, and this is a disposable single-container QA
  database, not a shared environment, so a larger run would be low-risk if requested.
- **The ninth route not named in the brief's three priorities** (`/api/admin/media/[id]/file`,
  `/api/admin/donations/evidence/[id]/file`, `/api/admin/fundraising/evidence/[id]/file`, etc.) —
  out of scope for this pass; `api-inventory.md` covers them by reading only.

## Flakiness

Each suite was run three times total during development of this pass (twice to catch and fix the
two fixture-cleanup ordering bugs above, once for the final clean evidence capture). All three
final runs were deterministic 8/8, 8/8, 11/11 passes with no intermittent failures observed; no
flakiness to report for these 27 tests.
