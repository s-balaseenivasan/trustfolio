# Regression Report — 8 Approved Fixes

Environment: local, static + mechanical verification only. No database (Docker not running; the
local Postgres on 5432 is the developer's live dev database and was never touched, never connected
to, and no `db:*`/`check:db` script was run). Not a git repository — all diffs below are against
the pre-fix backups the orchestrator placed at `qa/reports/evidence/pre-fix-backup/`.

Scope: the 8 approved findings — QA-AUTH-001, QA-FLOW-001, QA-DB-001, QA-FLOW-002, QA-DB-003,
QA-API-001, QA-DB-007, QA-FLOW-005 — implemented across 7 files.

## 1. Change set

| File | Findings fixed in this file |
|---|---|
| `src/auth.ts` | QA-AUTH-001 |
| `src/auth.config.ts` | QA-FLOW-005 |
| `src/components/admin/project-operations.tsx` | QA-FLOW-001 |
| `src/server/actions/admin/media.ts` | QA-DB-001, QA-FLOW-002 (one shared helper) |
| `src/server/actions/admin/trust.ts` | QA-DB-007 |
| `src/app/api/admin/upload/route.ts` | QA-DB-003 |
| `src/app/api/club/documents/[id]/file/route.ts` | QA-API-001 |

**Process note (filed as QA-REG-002):** `qa/reports/diff-scope.json`'s `changed` array and
`counts.changedFiles` list only 6 of these 7 files — it omits
`src/app/api/club/documents/[id]/file/route.ts`. Its downstream graph walk still surfaced
`api.club.documentFile` independently (via a shared dependency seeded by another changed file), so
this pass was not blind to it, but the scope file itself is stale and should be regenerated before
being relied on as the authoritative file list for a later audit.

## 2. Diff-vs-claim verification (per finding)

Every changed file was diffed against its pre-fix backup
(`diff -u qa/reports/evidence/pre-fix-backup/<path> <path>`) and the diff was checked line-by-line
against the finding's `fix_applied` text in `qa/reports/findings.json`.

