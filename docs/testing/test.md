# Trustfolio expansion test strategy and case register

Status: **Phase 1 draft-engine, Phase 2 club and Phase 3 volunteer checks executed; full case register remains open**. Updated: 2026-10-26. Case status values are `NOT_RUN`, `PASSED`, `FAILED`, `SKIPPED`, `BLOCKED`. A case is `PASSED` only with an executed command/browser run, environment and evidence reference. Functional requirement IDs refer to `../requirements/trustfolio-frd.md`.

## Test layers and environments

| Layer | Purpose | Required setup/evidence |
| --- | --- | --- |
| Unit | State transition, amount parsing, policy evaluation, public eligibility and error mapping. | Deterministic fixtures; assertion output and commit under test. |
| Integration | Server action/route, permission and file boundaries. | Isolated test database/storage, actual auth/session boundary, HTTP response evidence. |
| Database transaction | Unique keys, balanced journal, rollback, locking, serializable spending, period close. | Disposable PostgreSQL matching production major version; concurrent process traces. |
| Payment sandbox | Authentic signature, out-of-order/duplicate events, status lookup, refunds/settlement. | Provider sandbox credentials, redacted event IDs and reconciliation report. |
| Playwright E2E | Each portal and public regression, both locales, responsive/accessibility flow. | Isolated seeded test data; screenshots/traces; system Chrome headed via `channel: "chrome"` when supported. |
| Security | IDOR/scope, CSRF/origin, file access, data leakage, rate limit, malicious upload, safe errors. | Direct requests as each actor, not only hidden UI controls. |

Never point destructive fixtures or simulated payments at production. Demo content remains labeled and is never used to prove official figures. Baseline commands are `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run build` on Windows; the existing build may need network access for Google Fonts. Phase 1 adds focused approval unit, isolated PostgreSQL migration and headed Chrome browser scripts. These do not replace the later full portal/payment/finance suites.

## Core case register

The rows below are full end-to-end requirements; none is marked `PASSED` merely because a draft-only subset passed. Phase 1 subset results are recorded after the case register.

