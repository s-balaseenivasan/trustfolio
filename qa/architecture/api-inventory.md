# Trustfolio — API & Server-Action Inventory

Phase 4 (Backend & API QA). Static analysis only — the app was not started, no database exists,
no network call was made. Scope: `src/app/api/` (12 routes), `src/server/actions/` (19 modules, 79
exported entry points), and the service layer they call into (`src/server/{approval,clubs,
volunteers,projects,fundraising,donations,payments,queries}`). No OpenAPI/`.proto`/GraphQL SDL
exists, so there is no declared-vs-implemented drift to report — the source is the only contract.

## Cross-cutting conventions (apply to every row unless noted)

- **Auth:** `requireAdminPage()` guards `/admin` pages via the shared layout
  (`src/app/admin/(dashboard)/layout.tsx:14`). Every API route and admin server action calls
  `requireAdmin()`/`requireAdmin("ADMIN")` directly or through the `adminMutation()` /
  per-module `run()` wrapper. `/club`, `/volunteer`, `/donor` pages and their actions call
  `getAdminUser()` individually (see finding set below — verified, not assumed).
- **Validation:** Every mutation parses `FormData` through a Zod schema
  (`src/lib/validations/*`, `src/server/actions/admin-helpers.ts:51` `parseForm()`) before any
  Prisma call. No schema uses `.passthrough()`/`z.any()`/`z.record()` — confirmed by grep, zero
  hits. No handler spreads raw `FormData`/request body into a Prisma `create`/`update`; every
  service function builds an explicit field list (e.g. `src/server/clubs/service.ts:18-27`
  `profile()`) or spreads only the already-validated `parsed.data` object. No mass-assignment
  surface was found.
- **Errors:** Every custom domain error (`ClubError`, `VolunteerError`, `ProjectOperationError`,
  `DonationError`, `FundraisingError`, `ApprovalError`, `UnauthorizedError`) is constructed with a
  literal, author-written message — none wrap a caught exception's `.message`. Unknown errors are
  `console.error`-logged server-side and mapped to a generic "Something went wrong" /
  "Could not save…" string (`src/server/actions/admin-helpers.ts:38`). No stack trace, file path,
  SQL text or dependency version reaches a response in any file read this pass.