| ID | Claim (`fix_applied`) | Diff matches claim? |
|---|---|---|
| QA-AUTH-001 | Added `LOGIN_ACCOUNT_RATE_LIMIT` (20/hour) + second `rateLimit()` keyed on `login:account:${hashIdentifier(email)}`; fails if either trips; only per-IP key cleared on success | **Yes, exactly.** `src/auth.ts` adds the constant, the second key, a `Promise.all` over both limiters, the combined failure check, and leaves `resetRateLimit(limiterKey)` calling only the IP-keyed key. No other line in the file changed. |
| QA-FLOW-005 | Deleted dead `callbacks.authorized`; corrected the header comment claiming the config is shared with `proxy.ts` | **Yes, exactly.** The `authorized({ auth, request })` callback block is removed in full; the comment at the top of the file is rewritten to state `proxy.ts` does not import this config and explain why no `authorized` callback exists. No behavioral code outside the callback and comment changed. |
| QA-FLOW-001 | Replaced `{!closed}` gate on `TaskEvidenceUpload` with `canAcceptEvidence = TODO\|IN_PROGRESS`, mirroring the service gate that sits above the ADMIN bypass | **Yes, exactly.** One new `const canAcceptEvidence = ["TODO", "IN_PROGRESS"].includes(task.status);` line, and the single `{!closed && <div className="mt-3"><TaskEvidenceUpload .../></div>}` line is the only place `closed` was replaced with `canAcceptEvidence`. Verified independently against `src/server/projects/service.ts:267`, which gates `createTaskEvidenceFromUpload` on exactly `["TODO", "IN_PROGRESS"].includes(task.status)` **before** the `actor.role !== "ADMIN"` branch at :268 — so the UI now matches the real, unconditional server gate. |
| QA-DB-001 | Added `findDeletionBlocker()` counting usage across the 4 Restrict evidence tables and returning an actionable message instead of a raw P2003 | **Yes.** `src/server/actions/admin/media.ts` adds the function with the 4 `count()` calls (see field verification in §3) and wires it into `deleteMedia()` ahead of `db.media.delete()`. |
| QA-FLOW-002 | Same `findDeletionBlocker()` also blocks `GalleryImage` (the real Cascade) and published SetNull references across Document, Project, Activity, NewsPost, Story, GalleryAlbum covers, TrustProfile logo/hero and Trustee photo | **Yes**, with one behavioral broadening worth recording: the pre-fix `Document` check filtered on `status: "PUBLISHED", visibility: "PUBLIC"`; the new check filters on `status: "PUBLISHED"` only (dropping the `visibility` condition) but adds `originalFileId` and `thumbnailId` to the `OR`. Net effect is **strictly more conservative** — it now also blocks deleting the un-redacted original/thumbnail behind a published document, and blocks deleting media behind a `PUBLISHED`-but-`PRIVATE` (admin-only) document that the old code would have let through. This matches the `fix_applied` text (which does not claim a visibility distinction either way) and closes rather than opens a gap, but it is a behavior change beyond the literal finding text and is worth a line in release notes. |
| QA-DB-003 | Hoisted `stored` outside the `try`, added `deleteStoredFile({ ...stored, visibility })` to the `catch`, imported `deleteStoredFile` | **Yes, exactly.** `let stored: Awaited<ReturnType<typeof storeFile>> \| undefined;` declared before the `try`; `stored = await storeFile(...)` (was `const stored = ...`); `catch (error) { if (stored) await deleteStoredFile({ ...stored, visibility }); ... }`. `visibility` is the existing in-scope `"PRIVATE" \| "PUBLIC"` request field, matching the signature `deleteStoredFile(media: { storageKey; url; visibility })`. |
| QA-API-001 | Added `CLUB_DOCUMENT_STORAGE_PREFIX` `startsWith` check | **Yes, exactly.** Import added; the 404 guard now also requires `document.media.storageKey.startsWith(CLUB_DOCUMENT_STORAGE_PREFIX)`, matching the pattern cited from the three sibling routes. |
| QA-DB-007 | `deleteCategory()` now counts references across Project, Activity, ImpactMetric, Document, GalleryAlbum, NewsPost and reports the count | **Yes**, with one nuance: the count is taken over **all** rows referencing the category (any status), not only published ones, even though the original finding's `expected`/`actual` prose talked about "published items." The `fix_applied` text itself only says "counts references" with no published-only qualifier, so the implementation matches what was actually promised; it is simply a broader (safer, more informative) count than the narrower framing in the finding's prose. No defect — just worth noting the two documents disagree slightly on scope. |

**Verdict: no fix does something other than its `fix_applied` description claims.** The two
broadenings noted above (QA-FLOW-002's dropped visibility filter, QA-DB-007's all-status count) are
both in the conservative direction (report/block more, not less) and are consistent with what each
`fix_applied` string actually says, even where it is broader than the originating finding's prose.

## 3. Field-name verification for `findDeletionBlocker()` (QA-DB-001 / QA-FLOW-002)

Typecheck passing proves the *types* line up against the generated Prisma client, not that the
client itself was regenerated from a schema with the fields the author intended. Every
`model.field` pair used in the new queries was independently cross-checked against
`prisma/schema.prisma` by reading each model definition directly (not by trusting the client types):