| Case ID | Requirement | Positive, negative and boundary assertion | Layer / phase | Status |
| --- | --- | --- | --- | --- |
| T-IDN-01 | FR-IDN-01 | One account holds two roles; each portal exposes only its granted data; revocation takes effect without waiting for JWT expiry. | Integration/E2E, 1 | NOT_RUN |
| T-IDN-02 | FR-IDN-02 | Registration/invitation verifies contact and consent; unapproved user gets no club/project access; invalid/duplicate token rejected. | Integration/E2E, 1/3 | NOT_RUN |
| T-CLB-01 | FR-CLB-01/02 | Club code unique; archive retains history; one volunteer joins multiple clubs; duplicate active membership and unauthorized approval fail. | DB/E2E, 2/3 | NOT_RUN |
| T-CLB-02 | FR-CLB-03 | Several clubs join one existing project; one club joins several projects; coordinator for Club A cannot inspect Club B private data. | Permission/E2E, 4 | NOT_RUN |
| T-VOL-01 | FR-VOL-01/02 | Profile privacy, availability, attendance and service hours are scoped; duplicate attendance and unreviewed hour claims do not enter approved totals. | Integration/E2E, 3 | NOT_RUN |
| T-PRJ-01 | FR-PRJ-01/02 | Old project slug and public content remain; operational state may change without publication; draft project remains absent from public list. | Regression/E2E, 4 | NOT_RUN |
| T-TSK-01 | FR-TSK-01/02 | Assigned volunteer updates allowed fields; unauthorized volunteer cannot modify task; dependency cycle, stale update and overdue derivation handled. | Unit/permission/E2E, 4 | NOT_RUN |
| T-FND-01 | FR-FND-01/02 | Multiple requests per project; returned request keeps reason; approved request is not an active public campaign; publication checks evidence. | Integration/E2E, 5 | NOT_RUN |
| T-DON-01 | FR-DON-01/02 | Donor owns profile/receipts; signed successful payment confirms once; forged signature, altered amount and duplicate/out-of-order webhooks cannot post twice. | Security/sandbox/DB, 6 | NOT_RUN |
| T-DON-02 | FR-DON-03 | Cash, bank and UPI entry needs distinct checker/evidence; unverified entry is excluded from confirmed totals, journal and receipt. | Integration/DB, 6 | NOT_RUN |
| T-DON-03 | FR-DON-04/05 | Pending/failed payments do not increase totals; partial/full refund and dispute preserve history; recurring charge, if enabled, verifies separately. | Sandbox/DB, 6 | NOT_RUN |
| T-FIN-01 | FR-FIN-01/03 | Journal with unequal totals or missing source fails atomically; valid posting balances; repeated source returns original outcome. | Unit/DB, 7 | NOT_RUN |
| T-FIN-02 | FR-FIN-02/03 | Restricted donation cannot fund unauthorized expense; reversal links original and does not mutate it; closed period rejects posting. | DB/permission, 7 | NOT_RUN |
| T-FIN-03 | FR-FIN-04/05 | At budget/fund boundary, only one of two concurrent expense commitments can consume remaining balance; failed transaction rolls back all rows. | Concurrent DB, 7 | NOT_RUN |
| T-FIN-04 | FR-FIN-06/07 | Duplicate statement import rejected; unmatched settlement visible; trial balance zero; reports tie to journals/funds; receipts match confirmed donations. | DB/report, 8 | NOT_RUN |
| T-APR-01 | FR-APR-01/02 | ANY, ALL and sequential policies advance correctly; amount boundary selects correct policy version; delegation and self-approval rules enforced. | Unit/integration, 1 | NOT_RUN |
| T-APR-02 | FR-APR-02 | Simultaneous approve/reject, duplicate decision, cancellation and stale version yield one valid transition and immutable history. | Concurrent DB, 1 | NOT_RUN |
| T-PUB-01 | FR-PUB-01/02 | Public totals exclude pending, failed, private, disputed or otherwise ineligible data per approved policy; no donor/volunteer/bank/internal comments in HTML/API/export. | Security/E2E, 8 | NOT_RUN |
| T-PUB-02 | FR-PUB-03 | Published document cannot lose its required file; private/draft-only verification does not count as accessible evidence; demo banner/noindex covers every visible demo type. | Integration/E2E, 1 | NOT_RUN |
| T-NTF-01 | FR-NTF-01/FR-AUD-01 | Failed notification retries without duplicating transaction; financial audit event persists with source and actor; unauthorized audit read fails. | Integration/DB, 1/6 | NOT_RUN |
| T-UI-01 | All portals | Admin, club, volunteer and donor portals tested independently at mobile/desktop, keyboard-only, empty/error/loading states and safe direct URL access. | Chrome headed E2E, 2–9 | NOT_RUN |
| T-I18N-01 | FR-TRU-01/FR-PUB-01 | `/en` and `/ta` new/existing pages render, human Tamil copy or explicit English fallback; locale switching preserves record context. | E2E, each phase | NOT_RUN |
| T-REG-01 | FR-TRU-01/FR-PRJ-01 | Existing projects, activities, evidence, documents, search, contact, admin content editor and cache invalidation remain functional. | Regression E2E, each phase | NOT_RUN |
| T-OPS-01 | SRS operations | Backup/restore rehearsal recovers database and private files consistently; deployment disable flag blocks new collection while preserving reads/history. | Ops rehearsal, 9 | NOT_RUN |

## Boundary and failure catalog

Generate exact amount tests at zero, smallest accepted unit, configured maximum, threshold minus/equal/plus, currency mismatch and refund greater than net balance. Generate temporal tests at campaign start/end, midnight in approved timezone, fiscal close and daylight-saving boundaries if applicable. Test duplicate references, missing foreign keys, archived/suspended actors, deleted media, invalid MIME/signature, file size limits, malformed provider payload, network timeout before/after provider success, database rollback after webhook acceptance, and report exports at empty/large page sizes.

Test structured safe errors for validation, unauthenticated/forbidden, missing record, duplicate, stale version, invalid transition, payment gateway failure, ledger imbalance, insufficient fund, closed period, reconciliation difference and notification failure. Assert no stack trace, private fields or secrets reach the client. A non-idempotent operation must not retry automatically; an uncertain outcome uses status lookup and operator queue.

## Execution record template

For each executed case record: case ID; linked requirement; branch/commit; environment and database fixture; date/time; command or manual steps; expected and actual outcome; `PASSED/FAILED/SKIPPED/BLOCKED`; screenshot/trace/log/reference with secrets removed; defect ID; reviewer. Maintain a phase summary of totals and residual risks.

## Phase 1 draft-only execution record — 2026-10-25

Environment: local Windows development workspace, PostgreSQL 18.6 on `127.0.0.1`, disposable test schemas for database and browser checks, installed system Chrome for headed Playwright. The application migration was also applied additively to the local development schema; `npx.cmd prisma migrate status` reported three migrations and schema up to date. A read-only count then showed eight proposed groups, zero memberships, zero policies, zero instances and zero delegations. No production environment or payment provider was used. The executable scripts in this working tree are the evidence references; this work is not yet a commit.

