# Trustfolio — QA Quality Assessment

Run mode: **`map`** (phases 0–7). Delegated to specialized subagents; phase 4 skipped — no mobile
layer exists. Static analysis plus the project's own mechanical checks. **No application server or
database was started**, so nothing here is a reproduced runtime failure.

## 1. Scope covered

| Phase | Agent | Covered |
|---|---|---|
| 0 | orchestrator | Workspace init, discovery scan, requirement extraction, mechanical analysis, secret scan, env-bootstrap plan, route enumeration |
| 1 | `qa-discovery` | Technology, module seams, entry points, role matrix, background work |
| 2 | `qa-requirements-analyst` | 120 candidates → 47 requirements traced to code |
| 3 | `qa-frontend-auditor` | ~38 UI elements audited in depth across admin CRUD, portal forms, public listings |
| 4 | — | **Skipped**: no mobile project |
| 5 | `qa-backend-auditor` | 12 API routes + 19 server-action modules (79 exported entry points) |
| 6 | `qa-data-auditor` | 63 models, 134 `onDelete` declarations, 7 migrations, 9 soft-delete read sites |
| 7 | `qa-workflow-analyst` | 6 workflows end to end; 130-node knowledge graph; 26 cross-module dependencies |

Not covered: runtime verification (phase 8), test generation and execution (phase 9), regression
(phase 11). The `check:db` suite — the project's real integration coverage — never ran.

## 2. Mechanical baseline

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Unit tests | `npm run test:unit` | PASS (6 files) |
| Schema | `npx prisma validate` | PASS |
| Dependency audit | `npm audit --audit-level=high` | PASS |
| Secret scan | built-in | 7 hits: 2 High (local `.env`, CI credential), 5 Low (templates, fixtures) |
| Build | `npm run build` | SKIPPED — gated |
| DB suite | `npm run check:db` | SKIPPED — no authorized database |

## 3. Findings — 42 total

**1 High · 19 Medium · 16 Low · 6 Informational.** 38 CONFIRMED, 4 SUSPECTED.

| Area | Count | Theme |
|---|---|---|
| `QA-FLOW-*` | 11 | Cross-layer contradictions only the workflow view exposes |
| `QA-DB-*` + `QA-DATA-*` | 8 | Delete-path guards, unindexed FKs, media/storage divergence |
| `QA-REQ-*` | 7 | Documented rules vs implementation: 2 VIOLATED, 5 PARTIAL |
| `QA-UI-*` + `QA-I18N-*` | 6 | UX and consistency; server enforces correctly in every case |
| `QA-API-*` | 4 | Consistency and unbounded lists; authorization verified sound |
| `QA-AUTH-*` | 3 | Login rate limiting |
| `QA-TEST-*`, `QA-NOTIFY-*`, `QA-PROCESS-*` | 3 | Coverage gap, undelivered notifications, QA process |

### The one High

**QA-AUTH-001** — login has no per-account rate limiter; the only counter is keyed on
`(IP, email)`, so attempts distributed across source addresses get 5 tries each against one known
admin email. The codebase already uses an IP-independent per-email limiter for the contact form
(`src/server/actions/contact.ts:60`); login is the path where it matters most and does not have it.

### The findings a code-derived audit could not have produced

- **QA-REQ-004** (VIOLATED) — `relationshipVerified` is a bare checkbox that renders a public
  badge reading "Relationship confirmed by the trust", storing no document, actor or date. Every
  comparable claim in the system carries an evidence rule. `scripts/audit-demo.ts:113` asserts no
  demo testimonial is marked verified, so the authors already treat it as a verification claim.
- **QA-REQ-006** (VIOLATED as documented) — `/club/[id]` renders every member's name **and email**
  to the coordinator, while two documents state a coordinator sees only opted-in skills.
- **QA-FLOW-001** — the admin task row enables the evidence uploader on `SUBMITTED` tasks, but the
  service rejects any status outside `TODO`/`IN_PROGRESS`, and that check sits *above* the ADMIN
  bypass. The control is visible, enabled, and returns 409 every time — exactly when a reviewer
  wants it. The volunteer component gets the same gate right.
- **QA-FLOW-004** — `ClubMembership.SUSPENDED` is a dead end: cannot be reinstated, ended, or
  re-applied for, and it silently revokes all derived volunteer and project access.
- **QA-FLOW-008** — three of the six unit-test files cover modules with **zero importers** in
  `src/`, while the CI gate executes no line of any of the six traced workflows.

### Verified negatives worth recording

These were hypotheses raised by earlier phases and **disproved** with evidence:

- All 8 portal pages under `/club`, `/volunteer`, `/donor` call `getAdminUser()` first and
  redirect on null; every detail page adds the correct scope helper. The proxy exclusion
  (`src/proxy.ts:27`) is not an authentication gap.
- All 79 exported server actions are guarded. No unguarded remotely-invokable action.
- Of 134 `onDelete` declarations only **2** are `Cascade`; history tables are additionally
  protected by SQL `BEFORE UPDATE OR DELETE` triggers. No cascade silently deletes an audit trail.
- All 9 soft-delete read sites filter `archivedAt: null`.
- All 7 migrations are non-destructive; every `NOT NULL` addition carries a `DEFAULT`.
- `maxLength` attributes across 6 admin form modules match their Zod `max()` counterparts exactly.

## 4. Coverage gaps and remaining risk

1. **Nothing was executed against a database or a browser.** Every finding rests on code reading
   plus five mechanical checks. "CONFIRMED" here means the mismatch is a plain fact of the source,
   not a reproduced runtime failure.
2. **4 SUSPECTED findings need a specific experiment** to settle, each named in its `uncertainty`
   field: forged-XFF against a deployed environment; the donation idempotency replay window;
   QA-FLOW-007's reachability; the volunteer `serviceDate` timezone edge.
3. **Six workflows traced, more exist.** Public publication for 7 content models, fundraising,
   approval activation, notification delivery, club contribution reporting and the Vercel Blob
   storage path are all untraced — each with its required evidence listed in
   `qa/workflows/user-journeys.md`.
4. **124 of 162 components unaudited.** The UI audit covered ~38 elements by risk.
5. **`src/lib/validations/admin.ts` has now been deferred three times.** Admin publication guards
   (consent, redaction, impact-metric evidence) are the largest single untraced surface.
6. **No test coverage exists for any of this.** QA-TEST-003 and QA-FLOW-008 together mean the CI
   gate would not catch a regression in any workflow described here.

## 5. Recommended order of work

1. **QA-AUTH-001** — add the per-account limiter. Smallest diff, largest risk reduction, and the
   pattern already exists in the codebase.
2. **QA-FLOW-001** — one-line gate correction; a reviewer-facing control that always fails.
3. **QA-DB-001 / QA-FLOW-002** — extend `deleteMedia()` beyond published documents. The real risk
   is the single `Cascade` silently removing a photo from a published gallery.
4. **QA-REQ-004 / QA-REQ-006** — decide which side is wrong: tighten the code, or correct the
   document. Both are product decisions, not engineering ones.
5. **QA-TEST-003** — route-handler authz tests. The 404-not-403 convention makes expected values
   unambiguous, so these are cheap to write and guard the highest-risk code.
6. Run phases 8–9 (`runtime`, `test`) once a test database is available —
   `node <skill>/scripts/env-bootstrap.mjs --run --migrate` has the exact configuration from CI.

This assessment does not establish that the application is defect-free or production-ready. It
reports what was verified, with evidence, and what was not.