| Query | Model.field(s) used | Confirmed in `prisma/schema.prisma` |
|---|---|---|
| `db.clubDocument.count({ where: { mediaId } })` | `ClubDocument.mediaId` | Yes — line 395, `onDelete: Restrict` |
| `db.projectTaskEvidence.count({ where: { mediaId } })` | `ProjectTaskEvidence.mediaId` | Yes — line 1252, `onDelete: Restrict` |
| `db.donationRequestEvidence.count({ where: { mediaId } })` | `DonationRequestEvidence.mediaId` | Yes — line 1317, `onDelete: Restrict` |
| `db.donationEvidence.count({ where: { mediaId } })` | `DonationEvidence.mediaId` | Yes — line 1444, `onDelete: Restrict` |
| `db.galleryImage.count({ where: { mediaId } })` / `{ mediaId, album: { status: "PUBLISHED" } }` | `GalleryImage.mediaId`, `GalleryImage.album`, `GalleryAlbum.status` | Yes — lines 1814/1817 (`onDelete: Cascade`), 1794 |
| `db.document.count({ where: { OR: [{fileId},{originalFileId},{thumbnailId}], status: "PUBLISHED" } })` | `Document.fileId/originalFileId/thumbnailId/status` | Yes — lines 1556, 1558, 1559, 1567 |
| `db.project.count({ where: { coverId, status: "PUBLISHED" } })` | `Project.coverId/status` | Yes — lines 1045, 1055 |
| `db.activity.count({ where: { coverId, status: "PUBLISHED" } })` | `Activity.coverId/status` | Yes — lines 1471, 1478 |
| `db.newsPost.count({ where: { coverId, status: "PUBLISHED" } })` | `NewsPost.coverId/status` | Yes — lines 1843, 1846 |
| `db.story.count({ where: { coverId, status: "PUBLISHED" } })` | `Story.coverId/status` | Yes — lines 1754, 1762 |
| `db.galleryAlbum.count({ where: { coverId, status: "PUBLISHED" } })` | `GalleryAlbum.coverId/status` | Yes — lines 1790, 1794 |
| `db.trustProfile.count({ where: { OR: [{logoId},{heroImageId}] } })` | `TrustProfile.logoId/heroImageId` | Yes — lines 846/847 (singleton row, no `status` field to filter on — correctly omitted) |
| `db.trustee.count({ where: { photoId, status: "PUBLISHED" } })` | `Trustee.photoId/status` | Yes — lines 911, 928 |

And for QA-DB-007's `deleteCategory()`:

| Query | Confirmed |
|---|---|
| `db.project.count({ where: { categoryId } })` | Yes — `Project.categoryId`, line 1039 |
| `db.activity.count({ where: { categoryId } })` | Yes — `Activity.categoryId`, line 1470 |
| `db.impactMetric.count({ where: { categoryId } })` | Yes — `ImpactMetric.categoryId`, line 1521 |
| `db.document.count({ where: { categoryId } })` | Yes — `Document.categoryId`, line 1551 |
| `db.galleryAlbum.count({ where: { categoryId } })` | Yes — `GalleryAlbum.categoryId`, line 1786 |
| `db.newsPost.count({ where: { categoryId } })` | Yes — `NewsPost.categoryId`, line 1842 |

**All 19 model.field pairs across both functions exist exactly as used.** No wrong field name was
found. This was verified by reading the schema directly, independent of `tsc`, per the brief's
instruction not to rely on typecheck alone (`generated/prisma/*` could theoretically drift from
`schema.prisma` if the client were stale — it was not checked whether the generated client was
freshly regenerated from this exact schema revision, which is a residual, low-probability gap: if
the client on disk predates this schema, typecheck could pass against stale types while the schema
itself is correct. `npx prisma validate` (re-run, evidence below) confirms the schema parses, but
does not confirm client/schema sync — only `prisma generate` or a real query would).

## 4. Reasoning checks

### 4.1 Login account rate limiter — lockout risk (filed as QA-REG-001)