| Subset / evidence | Command | Result | Scope actually checked |
| --- | --- | --- | --- |
| FR-APR-01/02 draft policy rules, `src/lib/approval/definition.test.ts` | `npm.cmd run test:approval` | **PASSED, 6/6** | Exact amount boundaries, invalid definitions, ANY/ALL, no self-approval, stale group grants, disabled delegation/activation, missing/overlapping policies. |
| FR-APR-02/FR-AUD-01 storage, `scripts/verify-approval-migration.ts` | `npm.cmd run test:approval:db` | **PASSED** | Disposable schema applied; proposed groups only, zero active authority, append-only decision/audit guards, duplicate decision and stale policy-version constraints. |
| FR-APR-01 draft UI and current content access, `scripts/verify-approval-ui.ts` | `npm.cmd run test:approval:headed` | **PASSED** | Admin draft builder/simulation in visible Chrome; existing public `/en`; editor denied draft administration; test schema has no active policy/membership/instance. |
| Static checks | `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build` | **PASSED** | ESLint, TypeScript and production compilation, including the new `/admin/approvals` route. |

At the Phase 1 gate, full `T-APR-01/02` live decision, delegation, cancellation and concurrent transition scenarios were **BLOCKED** by the deliberate server-side live gate and unresolved policy authority. `T-IDN-01`, `T-NTF-01` delivery, `T-PUB-02` safeguard repairs and all club, volunteer, payment, finance and full portal cases were **NOT_RUN**. The headed check was a narrow smoke test, not independent coverage of every portal or locale. The three publication/evidence/demo defects identified in Phase 0 remain documented and unchanged under the user's instruction.

## Phase 2 club execution record — 2026-10-26

Environment: local Windows workspace, PostgreSQL 18.6 on `127.0.0.1`, fresh disposable schema per database/headed run, and visible system Chrome via Playwright `channel: "chrome"`. No production database or real club member was used. The additive Phase 2 migration was applied to the local development schema; `npx.cmd prisma migrate status` showed four migrations and up-to-date schema. Read-only counts immediately after migration: **zero clubs, memberships, club documents, portal users and active approval policies**. The scripts in this working tree are the evidence references; no commit or external review is claimed.

| Subset / evidence | Command | Final result | Actual checks |
| --- | --- | --- | --- |
| FR-CLB-01/02 storage, `scripts/verify-club-migration.ts` | `npm.cmd run test:club:db` | **PASSED** | Additive migration on disposable schema; `PORTAL_USER` enum; draft defaults; unique club code and club/user pair; one account in two clubs; active consent guard; append-only membership history. |
| FR-CLB-01/02, FR-PUB-02, `scripts/verify-club-ui.ts` | `npm.cmd run test:club:headed` | **PASSED** | Admin create/activate/invite/approve/appoint, adult and data-use attestation, no self-approval, stale-version denial, coordinator of Club B denied Club A, private file and unauthorized upload denial, club file excluded from legacy editor media list/read, suspension, archive retention, `/en` and `/ta` public smoke checks. |
| Phase 1 authorization regression | `npm.cmd run test:approval`; `npm.cmd run test:approval:db`; `npm.cmd run test:approval:headed` | **PASSED** | Six approval unit cases, isolated migration constraints, draft builder and editor denial under the expanded account enum. |
| Static and migration checks | `npx.cmd prisma validate`; `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`; `npx.cmd prisma migrate status` | **PASSED** | Schema validation, ESLint, TypeScript, production route compilation and local migration state. |

The headed script had three intermediate **FAILED** runs while its assertions waited for a message removed by page revalidation, treated a hidden HTML option as visible, and queried immediately before an archive action completed. The assertions were corrected to wait for resulting state; the final expanded run passed. No application defect was established by those failures.

Full `T-CLB-01` remains **NOT_RUN** as a volunteer-specific end-to-end case until Phase 3 identity/profile work exists. `T-CLB-02` project assignments remain **BLOCKED** until Phase 4. Full `T-UI-01` and `T-I18N-01` remain **NOT_RUN** across all planned portals and Tamil interface copy; this run only checked the new English club UI and old `/en`/`/ta` pages. External invitation/decision delivery, independently verified age, backup/restore rehearsal, club performance from projects, and public club publication were **NOT_RUN** or outside Phase 2 scope. The three existing public evidence/demo safeguard defects remain unchanged.