- **404-not-403:** every scope-checked route/action returns 404 ("Not found" / "This record no
  longer exists") rather than 403 when the actor is wrong for the object, to avoid confirming the
  object exists. Followed consistently except where noted in findings.
- **Rate limiting:** Postgres-backed `rateLimit()` (`src/lib/rate-limit.ts:17`) keyed per actor or
  per IP+email on every write-heavy or public endpoint; see per-row notes. (Login's limiter gap is
  already filed as QA-AUTH-001/002/004 — not repeated here.)

## 1. API routes (`src/app/api/`)

| Method & path | Auth | Scope / ownership check | Input | Rate limit | Success | Error convention |
|---|---|---|---|---|---|---|
| `GET /api/auth/[...nextauth]` | NextAuth handler | n/a | NextAuth internal | login limiter (`src/auth.ts:29`) | session cookie | NextAuth default |
| `POST /api/admin/upload` | `requireAdmin()` — ADMIN or EDITOR (`src/app/api/admin/upload/route.ts:25`) | none beyond role | file + visibility flag; size/MIME/magic-byte sniff (`:41-50`) | `upload:<userId>` 120/h (`:30`) | 201 JSON `Media` | JSON `{error}`, 401/413/415/500 |
| `GET /api/admin/media` | `requireAdmin()` — ADMIN or EDITOR (`src/app/api/admin/media/route.ts:12`) | non-ADMIN rows excluded from operational-private prefixes (`:23`) | query params only | none | 200 JSON list+total | JSON `{error}`, 401 |
| `GET /api/admin/media/[id]/file` | `requireAdmin()` — ADMIN or EDITOR (`src/app/api/admin/media/[id]/file/route.ts:13`) | non-ADMIN denied for operational-private media (`:19`) | — | none | file stream, `Cache-Control: private` | plain-text 401/404 |
| `POST /api/admin/clubs/[id]/documents` | `requireAdmin("ADMIN")` (`src/app/api/admin/clubs/[id]/documents/route.ts:17`) | club must be DRAFT/ACTIVE (`:24`); storage key forced under `private/club-documents/` (`src/server/clubs/service.ts:86`) | title + file; size/MIME/sniff | `club-document-upload:<userId>` 60/h (`:21`) | 201 JSON `{id}` | same-origin check host-only (`:14`); JSON `{error}` |
| `GET /api/club/documents/[id]/file` | `getAdminUser()` (`src/app/api/club/documents/[id]/file/route.ts:8`) | ADMIN bypass; else `requireClubCoordinator(actor.id, document.clubId)` (`:14-15`) | — | none | file stream | plain-text 401/404; **no storage-key-prefix check** — see QA-API-001 |
| `POST /api/project-tasks/[id]/evidence` | `getAdminUser()` (`src/app/api/project-tasks/[id]/evidence/route.ts:19`) | ADMIN bypass; else `requireVolunteerTask(actor.id, id)` (`:23-24`) | title/kind + file; size/MIME/sniff | `task-evidence-upload:<userId>` 60/h (`:26`) | 201 JSON `{id}` | same-origin host+protocol (`:12-18`); JSON `{error}` |
| `GET /api/task-evidence/[id]/file` | `getAdminUser()` (`src/app/api/task-evidence/[id]/file/route.ts:8`) | `requireTaskReader(actor, evidence.taskId)` — ADMIN bypass, else assigned volunteer or viewing coordinator (`src/server/projects/service.ts:205-212`) | — | none | file stream | plain-text 401/404; storage-key prefix checked (`:13`) |
| `POST /api/admin/donations/[id]/evidence` | `requireAdmin("ADMIN")` (`src/app/api/admin/donations/[id]/evidence/route.ts:16`) | donation must be `PENDING_VERIFICATION` (`:22`) | title + file; size/MIME/sniff | `donation-evidence:<userId>` 40/h (`:19`) | 201 JSON `{id}` | same-origin host+protocol; JSON `{error, code}` |
| `GET /api/admin/donations/evidence/[id]/file` | `requireAdmin("ADMIN")` (`src/app/api/admin/donations/evidence/[id]/file/route.ts:7`) | storage-key prefix checked (`:11`) | — | none | file stream | plain-text 401/404 |
| `POST /api/admin/fundraising/requests/[id]/evidence` | `requireAdmin("ADMIN")` (`src/app/api/admin/fundraising/requests/[id]/evidence/route.ts:16`) | request must be `DRAFT` (`:22`) | title + file; size/MIME/sniff | `donation-request-evidence:<userId>` 40/h (`:19`) | 201 JSON `{id}` | same-origin host+protocol; JSON `{error, code}` |
| `GET /api/admin/fundraising/evidence/[id]/file` | `requireAdmin("ADMIN")` (`src/app/api/admin/fundraising/evidence/[id]/file/route.ts:7`) | storage-key prefix checked (`:11`) | — | none | file stream | plain-text 401/404 |

**Priority-3 result (stated plainly):** the three routes named in the brief as the IDOR boundary —
`/api/club/documents/[id]/file`, `/api/task-evidence/[id]/file`, `/api/project-tasks/[id]/evidence`
— all gate correctly. The ADMIN-bypass branch in each is `actor.role !== "ADMIN"` / `=== "ADMIN"`,
never a broader "non-PORTAL_USER" check, so EDITOR is correctly forced through the same scope
helper as PORTAL_USER. `requireClubCoordinator` requires active membership **and** `role ===
"COORDINATOR"` **and** `club.coordinatorId === userId` (`src/server/clubs/service.ts:203-212`).
`requireVolunteerTask` requires an active `TaskAssignment` at the current consent version plus a
live membership re-check (`src/server/projects/service.ts:197-203`). `requireTaskReader` only adds
an ADMIN bypass and a coordinator-view fallback on top of `requireVolunteerTask`
(`src/server/projects/service.ts:205-212`) — no path lets an unrelated user reach either helper's
success branch. No IDOR was found on these three routes.

## 2. Server actions (`src/server/actions/`, `"use server"`) — 79 exported entry points

### 2.1 Portal-facing (non-admin) — the four modules named in the brief

| Module : function | Required guard | Scope / ownership check | Validation | Notes |
|---|---|---|---|---|
| `club/membership.ts : requestMyClubMembership` (`:11`) | `getAdminUser()` (`:14`) | none beyond self — writes a request for `actor.id` only (`:22`) | `clubId` z.string + two boolean consent checkboxes (`:16-19`) | rate limit `club-request:<id>` 10/h (`:20`) |
| `projects/tasks.ts : updateAssignedTask` (`:12`) | `getAdminUser()` (`:15`) | `updateMyTask(taskId, version, input, actor.id)` checks active assignment + current consent + live membership (`src/server/projects/service.ts:214-230`) | `taskProgressSchema` + version (`:20-21`) | rate limit `project-task-progress:<id>` 60/h (`:18`) |
| `projects/tasks.ts : reportClubContribution` (`:32`) | `getAdminUser()` (`:35`) | `addProjectClubContribution` calls `requireProjectClubCoordinator(actor.id, assignmentId, "report")` when `actor.role !== "ADMIN"` (`src/server/projects/service.ts:89-97`) | assignmentId/description/date z.string (`:37-39`) | future-date rejected (`:41`) |
| `volunteer/records.ts : saveMyVolunteerProfile, addMyAvailability, removeMyAvailability, submitMyAttendance, submitMyServiceLog` (`:33,45,58,65,73`) | `getAdminUser()` inside shared `run()` wrapper (`:16`) | every service call is scoped by `userId` from the session, never a client-supplied id (`src/server/volunteers/service.ts:15-114`) | `volunteerProfileSchema`/`availabilitySchema`/`attendanceSchema`/`serviceLogSchema` (`src/lib/validations/volunteer.ts`) | rate limit `volunteer-write:<id>` 30/h (`:18`) |
| `contact.ts : submitContact` (`:26`) | none — public by design | n/a | `contactSchema` + honeypot + min-fill-time (`:40-54`) | per-IP 3/10min + per-email 5/24h (`:16-17,58-61`); bot path returns fake success (`:42-44`) |

**Priority-2 result (stated plainly):** all five exported functions across these four modules call
`getAdminUser()` (directly or via a shared `run()` helper) before touching data, and every mutation
that acts on an existing row re-derives its scope from the session's `actor.id`/`userId` inside the
service layer rather than trusting a client-supplied owner id. No unguarded exported server action
was found in this set.

### 2.2 Admin-facing — 14 modules, 74 exported entry points

All route through `requireAdmin()`/`requireAdmin("ADMIN")` directly, or through the shared
`adminMutation()` helper (`src/server/actions/admin-helpers.ts:16`) or a per-module `run()`/
`runAction()` wrapper that calls `requireAdmin()` once and feeds every exported function in the
file. Verified by reading every file (not just counting call sites, since the wrapper pattern
hides the guard from a flat grep):

| Module | ADMIN-only functions | ADMIN-or-EDITOR functions | Guard pattern |
|---|---|---|---|
| `admin/approvals.ts` | all 8 (`addApprovalGroup, addApprovalPermission, editApprovalGroup, editApprovalPermission, configureGroupPermissions, addDraftPolicy, addDraftDelegation, simulateApprovalPolicy`) | — | `runAction()` → `requireAdmin("ADMIN")` (`:34`) |
| `admin/bulk.ts` | — | `bulkAction` | `adminMutation()`, no role option (`:85`) |
| `admin/cache.ts` | `refreshPublicCache` | — | `adminMutation(..., {role:"ADMIN"})` (`:19`) |
| `admin/clubs.ts` | all 8 (`addClub, editClub, setClubStatus, removeClubDocument, inviteMember, decideMembership, setCoordinator, endMembership`) | — | `run()` → `requireAdmin("ADMIN")` (`:17`) |
| `admin/donations.ts` | both (`linkDonorAccount, recordManualDonationIntake`) | — | `run()` → `requireAdmin("ADMIN")` (`:15`) |
| `admin/evidence.ts` | — | all 4 (`saveDocument, saveReport, saveCertificate, saveVerificationRecord`) | `adminMutation()`, no role option |
| `admin/fundraising.ts` | all 6 | — | `run()` → `requireAdmin("ADMIN")` (`:16`) |
| `admin/media.ts` | — | all 4 (`updateMediaMeta, deleteMedia, saveAlbum, saveNews`) | `adminMutation()`, no role; operational-private files additionally refused to non-ADMIN inside the handler (`:35,50`) |
| `admin/messages.ts` | — | all 3 | `adminMutation()`, no role |
| `admin/project-operations.ts` | all 11 | — | `run()` → `requireAdmin("ADMIN")` (`:16`) |
| `admin/settings.ts` | `saveSiteSettings, saveNavigation, saveSocialLinks, createUser, updateUserRole, deleteUser` (all `{role:"ADMIN"}`) | `changePassword` (self password change, no role option) | `adminMutation()` |
| `admin/trust.ts` | `saveTrustProfile` (`{role:"ADMIN"}`, `:25`) | `saveTrustee, saveObjective, saveHistoryEvent, saveFaq, saveCategory, deleteCategory` | `adminMutation()` |
| `admin/volunteers.ts` | `decideVolunteerRecord` | — | direct `requireAdmin("ADMIN")` (`:14`) |
| `admin/work.ts` | — | all 5 (`saveProject, saveActivity, saveMetric, saveTestimonial, saveStory`) | `adminMutation()`, no role |
| `auth.ts` | `login`, `logout` | — (public; these *are* the auth boundary) | `signIn`/`signOut` (NextAuth) |

The ADMIN/EDITOR split matches the documented matrix exactly: EDITOR is denied trust profile,
settings, navigation, social links and users (REQ-SEC-024, already satisfied per
`qa/discovery/requirements-inventory.md:45`) and admitted everywhere else. No exported admin
action was found calling a service function without first obtaining an `AdminUser` through one of
these guards.

## 3. Findings summary (full entries in `qa/reports/findings.json`)

| ID | Severity | Status | One-line |
|---|---|---|---|
| QA-API-001 | Low | CONFIRMED | Club-document file route omits the storage-key-prefix defense-in-depth check its sibling evidence routes use; not currently reachable since no action can repoint a document's media |
| QA-API-002 | Medium | CONFIRMED | `/club/[id]` member roster and private-document list have no pagination, unlike every comparable list in the codebase |
| QA-API-003 | Informational | CONFIRMED | Same-origin check rigor is inconsistent across upload POST routes (host-only vs host+protocol) |
| QA-API-004 | Informational | CONFIRMED | Action/route error payloads inconsistently carry a `code` field across modules |

## Unknowns and limitations

1. No application or database was started; every claim here is a static read of source, not a
   reproduced HTTP exchange. "CONFIRMED" below means confirmed by code reading, not by request
   replay — none of these findings depend on runtime-only state.
2. Two priorities assigned to this phase came back as **verified negatives**: the portal
   page-guard gap (§ "Priority 1") and server-action authorization (§ "Priority 2") were both
   checked line-by-line and found correctly guarded in every file. This is reported as a result,
   not skipped — see the "stated plainly" notes above.
3. Non-`id`-keyed admin list/detail pages under `src/app/admin/(dashboard)/[resource]/*` and their
   `listResourceRows`/`getOptions` queries were read only incidentally (to confirm the EDITOR/ADMIN
   split for `admin/trust.ts`); a full pagination/N+1 audit of every admin list query was not
   performed and may contain further instances of the pattern in QA-API-002.
4. Vercel Blob storage path (`STORAGE_DRIVER=blob`) was not exercised; all upload/read paths were
   read assuming the local-filesystem driver, per `qa/architecture/application-architecture.md`
   unknown #2.
5. `src/proxy.ts` and `src/auth.config.ts` were read for the portal-exclusion claim only; the
   NextAuth JWT/session callback internals in `auth.config.ts` were not separately audited in this
   phase (out of the five stated priorities).
6. This phase did not re-verify REQ-SEC-028 (upload MIME/magic-byte/rate-limit coverage) or
   REQ-SEC-030 (rate limiting) beyond citing their already-filed status; see
   `qa/discovery/requirements-inventory.md`.