`LOGIN_ACCOUNT_RATE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 }`, keyed on `hashIdentifier(email)`
alone (no IP component). Every `authorize()` call — successful or not — consumes one unit, because
the `rateLimit()` calls run before the credential check. Only the **IP-keyed** counter is cleared on
success; the account-keyed counter is deliberately never cleared (the code comment explains why: to
stop a correct password from resetting an attacker's own budget).

Consequence: a legitimate account that authenticates (successfully or not) 20+ times inside a
rolling hour — a shared coordinator login, multiple staff on multiple devices, a password manager
retrying after a rotated password, or just an unusually active single user — is locked out for the
remainder of the window, with **no in-app reset path**: `resetRateLimit()` exists but is called
nowhere for this key, and no admin action clears a `RateLimit` row. The user sees the same generic
"invalid credentials" response as a wrong password (already filed as QA-AUTH-004), so they cannot
even tell that waiting, not resetting their password, is the correct action.

This is a reasoned, not reproduced, risk — there is no database to drive 21 real login attempts and
observe it. Filed as **QA-REG-001** (Medium/SUSPECTED) in this shard.

### 4.2 `Promise.all` over two `rateLimit()` calls — write-ordering

```
const [limit, accountLimit] = await Promise.all([
  rateLimit(limiterKey, LOGIN_RATE_LIMIT),
  rateLimit(accountLimiterKey, LOGIN_ACCOUNT_RATE_LIMIT),
]);
```

Each `rateLimit()` call is a single atomic `INSERT ... ON CONFLICT DO UPDATE` statement
(`src/lib/rate-limit.ts:24-31`) against a **distinct key** (`login:<hash(ip:email)>` vs.
`login:account:<hash(email)>` — different primary-key values, hence different rows). Running them
concurrently via `Promise.all` does not interleave writes to the same row: Postgres's own row lock
inside each upsert statement is the only concurrency control either call needs, and because the two
calls never touch the same key, there is no lost-update or ordering hazard between them. Two
concurrent login attempts for the same account from different IPs would each independently upsert
the shared `login:account:...` row; each upsert is itself atomic, so counts there are still correct
under concurrency — just serialized by Postgres, not by the application.

The one real difference `Promise.all` introduces: if either query throws (e.g. a transient
connection drop), the combined promise rejects and the exception propagates out of `authorize()`
uncaught (there is no `try/catch` around it, same as before the fix). The fix doubles the per-login
DB round-trips from one rate-limit upsert to two, which proportionally doubles the chance any single
login attempt hits a transient DB error during this phase of the request. This is a minor
resilience/performance observation, not a correctness defect, and not large enough on its own to
file as a separate finding — it is recorded here as reasoning, not as a new `QA-REG` id.

**Conclusion: no write-ordering concern.** The lockout risk in §4.1 is the substantive residual
finding from this file.

### 4.3 `project-operations.tsx` — `closed` still serves its other callers

Confirmed by diff: `const closed = ["APPROVED", "CANCELLED"].includes(task.status);` is unchanged,
and every other consumer of `closed` in the file is untouched —
`disabled={volPending || closed || !unassigned.length}` (assign volunteer),
`disabled={depPending || closed || !predecessors.length}` (add dependency),
`disabled={closed || volPending}` (remove volunteer),
`disabled={closed || depPending}` (remove dependency), and
`{!closed && <form action={statusAction} ...>}` (administrative-status form). The **only** line
changed from `{!closed && ...}` to `{canAcceptEvidence && ...}` is the `TaskEvidenceUpload` block.
The evidence uploader's gate is the only thing that moved; every other `closed`-gated control is
untouched, byte-for-byte, outside that one line.

## 5. Impact analysis (knowledge-graph walk)

`qa/reports/diff-scope.json` already computed the downstream walk for 6 of the 7 changed files (see
§1 process note); its 69-node result is accepted as the base for this pass, cross-checked against
`qa/workflows/knowledge-graph.json` (130 nodes total, 6 `workflow.*` root nodes).

**Every one of the application's 6 top-level workflow nodes is in the downstream set:**
`workflow.admin.login`, `workflow.club.membership`, `workflow.volunteer.servicelog`,
`workflow.project.task`, `workflow.media.publish`, `workflow.donation.intake`. This change set
therefore touches, directly or transitively, the entire application's workflow surface — consistent
with `src/auth.ts` gating every portal's login and `media.ts`/`storage.ts` being shared by every
content and evidence type.

Direct dependents/importers confirmed by reading (not assumed from the graph):
- `src/auth.ts` is spread into every `NextAuth` session everywhere; `src/auth.config.ts`'s only
  importer is `src/auth.ts` (confirmed by grep in the original finding's evidence — unchanged by
  this fix, since the deleted callback had no importer to begin with).
- `findDeletionBlocker()` is private to `media.ts` and called only from `deleteMedia()`, which is
  called from the admin media library action surface (`ui.admin.mediaLibrary` → `svc.actions.admin.media.deleteMedia`).
- `canAcceptEvidence` is local to the `TaskRow` component in `project-operations.tsx`; no other
  component imports it.
- `CLUB_DOCUMENT_STORAGE_PREFIX` is exported from `src/lib/storage.ts` and already used by three
  sibling routes; adding a fourth importer does not change its value or any other consumer.
- `deleteCategory()`'s new count queries are read-only `count()` calls with no side effects beyond
  the pre-existing delete; no migration, index or schema change accompanies any of the 7 files.

**API contracts:** no request or response *shape* changed for any route. `POST /api/admin/upload`
still returns `201`/`toAdminMedia(media)` on success and `500 { error }` on failure — only the
failure path now also deletes the orphaned file server-side, invisible to the client. `GET
/api/club/documents/[id]/file` still returns the file body or a `404`; it now also returns `404` for
one additional case (wrong storage prefix) that was previously only theoretically reachable (no
mutation exists today that could produce it, per QA-API-001's own `uncertainty`). `deleteMedia()` and
`deleteCategory()` both still return the same `ActionState` shape (`{status, message}`); only the
`message` string content changed. No consumer that pattern-matches on exact message text was found
in `src/components/admin/media-library.tsx` or anywhere a category delete result is rendered — both
render `state.message` verbatim. **No breaking contract change for any platform** (web admin is the
only consumer of any of these 7 routes/actions; there is no mobile or third-party client for the
admin surface per `qa/architecture/api-inventory.md`).

**Data entities:** Media, Category, ClubDocument, ProjectTaskEvidence, DonationRequestEvidence,
DonationEvidence, GalleryImage, Document, Project, Activity, NewsPost, Story, GalleryAlbum,
TrustProfile, Trustee — all read via new `count()` queries only. No migration, no schema change, no
stored procedure. `prisma validate` (re-run, §6) confirms the schema the running code targets still
parses.

**UI:** only `project-operations.tsx`'s admin task row changed visually (evidence uploader now
hidden instead of shown-and-failing for SUBMITTED/BLOCKED tasks). `media-library.tsx`'s
delete-confirmation copy (QA-UI-002, still open, not part of this fix set) now undersells how many
*more* cases `deleteMedia()` will refuse — that pre-existing documentation gap got slightly larger,
not smaller, as a side effect of QA-FLOW-002, and is worth folding into QA-UI-002's eventual fix.

## 6. Test selection

**Selected and executed, fresh, for this pass** (all within the explicitly authorized command list):

| Check | Command | Why selected |
|---|---|---|
| Typecheck | `npm run typecheck` | Confirms the Prisma field names in §3 compile against the generated client, and that no file in the change set broke any importer's types |
| Lint | `npm run lint` | Catches unused imports/vars left behind by the diffs (e.g. a stray `closed` or `publishedDocuments` reference) |
| Unit tests | `npm run test:unit` | Re-establishes the 19/19 baseline is unchanged — see caveat below |
| Schema validation | `npx prisma validate` | Confirms `prisma/schema.prisma` still parses after independent manual field verification in §3 |

**Reused from baseline, not re-run:** `npm run build` (exit 0, 29064ms, already captured
post-fix in `qa/reports/evidence/mechanical/build.log` — `analyze.mjs` marks `build` as `safe: false`
and it is not in this phase's explicitly authorized command list, so the existing passing evidence is
cited rather than re-triggered), `npm audit --audit-level=high` and the secret scanner (both already
green in `qa/reports/evidence/mechanical/{npm-audit,secret-scan}.log`, unrelated to any of the 7
changed files, and likewise not in the authorized re-run list for this phase).

**Deliberately excluded:**
- **Any runtime/integration/E2E test of the fixed behavior itself** — logging in 21 times to trigger
  QA-REG-001, deleting media/categories to see the new blocker messages, uploading through
  `/api/admin/upload` to see the compensating delete fire, or downloading through the club-documents
  route — all require a database. The environment constraint explicitly forbids starting one. These
  are **untested dependencies**, not passes (§7).
- **`route-smoke`** — `qa/reports/route-smoke.json` is `DISCOVERY_ONLY` (route inventory, zero HTTP
  requests made); running it for real requires a live server, which is outside the authorized command
  set.
- **The existing `test:unit` suite's relevance** — all 19 tests live in
  `src/lib/approval/definition.test.ts`, `src/lib/validations/fundraising.test.ts`,
  `src/lib/validations/donations.test.ts`, `src/server/payments/provider.test.ts`,
  `src/lib/finance/chart.test.ts`, `src/lib/finance/journal-core.test.ts` (from the `test:unit` script
  in `package.json`). **None of these files import or exercise any of the 7 changed files.** The
  19/19 PASS result proves nothing broke in those six unrelated modules; it is not functional
  regression coverage for any of the 8 fixes, consistent with the pre-existing QA-TEST-003 finding
  (no API route handler has automated coverage). This is stated plainly so the PASS count is not
  mistaken for evidence the fixes work at runtime.
- **The DB-backed `test:*:db` / `test:*:headed` scripts** (`test:club:db`, `test:volunteer:db`,
  `test:project:db`, `test:donations:db`, `test:fundraising:db`, `test:approval:db`, and their
  `:headed` counterparts) — all require the database and/or a browser; explicitly out of scope.

## 7. Results

| test_id | type | status | command | exit_code | duration_ms | evidence |
|---|---|---|---|---|---|---|
| REG-typecheck | integration | EXECUTED-PASS | `npm run typecheck` | 0 | 16250 | `qa/reports/evidence/regression-001/typecheck.log` |
| REG-lint | integration | EXECUTED-PASS | `npm run lint` | 0 | 13767 | `qa/reports/evidence/regression-001/lint.log` |
| REG-test-unit | unit | EXECUTED-PASS | `npm run test:unit` | 0 | 1143 | `qa/reports/evidence/regression-001/test-unit.log` (19 tests, 19 pass, 0 fail) |
| REG-prisma-validate | schema | EXECUTED-PASS | `npx prisma validate` | 0 | 3150 | `qa/reports/evidence/regression-001/prisma-validate.log` |
| REG-schema-field-audit | static/manual | EXECUTED-PASS | manual cross-reference, §3 of this report | n/a | n/a | this file, §3 — 19/19 model.field pairs confirmed present in `prisma/schema.prisma` |
| REG-diff-vs-claim | static/manual | EXECUTED-PASS | `diff -u` against `qa/reports/evidence/pre-fix-backup/**`, §2 | n/a | n/a | this file, §2 — 8/8 fixes match their `fix_applied` claim |
| MECH-build (reused) | integration | EXECUTED-PASS | `npm run build` | 0 | 29064 | `qa/reports/evidence/mechanical/build.log` (captured by the prior mechanical pass, post-fix) |
| MECH-npm-audit (reused) | security | EXECUTED-PASS | `npm audit --audit-level=high` | — | — | `qa/reports/evidence/mechanical/npm-audit.log` ("found 0 vulnerabilities") |
| MECH-secret-scan (reused) | security | EXECUTED-PASS | secret-scan.mjs | — | — | `qa/reports/evidence/mechanical/secret-scan.log` (only pre-existing Low findings in `scripts/verify-*-ui.ts`, unrelated to this change set) |
| REG-login-lockout | security/logic | BLOCKED | n/a | — | — | reason: requires a database to drive 21 login attempts; see QA-REG-001 |
| REG-media-delete-blockers | integration | BLOCKED | n/a | — | — | reason: requires a database and seeded Media/evidence rows to exercise `findDeletionBlocker()`'s 6 branches |
| REG-category-delete-count | integration | BLOCKED | n/a | — | — | reason: requires a database and seeded content rows |
| REG-upload-compensation | integration | BLOCKED | n/a | — | — | reason: requires fault-injecting `db.media.create` against a real database |
| REG-club-doc-prefix | api | BLOCKED | n/a | — | — | reason: requires a database and a real ClubDocument/Media row to request |
| REG-task-evidence-visibility | e2e-web | BLOCKED | n/a | — | — | reason: requires a database, an authenticated admin session and a seeded task in each status |

## 8. Baseline comparison

Baseline source: `qa/reports/mechanical-analysis.json` (generated 2026-11-16T12:11:55Z, states
"typecheck/lint/test:unit/prisma validate/npm-audit/secret-scan all PASS, build PASS after the
fixes" — i.e. this baseline was already captured *after* the 8 fixes were applied).
`qa/reports/test-execution.md` does not exist in this repository, so there is no separate
pre-fix-vs-post-fix functional test-execution baseline to diff against beyond the mechanical one.

| Check | Baseline (post-fix, prior pass) | This pass | Verdict |
|---|---|---|---|
| typecheck | PASS | PASS (0, 16250ms) | Unchanged — green both times |
| lint | PASS | PASS (0, 13767ms) | Unchanged — green both times |
| test:unit | PASS, 19/19 | PASS, 19/19 (0, 1143ms) | Unchanged — green both times, **and still not covering any of the 7 changed files** |
| prisma validate | PASS | PASS (0, 3150ms) | Unchanged — green both times |
| build | PASS (29064ms) | Not re-run (see §6) | Reused — no reason to doubt it given typecheck/lint are unchanged-green on the same tree |
| npm audit | PASS, 0 vulnerabilities | Not re-run (see §6) | Reused |
| secret scan | PASS (pre-existing Low findings only) | Not re-run (see §6) | Reused |
| Functional/runtime coverage of the 8 fixes | None executed (no DB in either pass) | None executed (no DB in either pass) | **No change — was a coverage gap before this pass, remains one after it** |

No check regressed (passed-before/fails-now). No check newly passed that was previously failing —
all six mechanical checks were already green going into this pass. The only movement is additive:
two new static-verification passes (§2 diff-vs-claim, §3 schema field audit) that did not exist as
recorded evidence before this report.

## 9. Untested dependencies (not passes — explicitly unverified)

Every item below is downstream of this change set per `qa/reports/diff-scope.json` /
`qa/workflows/knowledge-graph.json`, and **none of it was exercised at runtime**, because no
database was available and none may be started in this environment:

- **`workflow.admin.login`** — the actual fixed behavior (two independent rate limiters, the
  lockout risk in §4.1, the dummy-hash timing-safe path, the activity-log write on success) was
  never driven end-to-end.
- **`workflow.media.publish`** — `deleteMedia()`'s 6 new blocker branches (4 Restrict tables,
  GalleryImage Cascade, 8-way published-SetNull union) were verified only by static type/field
  checking, never by actually seeding a Media row with each kind of reference and attempting a
  delete.
- **`workflow.project.task`** — the admin task row's evidence-uploader visibility change
  (`canAcceptEvidence`) was never rendered against a real task in each status (TODO, IN_PROGRESS,
  SUBMITTED, BLOCKED, APPROVED, CANCELLED) to confirm the control appears/disappears as intended.
- **`workflow.club.membership`** — the hardened `/api/club/documents/[id]/file` route was never
  requested against a real `ClubDocument`/`Media` pair to confirm the new prefix check still serves
  legitimate files and still 404s on everything else.
- **`workflow.volunteer.servicelog`** and **`workflow.donation.intake`** — both are downstream of
  the login fix (every portal login shares `src/auth.ts`) and of the media/evidence changes (donation
  and volunteer evidence tables are among the 4 Restrict tables `findDeletionBlocker()` now checks);
  neither workflow's own logic changed, but neither was re-driven end-to-end either.
- **`deleteCategory()`'s new count-and-report path** — never run against a category actually
  referenced by rows in all 6 tables simultaneously.
- **The `POST /api/admin/upload` compensating delete** — never fault-injected against a real
  `db.media.create` failure to confirm `deleteStoredFile` actually removes the orphaned blob/file.
- **Authorization matrix re-test** — `qa/reports/diff-scope.json`'s own `suggestedChecks` calls for
  re-testing every role against every protected operation after an auth change; this was not done at
  runtime for the same reason (no DB, no session to mint).
- **Route-smoke** — never run in HTTP mode (see §6); `route-smoke.json` remains `DISCOVERY_ONLY`.

These are coverage gaps carried forward from an environment constraint, not results — they must not
be read as passing.

## 10. Remaining risk after this run

1. **QA-REG-001 (new, Medium/SUSPECTED):** the QA-AUTH-001 fix's account-level limiter has no reset
   path and can, in principle, lock out a legitimate high-traffic or shared account for up to an
   hour. Not reproduced (no DB); recommend a DB-backed test plus an admin override action before
   relying on this in production under real traffic.
2. **Every one of the 8 fixes is unverified at runtime.** All verification in this pass is static
   (diff review, schema cross-reference, type/lint/unit-test re-run). The mechanical gates agree
   with the pre-existing post-fix baseline, which is good evidence of *non-regression in the
   unrelated parts of the codebase*, but it is not evidence that `findDeletionBlocker()`'s 6
   branches, the two-limiter login path, the compensating upload delete, or the club-document prefix
   check actually behave correctly against real data. QA-TEST-003 (no route-handler test coverage)
   remains open and squarely explains why: nothing in the automated suite would have caught a defect
   in any of these 7 files even before this pass.
3. **QA-REG-002 (new, Low):** `diff-scope.json` is stale by one file; low risk on its own, but worth
   fixing before the next regression cycle leans on it.
4. **QA-UI-002 (pre-existing, unchanged):** the media-library delete-confirmation copy was already
   wrong about one refusal case before this fix set; `findDeletionBlocker()` just gave it five more
   refusal cases to not describe. No new severity assigned — folding this observation into the
   existing finding is enough — but it should be considered when QA-UI-002 is eventually fixed.
5. **Prisma client/schema sync was assumed, not independently confirmed** (§3) — `prisma validate`
   checks the schema file parses; it does not prove the generated client in
   `src/generated/prisma` was built from this exact schema revision. Typecheck passing is consistent
   with sync but is not independent proof of it.

## 11. Verdict

**Ship, conditionally.** All 8 fixes do exactly what their `fix_applied` descriptions claim; the
one Prisma-field-heavy fix (`findDeletionBlocker()`, QA-DB-001/QA-FLOW-002) was independently
verified field-by-field against `prisma/schema.prisma` rather than trusting typecheck, and every one
of its 19 `model.field` references is real. No regression was found in the unrelated parts of the
codebase that mechanical checks can see (typecheck, lint, 19/19 unit tests, schema validation all
green, matching the already-green post-fix baseline).

The condition: **none of the 8 fixes has been exercised against a real database.** This phase could
not do so under the stated constraints, and that gap is not closed by a green mechanical run. Before
this change set reaches production, run — in an isolated environment with a disposable database —
at minimum: the 21-attempt login-lockout scenario (QA-REG-001), one delete attempt per
`findDeletionBlocker()` branch (6 scenarios), the club-document file route against both a matching
and a cross-flow `storageKey`, the admin-upload compensating delete under a forced `db.media.create`
failure, and the evidence-uploader visibility across all six task statuses. Treat every item in §9
as unverified, not passing, until that run happens.