## Phase 3 volunteer execution record — 2026-10-26

Environment: local Windows workspace, PostgreSQL 18.6 on `127.0.0.1`, fresh disposable schema per database/headed run and visible system Chrome through Playwright `channel: "chrome"`. The additive `20261026054227_phase3_volunteers` migration was tested in isolation, then applied to the local development schema. `prisma migrate status` reports five migrations and up-to-date schema; `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reports no schema difference. A read-only query after migration found zero local volunteer profiles, attendance rows and service logs. No production data or actual volunteer identity was used. The scripts in this working tree are evidence references; no commit or external review is claimed.

| Subset / evidence | Command | Final result | Actual checks |
| --- | --- | --- | --- |
| FR-VOL-01/02 storage, `scripts/verify-volunteer-migration.ts` | `npm.cmd run test:volunteer:db` | **PASSED** | Full migrations apply to disposable schema; unique profile and attendance-linked hours; availability/day bounds; duplicate open activity denied; minutes bound; reviewed-state constraints; append-only review history. |
| FR-VOL-01/02, FR-PUB-02, `scripts/verify-volunteer-ui.ts` | `npm.cmd run test:volunteer:headed` | **PASSED** | Adult/consent profile, availability, opt-in/opt-out club-scoped skills, cross-club attendance denial, attendance and hours trust-admin review, approved-only/void-corrected total, self-review denial, editor admin denial and no public volunteer email. |
| Static and migration checks | `npx.cmd prisma validate`; `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`; `npx.cmd prisma migrate status`; `npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`; `git diff --check` | **PASSED** | Schema validation, lint, TypeScript, production route compilation, local migration state/schema parity and whitespace. |
| Shared sign-in and club regression | `npm.cmd run test:club:headed` | **PASSED** | Existing club workflow, cross-club scope, private media denial and `/en`/`/ta` public smoke after Phase 3 auth/proxy changes. |

Two intermediate headed runs **FAILED** because the test navigated before the coordinator login redirect completed. Another intermediate run **FAILED** because its exact label selector did not match the club select. The harness now waits for login and uses the select name; the final expanded run passed. These failures did not establish an application defect.

Full `T-IDN-02` remains **NOT_RUN** because new-account/contact verification and donor registration are later decisions. Full `T-VOL-01` remains **NOT_RUN** for project/task attribution and certificate issuance; its Phase 3 club-based subset above passed. `T-CLB-01` multi-club volunteer membership was already exercised at database level in Phase 2, but a complete volunteer multi-club browser flow remains **NOT_RUN**. Full `T-UI-01` and `T-I18N-01` remain **NOT_RUN** across all portals and Tamil interface copy. External notification delivery, independently verified age, backup/restore, project assignments, public volunteer opportunities and the three existing public evidence/demo safeguard repairs remain pending.

## Phase 4 project execution record — 2026-10-26

Environment: local Windows workspace, PostgreSQL on `127.0.0.1`, disposable schema per database and headed browser run, system Chrome through Playwright `channel: "chrome"`. The additive `20261026060814_phase4_projects_tasks` migration was applied to the local development database only after its isolated test. `prisma migrate status` reported six migrations and up-to-date schema; the datasource/schema diff was empty. No production database or actual project, club or volunteer record was changed by the browser tests. The scripts in this working tree are the evidence references.

| Subset / evidence | Command | Final result | Actual checks |
| --- | --- | --- | --- |
| FR-CLB-03/PRJ-01/TSK-01 database, `scripts/verify-project-migration.ts` | `npm.cmd run test:project:db` | **PASSED** | Full migration on disposable schema; two clubs on one project and one club on two projects; unique project/club pair; plan schedule and task state constraints; no self-dependency; immutable assignment/task history; public status independent of operational status. |
| FR-CLB-03/TSK-01 scoped portal flow, `scripts/verify-project-ui.ts` | `npm.cmd run test:project:headed` | **PASSED** | Coordinator own assignment/tasks and other-club denial; volunteer own task and other-club denial; private PDF evidence upload, authorized volunteer/coordinator read and unrelated-club denial; 100% submission and independent ADMIN review; existing `Project.status` remains DRAFT. |
| Existing club/public regression, `scripts/verify-club-ui.ts` | `npm.cmd run test:club:headed` | **PASSED** | Existing club create/membership/private-file guards, cross-club denial, suspension/archive and public `/en`/`/ta` smoke after Phase 4. |
| Static, build and migration checks | `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`; `npx.cmd prisma migrate status`; `npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`; `git diff --check` | **PASSED** | ESLint, TypeScript, production route compilation, local migration parity and whitespace. |

The first headed Phase 4 run **FAILED** because an ambiguous test locator matched the task title in three places; the locator was narrowed to the heading. Two evidence checks then **FAILED** because the test harness waited for a transient UI message and used a short `AUTH_SECRET`; the harness now inspects the upload response and supplies a valid test secret. A later run exposed an application defect in the stricter upload origin comparison: Next's `nextUrl.origin` differed from the actual incoming origin. The route now checks the incoming request URL protocol and host header; the final expanded run passed. The database and headed cases above are focused subsets, not proof of all `T-PRJ-01`, `T-TSK-01` or `T-REG-01` outcomes. Full concurrency stress, task dependency cycles through the UI, private evidence read across every role, notification delivery, all portal locales, project completion/publication regression with real published data, and backup/restore remain **NOT_RUN**. Public completion reports, monetary budgets and certificates remain outside Phase 4. The three previously documented public evidence/demo safeguard defects remain unchanged.

## Phase 5 private fundraising draft execution record — 2026-10-26

Environment: local Windows workspace, PostgreSQL on `127.0.0.1`, a fresh disposable schema for each database/headed run, and visible system Chrome via Playwright `channel: "chrome"`. The additive `20261026064436_phase5_fundraising_drafts` migration was tested in isolation before local development application. `prisma migrate status` reports seven migrations and up-to-date schema; the datasource/schema diff is empty. The scripts in this working tree are evidence references; no production deployment, financial policy activation or payment provider was involved.

| Subset / evidence | Command | Final result | Actual checks |
| --- | --- | --- | --- |
| Exact amount and draft validation, `src/lib/validations/fundraising.test.ts` | `npm.cmd run test:fundraising` | **PASSED, 2/2** | INR rupee-to-paise conversion, formatting, zero/invalid precision rejection and campaign date order. |
| FR-FND-01/02 storage, `scripts/verify-fundraising-migration.ts` | `npm.cmd run test:fundraising:db` | **PASSED** | Isolated full migration; multiple requests per project; positive paise; unique one campaign per request; SQL gates reject submission, active/public campaign and bad dates; immutable history and protected evidence Media FK. |
| FR-FND-01/02 UI/privacy, `scripts/verify-fundraising-ui.ts` | `npm.cmd run test:fundraising:headed` | **PASSED** | ADMIN request/campaign planning, exact 123456 paise for INR 1234.56, private PDF evidence upload/read, invalid-origin upload denial, stale-version denial, EDITOR page/upload/file denial and no draft campaign on public `/en` or `/ta`. |
| Phase 4 regression, `scripts/verify-project-ui.ts` | `npm.cmd run test:project:headed` | **PASSED** | Club/volunteer task scope, private evidence, submission and independent review after Phase 5 schema addition. |
| Approval foundation regression, `src/lib/approval/definition.test.ts` and `scripts/verify-approval-migration.ts` | `npm.cmd run test:approval`; `npm.cmd run test:approval:db` | **PASSED, 6/6 unit cases plus isolated DB** | Draft policy activation remains blocked; exact condition and independent-decision rules, immutable approval history and duplicate/stale decision constraints remain valid after Phase 5. |
| Static and migration checks | `npx.cmd prisma validate`; `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`; `npx.cmd prisma migrate status`; `npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`; `git diff --check` | **PASSED** | Prisma schema, ESLint, TypeScript, production route compilation, local migration parity and whitespace. |

Intermediate headed runs **FAILED** at the stale-edit assertion because the test changed a hidden form value during an in-flight React refresh; a later run showed the browser had submitted the refreshed version. The test now simulates a concurrent database version change after page load and verifies the action rejects the stale page. The final complete run passed. Full `T-FND-01` remains **BLOCKED** for submitted/returned/approved requests and public campaigns because the user kept financial/public-release policies inactive. Campaign start/end eligibility, publication evidence/redaction, public bilingual pages, live approvals, thresholds, notification delivery and payment totals were **NOT_RUN**. Full Tamil admin interface localization and backup/restore were also **NOT_RUN**. The three existing public evidence/demo safeguard defects remain documented and unchanged.

## Phase 6 gated donation-intake results — 2026-10-26

Scope tested: existing portal-account donor linking, offline cash/bank/UPI intake in INR paise, pending-only state, private evidence and own-record donor view. No gateway SDK/provider, checkout order, webhook persistence, verification, receipt/refund, journal, public total or donor self-registration is implemented in this slice.

| Subset / evidence | Command | Result | Actual checks |
| --- | --- | --- | --- |
| FR-DON-01/03 validation and test provider, `donations.test.ts`, `provider.test.ts` | `npm.cmd run test:donations` | **PASSED, 4/4** | Valid donor identity/type; organization name requirement; positive INR precision and offline methods; mock HMAC acceptance/tamper rejection; live provider resolver fails closed. |
| FR-DON-01/03 schema, `scripts/verify-donations-migration.ts` | `npm.cmd run test:donations:db` | **PASSED** | Full migration on disposable local PostgreSQL schema; existing account profile unique; 123456 paise preserved; zero denied; confirmation/other currency denied; history update/delete and donor-account deletion denied. |
| FR-DON-01/03 privacy/intake, `scripts/verify-donations-ui.ts` | `npm.cmd run test:donations:headed` | **PASSED** | Headed system Chrome covers ADMIN-only entry, existing account linking, exact paise, private evidence upload/read, donor self-scope, reference exclusion, editor denial and public route exclusion. |
| Existing club/project/volunteer regression, `scripts/verify-project-ui.ts` | `npm.cmd run test:project:headed` | **PASSED after Phase 6** | Rechecked coordinator and volunteer scope, private evidence upload/read, task submission, independent admin review and unchanged public project status on a disposable schema with all nine migrations. |
| Static/build | `npx.cmd prisma validate`; `npm.cmd run typecheck`; `npm.cmd run lint`; `npm.cmd run build` | **PASSED after fixes** | Schema valid; TypeScript clean after replacing bigint literals and widening private storage namespace; ESLint clean; optimized Next.js production build and route generation complete. |

The first headed attempt **FAILED** because the test targeted the wrong form index after the admin shell added its sign-out form; the selector now scopes by the donor-profile field. The next attempt **FAILED** because `/donor` was being localized by the public proxy; `/donor` now bypasses locale negotiation like the club and volunteer portals. The final headed run **PASSED** all listed checks. Full `T-DON-01`/`T-DON-02` remain **BLOCKED/NOT_RUN** for provider-backed payment confirmation, persisted webhook idempotency, independent checker decisions, reconciliation, receipt matching and verified totals. `T-DON-03` remains **NOT_RUN** for refunds, disputes and recurring mandates. No production gateway or production database was used. Both additive migrations were applied to the local development database at `127.0.0.1:5432/trustfolio`; `prisma migrate status` is up to date and the datasource/schema diff is empty. No data backfill or existing-row update was performed.

## November 2026 follow-up verification

On the local Windows workspace with PostgreSQL 18.6, `npm run test:recovery` passed using a disposable schema, custom-format `pg_dump` and `pg_restore`, and a disposable private file. It verified restored user and media rows, the private storage key, and file contents. This is a local recovery subset only; deployed Blob storage, production backup ownership, recovery targets, and the full `T-OPS-01` case remain open.

The dependency update to Next.js 16.4.6 passed `npm audit` with zero reported advisories, `npm run lint`, `npm run typecheck`, `npm run build`, 19 unit tests, and all six isolated migration checks. The `T-PUB-02` publication safeguard changes compiled and passed public route smoke checks; its complete browser and database regression case is still open.

## Phase 7 policy-neutral finance validation helpers

| Subset / evidence | Command | Result | Actual checks |
| --- | --- | --- | --- |
| Journal and chart invariants, `src/lib/finance/journal-core.test.ts`, `src/lib/finance/chart.test.ts` | `npm.cmd run test:finance-core` | **PASSED, 7/7** | Balanced integer minor-unit journal; rejection of unbalanced, mixed-currency, dual-sided and floating-point lines; canonical replay fingerprint; full reversal swaps debit/credit and preserves dimensions with explicit period/date; chart accepts unique acyclic hierarchy and rejects duplicate codes, missing parents, cycles, blank identifiers and unsupported classes. |
| Static/build checks | `npm.cmd run typecheck`; `npm.cmd run lint`; `npm.cmd run build` | **PASSED** | No TypeScript or ESLint errors; optimized Next.js production build and route generation completed. |

These helpers are not a ledger or posting implementation: no Prisma models, trust-specific chart/fund policy, fiscal-period rules, authorization, database transaction, budget/expense action or report was added. Full `T-FIN-*` cases remain **NOT_RUN** until D-01/D-02/D-03 and the opening-balance schedule are approved.
