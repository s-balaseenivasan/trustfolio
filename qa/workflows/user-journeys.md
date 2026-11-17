# Trustfolio — End-to-End User Journeys

Phase 6 output. **Static analysis only** — the application was not started, no database exists, no
HTTP exchange was observed. Every step marked **CONFIRMED** was traced to a `file:line` in this
repository. Every step marked **UNVERIFIED** names exactly what evidence would settle it. No step
was filled in because it was plausible.

Scope: the six workflows named in the phase-6 brief. Depth over breadth was the instruction; the
workflows deliberately **not** traced are listed in §8.

Cross-layer contradictions found during this pass are filed in `qa/reports/findings.workflow.json`
(`QA-FLOW-001` … `QA-FLOW-011`, 11 findings). Findings already filed by phases 1–5 are cited by id, not re-raised. One of the new entries, QA-FLOW-011, is a traceability break rather than an application defect: `QA-NOTIFY-007` is cited as filed by three phase-1/3 reports but does not exist in `qa/reports/findings.json`.

---

## Conventions used below

| Marker | Meaning |
|---|---|
| **C** | CONFIRMED — traced in code at the cited `file:line` |
| **U** | UNVERIFIED — not traced; the evidence needed is stated inline |
| *store* | the owning data store for a write; Postgres unless stated |

Two guard patterns exist and both appear below. `requireAdmin*()` is a **role** guard
(`src/server/auth-guard.ts:33,42`); `getAdminUser()` + a per-service `require*()` helper is an
**identity + resource-scope** guard that deliberately admits `PORTAL_USER`. README.md:113 describes
only the first — already filed as QA-REQ-005.

---

## 1. WF1 — Admin login → dashboard

**Starting event** Unauthenticated actor requests any `/admin*` URL, or opens `/admin/login`.
**Actor** anyone; outcome branches on `Role` (`ADMIN` | `EDITOR` | `PORTAL_USER`).
**Required permission** none to attempt; `ADMIN` or `EDITOR` to land on the dashboard.

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | Request to `/admin/*`; proxy checks only for the **presence** of a session cookie and redirects to `/admin/login?callbackUrl=…` if absent | edge | `src/proxy.ts:16-23` | **C** |
| 2 | `/admin/login` renders; if `getAdminUser()` already resolves, it redirects by role (`PORTAL_USER` → `/donor` \| `/volunteer` \| `/club` from the callback prefix, else `/admin`) | server component | `src/app/admin/login/page.tsx:15-16` | **C** |
| 3 | `LoginForm` submits `email`, `password`, hidden `callbackUrl`; the form is `noValidate`, both inputs carry `required` | UI | `src/app/admin/login/login-form.tsx:17,24,27,31` | **C** |
| 4 | `login()` server action parses with `loginSchema`; field errors return without calling NextAuth | server action | `src/server/actions/auth.ts:22-27` | **C** |
| 5 | `safeCallback()` restricts the post-login destination to `/admin*` (never `/admin/login`), `/club*`, `/volunteer*`, `/donor*`; anything else collapses to `/admin` | server action | `src/server/actions/auth.ts:10-20` | **C** |
| 6 | `signIn("credentials", …)` → `authorize()` | NextAuth | `src/server/actions/auth.ts:30`, `src/auth.ts:24` | **C** |
| 7 | Rate-limit key `login:<sha(clientIp:email)>`, 5 per 15 min; a tripped limiter returns `null` | service | `src/auth.ts:14,29-31` | **C** |
| 8 | `db.user.findUnique({email})`; `bcrypt.compare` always runs, against `DUMMY_HASH` when no user exists, so timing does not disclose registration | service + *Postgres `User`* | `src/auth.ts:12,33-35` | **C** |
| 9 | On success: `resetRateLimit()`, then a single `$transaction` writing `User.lastLoginAt` and an `ActivityLog` row with `action: "LOGIN"` | service + *Postgres `User`, `ActivityLog`* | `src/auth.ts:37-43` | **C** |
| 10 | JWT issued carrying `sub` and `role`; session callback re-reads `role` from the token, defaulting to `EDITOR` when absent | NextAuth | `src/auth.config.ts:27-38` | **C** |
| 11 | Redirect to the `safeCallback` destination; the admin layout calls `requireAdminPage()`, which re-reads the `User` row from the database (REQ-SEC-026) | layout | `src/app/admin/(dashboard)/layout.tsx:14`, `src/server/auth-guard.ts:22,33` | **C** |
| 12 | Dashboard renders evidence coverage, content counts, unread messages, and the 12 most recent `ActivityLog` rows | output | `src/app/admin/(dashboard)/page.tsx:33-40`, `src/server/queries/admin.ts:316` | **C** |

**What the user actually sees** "Welcome, <first name>", an evidence-coverage checklist mirroring
the public Evidence Center, a content table, recent messages and recent changes. An `ADMIN` also
sees the cache-refresh panel (`page.tsx:71`); an `EDITOR` does not.

### Alternative paths

- **`PORTAL_USER` signs in with no `callbackUrl`.** `safeCallback` returns `/admin`
  (`actions/auth.ts:11`); the proxy passes (a cookie now exists, `proxy.ts:18`); the layout's
  `requireAdminPage()` then redirects to `/club` (`auth-guard.ts:36`). **C** — two hops, correct
  destination.
- **`EDITOR` opens an `ADMIN`-only page.** `requireAdminPage("ADMIN")` redirects to `/admin`
  (`auth-guard.ts:37`). The sidebar already hides those entries (`admin-shell.tsx:109`), verified
  by the UI phase as matching the page guards exactly.
- **Portal user signs in directly to `/club`, `/volunteer`, `/donor`.** The proxy explicitly skips
  these paths (`proxy.ts:27`); each page calls `getAdminUser()` itself and redirects to
  `/admin/login?callbackUrl=…` (`src/app/club/page.tsx:14-15`, `src/app/volunteer/page.tsx:11-12`,
  `src/app/donor/page.tsx:12-13`). **C**

### Failure and lockout branches

| Branch | Server behaviour | What the user is left with | Evidence |
|---|---|---|---|
| Malformed email / empty password | action returns field errors, NextAuth never called | inline field errors, no attempt consumed | `src/server/actions/auth.ts:25-27` **C** |
| Wrong password | `authorize` returns `null` → `AuthError` | "Invalid email or password. After several failed attempts, sign-in is paused for 15 minutes." | `src/auth.ts:35`, `src/server/actions/auth.ts:38-43` **C** |
| Unknown email | identical path and identical message | same string — no user enumeration | `src/auth.ts:34` **C** |
| 6th attempt within 15 min from one IP | `rateLimit` fails → `authorize` returns `null` **before** any DB read | **identical** message; the user cannot tell a lockout from a wrong password (QA-AUTH-004) | `src/auth.ts:31` **C** |
| Attacker rotates source IP | the limiter key contains the client IP, so each new source gets a fresh budget of 5 against the same account (QA-AUTH-001) | — | `src/auth.ts:29` **C** |
| `X-Forwarded-For` forged | `getClientIp()` takes the first XFF entry; exploitability depends entirely on deployment topology (QA-AUTH-002) | — | `src/lib/rate-limit.ts:54` **U** — send a forged header to a deployed environment and observe whether the limiter bucket changes |
| Account deleted mid-session | `getAdminUser()` re-reads the row and returns `null`; next admin page redirects to login | forced re-login | `src/server/auth-guard.ts:22-30` **C** |
| Logout | `signOut({redirectTo:"/admin/login"})` | back at login | `src/server/actions/auth.ts:49-51` **C** |

**Dead branch found.** `authConfig.callbacks.authorized` (`src/auth.config.ts:19-26`) would redirect
a signed-in user away from `/admin/login` and require a session everywhere else — but nothing
invokes it. `src/proxy.ts` does not import `authConfig` (`proxy.ts:1-2`) and no module exports
`auth` as middleware. The comment at `auth.config.ts:5` ("Provider-free config shared by `auth.ts`
and `proxy.ts`") is false for the `authorized` half. Behaviour is unaffected because
`login/page.tsx:15` and `proxy.ts:18` independently do the same two jobs. Filed as **QA-FLOW-005**.

---

## 2. WF2 — Club membership request → review → active membership

> **Correction to the brief.** The reviewer is a **trust `ADMIN`**, not the club coordinator.
> `decideMembership` routes through `run()` → `requireAdmin("ADMIN")`
> (`src/server/actions/admin/clubs.ts:14,17`). No coordinator-facing approval control exists
> anywhere in `/club`. REQ-CLUB-034 states the rule correctly
> (`qa/discovery/requirements-inventory.md:55`); the coordinator role is granted *after* approval.

**Starting event** a signed-in portal user opens `/club` and finds an ACTIVE club.
**Actor** any authenticated user (`getAdminUser()` only — role is not checked).

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | `/club` lists the actor's memberships and a paginated (24/page) search over `status: ACTIVE` clubs | page | `src/app/club/page.tsx:20,22-26` | **C** |
| 2 | The request form renders only when there is no membership, or it is `INVITED`/`REJECTED`/`ENDED` | UI | `src/app/club/page.tsx:32` | **C** |
| 3 | Two checkboxes — adult declaration and `CLUB_CONSENT_TEXT` — both `required` client-side | UI | `src/components/club/membership-request.tsx:15-16` | **C** |
| 4 | `requestMyClubMembership`: `getAdminUser()`; both consents re-checked server-side; `clubId` parsed `z.string().min(1).max(64)` | server action | `src/server/actions/club/membership.ts:14-19` | **C** |
| 5 | Rate limit `club-request:<userId>`, 10/h | service | `src/server/actions/club/membership.ts:20` | **C** |
| 6 | `requestClubMembership(clubId, actor.id, actor.id, …)` — refuses when `actorId !== userId`, refuses without both consents | service | `src/server/clubs/service.ts:129-131` | **C** |
| 7 | Serializable transaction: club must be `ACTIVE`; an existing membership not in `INVITED`/`REJECTED`/`ENDED` blocks | service + *Postgres `Club`, `ClubMembership`* | `src/server/clubs/service.ts:132-136` | **C** |
| 8 | Membership created/updated to `REQUESTED` with `consentAt`, `adultAttestedAt`, `consentVersion` stamped now | *Postgres `ClubMembership`* | `src/server/clubs/service.ts:38,137-139` | **C** |
| 9 | `ClubMembershipHistory` row (immutable by SQL trigger) + `AuditEvent` row | *Postgres* | `src/server/clubs/service.ts:140-141`, `prisma/migrations/20261025010000_phase2_clubs/migration.sql:141` | **C** |
| 10 | **No `NotificationOutbox` row is written.** Compare `inviteClubMember` (`:123`) and `reviewClubMembership` (`:161`), which both do | *gap* | `src/server/clubs/service.ts:132-143` | **C** → QA-FLOW-003 |
| 11 | `revalidatePath("/club")`; the user sees "Request submitted. A trust administrator must approve it." | output | `src/server/actions/club/membership.ts:23-24` | **C** |
| 12 | An `ADMIN` opens `/admin/clubs/[id]` — guarded by `requireAdminPage("ADMIN")` | page | `src/app/admin/(dashboard)/clubs/[id]/page.tsx:11` | **C** |
| 13 | The page loads the club with **every** membership and **every** history row, plus **every** `User` row for the invite picker, none bounded | page | `src/app/admin/(dashboard)/clubs/[id]/page.tsx:15-16` | **C** → QA-FLOW-006 |
| 14 | `decideMembership` → `requireAdmin("ADMIN")` → `reviewClubMembership(membershipId, version, actorId, decision, reason)` | server action | `src/server/actions/admin/clubs.ts:83-93` | **C** |
| 15 | Business rules, in order: reason required on `REJECT`; status must still be `REQUESTED` at the expected `version`; club must be `ACTIVE`; **`actorId === current.userId` throws `SELF_APPROVAL`**; approval re-checks `consentAt`, `adultAttestedAt` and `consentVersion === CLUB_CONSENT_VERSION` | service | `src/server/clubs/service.ts:147,150,151,152,153` | **C** |
| 16 | `updateMany` guarded on `{id, version, status:"REQUESTED"}`; `joinedAt` stamped on approve | *Postgres* | `src/server/clubs/service.ts:157` | **C** |
| 17 | History + audit + **`NotificationOutbox`** row keyed `club-membership:<id>:v<n+1>` | *Postgres* | `src/server/clubs/service.ts:159-161` | **C** |
| 18 | The outbox row is never delivered — no consumer transitions it | *gap* | `qa/architecture/application-architecture.md:90-96` | **C** |
| 19 | The member sees status `ACTIVE` on `/club` after their next visit | output | `src/app/club/page.tsx:31` | **C** |

### Becoming a coordinator (prerequisite for the workspace)

`setCoordinator` → `appointClubCoordinator` requires club `ACTIVE` at the expected version and the
target's membership already `ACTIVE`; it demotes any previous coordinator to `MEMBER` in the same
transaction (`src/server/actions/admin/clubs.ts:96`, `src/server/clubs/service.ts:166-187`). **C**
Only then does `/club/[id]` open: `requireClubCoordinator` demands membership `ACTIVE` **and**
`role === COORDINATOR` **and** club `ACTIVE` **and** `club.coordinatorId === userId`
(`src/server/clubs/service.ts:203-212`, `src/app/club/[id]/page.tsx:16`). **C**

### Alternative and error paths

| Branch | Behaviour | User is left with | Evidence |
|---|---|---|---|
| Either consent unchecked | action returns before the rate limiter | "Confirm both the adult declaration and membership data use." | `membership.ts:19` **C** |
| Club not `ACTIVE` | `CLUB_NOT_ACTIVE` | "Membership is available only for active clubs." | `service.ts:134` **C** |
| Already `REQUESTED`/`ACTIVE`/`SUSPENDED` | `MEMBERSHIP_EXISTS` | "You already have a current request or membership." | `service.ts:136` **C** |
| Rate limit tripped | — | "Too many membership requests. Try again later." | `membership.ts:21` **C** |
| Reject without a reason | `REASON_REQUIRED` thrown before the transaction | error message; the admin's typed values are returned in `values` | `service.ts:147`, `clubs.ts:22` **C** |
| Two admins decide concurrently | Serializable + version-guarded `updateMany` → `MEMBERSHIP_CONFLICT` | "This request changed. Reload it before deciding." | `service.ts:150,158` **C** |
| Admin decides on their own request | `SELF_APPROVAL` | "You cannot approve your own membership." The decision control is rendered regardless — the ban surfaces only after submit | `service.ts:152` **C** |
| Consent version bumped between request and approval | `CONSENT_REQUIRED` on approve | the member must re-request | `service.ts:153` **C** |
| Membership ended later | `closeClubMembership` requires a reason, clears `club.coordinatorId` when the coordinator is removed | — | `service.ts:189-200` **C** |

**Error payload shape.** `ClubError.code` exists but is dropped from the response
(`src/server/actions/admin/clubs.ts:22`), unlike the donations/fundraising modules — QA-API-004.

---

## 3. WF3 — Volunteer service log → review → approved hours

**Starting event** a volunteer with an `ACTIVE` membership of an `ACTIVE` club opens `/volunteer`.
**Prerequisite chain, enforced:** consented volunteer profile → approved attendance → service log.

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | `/volunteer` — `getAdminUser()` or redirect; loads profile, availability, 30 attendances per page, and the approved-minutes aggregate | page | `src/app/volunteer/page.tsx:11-20` | **C** |
| 2 | Profile form shows the consent block only when there is no profile or `consentVersion` is stale | UI | `src/components/volunteer/workspace.tsx:32` | **C** |
| 3 | `saveMyVolunteerProfile` → shared `run()` → `getAdminUser()` + rate limit `volunteer-write:<id>` 30/h | server action | `src/server/actions/volunteer/records.ts:13-19,33` | **C** |
| 4 | `saveVolunteerProfile` — creating requires consent + adult and `expectedVersion === null`; updating enforces optimistic version and re-consent when the version moved | service + *Postgres `VolunteerProfile`* | `src/server/volunteers/service.ts:15-32` | **C** |
| 5 | Attendance form renders only when the actor has at least one `ACTIVE` membership of an `ACTIVE` club | UI | `src/components/volunteer/workspace.tsx:37`, `src/app/volunteer/page.tsx:18` | **C** |
| 6 | `submitMyAttendance` → `submitAttendance`: `serviceDate` must round-trip exactly and not be in the future; profile must be at the current consent version; membership and club must both be `ACTIVE` (REQ-VOL-037) | service | `src/server/volunteers/service.ts:55-64` | **C** |
| 7 | Writes `VolunteerAttendance` (`status SUBMITTED`, `serviceDate` is `@db.Date`), its immutable history row and an audit event, in a Serializable transaction | *Postgres* | `src/server/volunteers/service.ts:65-69`, `prisma/schema.prisma:451` | **C** |
| 8 | An `ADMIN` opens `/admin/volunteers`; the attendance queue is paginated 30/page and filtered `SUBMITTED` \| `APPROVED` | page | `src/app/admin/(dashboard)/volunteers/page.tsx:11,24` | **C** |
| 9 | `VolunteerReview` posts `kind`, `id`, `version`, `decision`, `reason`; the reason input has **no** `required`/`minLength` (QA-UI-001) | UI | `src/components/admin/volunteer-review.tsx:10` | **C** |
| 10 | `decideVolunteerRecord` → `requireAdmin("ADMIN")` → `reviewVolunteerRecord` | server action | `src/server/actions/admin/volunteers.ts:14,20` | **C** |
| 11 | Attendance approved: version/status guard, **`SELF_APPROVAL` when `row.profile.userId === actorId`**, `updateMany` with `reviewedById`/`reviewedAt`, immutable history, audit, outbox row | service + *Postgres* | `src/server/volunteers/service.ts:91-101` | **C** |
| 12 | Hours form appears only for `APPROVED` attendance that has no service log yet | UI | `src/components/volunteer/workspace.tsx:38` | **C** |
| 13 | `submitMyServiceLog` → `submitServiceLog`: attendance must be the actor's own, `APPROVED`, club `ACTIVE`, no existing log; membership re-checked inside the transaction | service | `src/server/volunteers/service.ts:72-77` | **C** |
| 14 | Writes `VolunteerServiceLog` (`SUBMITTED`) + immutable history + audit | *Postgres* | `src/server/volunteers/service.ts:78-80` | **C** |
| 15 | Hours review: same conflict and self-approval guards, **plus** `APPROVED` requires the parent attendance to still be `APPROVED` | service | `src/server/volunteers/service.ts:105-109` | **C** |
| 16 | Confirmed total = `SUM(minutes)` where log `APPROVED` **and** attendance `APPROVED` (REQ-VOL-039) | output | `src/app/volunteer/page.tsx:19` | **C** |
| 17 | The volunteer sees "Confirmed total: H h M min" and a per-record decision history; the page states certificates are not issued yet | output | `src/components/volunteer/workspace.tsx:38` | **C** |

### The `SELF_APPROVAL` branch is reachable, not theoretical

Nothing restricts a volunteer profile to `PORTAL_USER`: `saveVolunteerProfile` is reached through
`getAdminUser()` alone (`src/server/actions/volunteer/records.ts:16`), and club membership is
likewise role-agnostic (`src/server/clubs/service.ts:129`). A trust `ADMIN` who also volunteers
therefore appears in their own review queue, and `/admin/volunteers` renders the decision control
for every `SUBMITTED` row without excluding the actor's own
(`src/app/admin/(dashboard)/volunteers/page.tsx:33-34`). The ban holds server-side; the UI offers
the action anyway. Filed as **QA-FLOW-007** (SUSPECTED — the reachability chain is traced but was
not reproduced against a running system).

### Error and recovery paths

| Branch | Behaviour | User is left with | Evidence |
|---|---|---|---|
| Future or malformed service date | `INVALID_SERVICE_DATE` | "Choose a past or current service date." | `service.ts:57` **C** |
| Membership not active | `VOLUNTEER_CLUB_DENIED` | "An active approved club membership is required." | `service.ts:64,77` **C** |
| Stale consent version | `PROFILE_REQUIRED` | "Create a current volunteer profile first." | `service.ts:63` **C** |
| Reject/void with a 0–2 character reason | server throws `REASON_REQUIRED` after a full round trip because the input has no `minLength` | error banner under the form | `service.ts:86`, `volunteer-review.tsx:10` **C** (QA-UI-001) |
| Attendance voided after hours were approved | same transaction sets the service log to `VOIDED` with reason `"Attendance voided: …"` and writes its history | the volunteer's confirmed total drops; both history trails explain why | `service.ts:96-99` **C** |
| Concurrent review | version-guarded `updateMany` → `VOLUNTEER_CONFLICT` | "This attendance changed. Reload it before deciding." | `service.ts:91,94` **C** |
| Decision notification | an outbox row is written; nothing sends it | the volunteer learns only by revisiting `/volunteer` | `service.ts:101,112` **C** (QA-FLOW-003) |

---

## 4. WF4 — Task assignment → volunteer evidence → completion review

The richest path in the application: UI → server action **and** REST route → service → Postgres →
file storage, with three different scope guards.

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | `ADMIN` opens `/admin/project-operations/[id]`; tasks paginated 25/page with assignments, dependencies, 20 history rows and unarchived evidence | page | `src/app/admin/(dashboard)/project-operations/[id]/page.tsx:12,22` | **C** |
| 2 | "Assign volunteer" → `changeTaskVolunteer` → `run()` → `requireAdmin("ADMIN")` | server action | `src/server/actions/admin/project-operations.ts:16,90-94` | **C** |
| 3 | `setTaskVolunteer`: task not `APPROVED`/`CANCELLED`, project `PLANNED`\|`ACTIVE`, assignment and club `ACTIVE`, target must have a volunteer profile at the **current** consent version, and an `ACTIVE` membership of that club | service | `src/server/projects/service.ts:151-154` | **C** |
| 4 | Writes `TaskAssignment` (unique `taskId+profileId`), task history, audit, and an outbox row | *Postgres* | `src/server/projects/service.ts:155-162` | **C** |
| 5 | `revalidatePath("/volunteer/tasks")` fires from the admin wrapper | cache | `src/server/actions/admin/project-operations.ts:20` | **C** |
| 6 | The volunteer opens `/volunteer/tasks` — the list query itself re-asserts active assignment, current consent, project/assignment/club `ACTIVE` and live membership | page | `src/app/volunteer/tasks/page.tsx:15-18` | **C** |
| 7 | `/volunteer/tasks/[id]` calls `requireVolunteerTask` before rendering; a failure is a `notFound()`, not a 403 | page | `src/app/volunteer/tasks/[id]/page.tsx:15` | **C** |
| 8 | `TaskProgress` computes `editable = status ∈ {TODO, IN_PROGRESS} && !dependenciesOpen` and gates the progress form **and** the evidence section on it | UI | `src/components/volunteer/task-progress.tsx:11-12` | **C** |
| 9 | Evidence upload: `fetch POST /api/project-tasks/<id>/evidence` with `credentials: "same-origin"` | UI | `src/components/projects/task-evidence-upload.tsx:15` | **C** |
| 10 | Route: same-origin on **host and protocol**; `getAdminUser()`; `ADMIN` bypass else `requireVolunteerTask` (404 on failure); rate limit 60/h | API | `src/app/api/project-tasks/[id]/evidence/route.ts:16,19,23-24,26` | **C** |
| 11 | Title 3–160 chars; kind `ATTACHMENT`\|`COMPLETION`; size ≤ `UPLOAD_MAX_MB`; MIME allowlist; 16-byte magic-byte sniff (REQ-SEC-028) | API | `src/app/api/project-tasks/[id]/evidence/route.ts:30-37` | **C** |
| 12 | `storeFile(file, "PRIVATE", "project-task-evidence")` writes bytes **first**, keyed `private/project-task-evidence/YYYY-MM/<uuid>.<ext>` | *filesystem or Vercel Blob* | `src/app/api/project-tasks/[id]/evidence/route.ts:40`, `src/lib/storage.ts:61-83` | **C** |
| 13 | `createTaskEvidenceFromUpload` re-asserts the namespace prefix, re-runs `requireVolunteerTask` for non-admins, and demands `task.status ∈ {TODO, IN_PROGRESS}` **for every actor including `ADMIN`** | service | `src/server/projects/service.ts:263,264,267` | **C** |
| 14 | One Serializable transaction writes `Media` (PRIVATE), `ProjectTaskEvidence`, a task history note and an audit event | *Postgres* | `src/server/projects/service.ts:272-275` | **C** |
| 15 | Any failure after the bytes land calls `deleteStoredFile(...)` — the compensation the generic upload route lacks | API | `src/app/api/project-tasks/[id]/evidence/route.ts:45` | **C** |
| 16 | Volunteer sets progress 100 % and ticks "submit"; `updateAssignedTask` → rate limit 60/h → `updateMyTask` | server action | `src/server/actions/projects/tasks.ts:18,21` | **C** |
| 17 | `updateMyTask`: version match, full scope re-check, live membership, status `TODO`\|`IN_PROGRESS` only, **every predecessor must be `APPROVED`**, `submit` requires exactly 100 % | service | `src/server/projects/service.ts:217-222` | **C** |
| 18 | Task → `SUBMITTED`, version incremented, history row carries the note | *Postgres* | `src/server/projects/service.ts:224-227` | **C** |
| 19 | Reviewer opens the admin task row; the completion-review form renders only for `SUBMITTED` | UI | `src/components/admin/project-operations.tsx:60` | **C** |
| 20 | Evidence links are inside a **collapsed** `<details>` headed "History and private evidence" | UI | `src/components/admin/project-operations.tsx:60` | **C** |
| 21 | `decideTask` → `requireAdmin("ADMIN")` → `reviewTaskCompletion` | server action | `src/server/actions/admin/project-operations.ts:108,112` | **C** |
| 22 | Rules: reason ≥ 3 chars on `RETURN`; status must still be `SUBMITTED` at the version; **`SELF_APPROVAL` if the actor is any assignee**; `APPROVE` additionally requires every predecessor `APPROVED` and every subtask `APPROVED`/`CANCELLED` | service | `src/server/projects/service.ts:233,236,237,238` | **C** |
| 23 | `APPROVED` stamps `completedAt`; `RETURN` resets the task to `IN_PROGRESS` with `completedAt = null` | *Postgres* | `src/server/projects/service.ts:239-240` | **C** |
| 24 | One outbox row per active assignee, keyed `project-task-review:<taskId>:v<n+1>:<userId>` — written, never sent | *Postgres* | `src/server/projects/service.ts:244` | **C** |
| 25 | Downstream: an `APPROVED` task unblocks dependants (`:221`, `:238`) and is a precondition for milestone and project completion (`:120`, `:36-39`) | service | `src/server/projects/service.ts:36,120,221` | **C** |
| 26 | Reading evidence back: `GET /api/task-evidence/[id]/file` filters `archivedAt`, requires `PRIVATE` visibility **and** the `private/project-task-evidence/` prefix, then `requireTaskReader` (ADMIN \| assigned volunteer \| viewing coordinator) | API | `src/app/api/task-evidence/[id]/file/route.ts:13-14`, `src/server/projects/service.ts:205-212` | **C** |
| 27 | Response carries `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff` | API | `src/app/api/task-evidence/[id]/file/route.ts:17` | **C** |

### Two ordering traps found by crossing the layers

1. **Admin evidence upload on a task under review always fails.** The admin `TaskRow` renders
   `TaskEvidenceUpload` whenever the task is not closed — `{!closed && …}` where
   `closed = status ∈ {APPROVED, CANCELLED}` (`src/components/admin/project-operations.tsx:58,60`).
   The service accepts evidence only for `TODO`\|`IN_PROGRESS`
   (`src/server/projects/service.ts:267`), and that check sits **above** the role branch at `:268`,
   so the `ADMIN` bypass does not reach it. On any `SUBMITTED` or `BLOCKED` task — which is exactly
   when a reviewer wants to attach a file — the control is visible, enabled, and returns HTTP 409
   "This task cannot accept evidence now." The volunteer-side component gets this right
   (`task-progress.tsx:12`). Filed as **QA-FLOW-001**; it also contradicts
   `qa/ui-audit/frontend-ui-audit.md:103-106`.
2. **Completion evidence must precede submission.** Submitting moves the task to `SUBMITTED`, which
   closes the evidence window for the volunteer too (`task-progress.tsx:12` hides the uploader). The
   only way back is an admin `RETURN`. Nothing in the UI says so; the copy says "Upload a supporting
   private file below when available" (`task-progress.tsx:12`). Filed as **QA-FLOW-009**.

### Error paths

| Branch | Behaviour | Evidence |
|---|---|---|
| Cross-origin POST | 403 "Invalid origin" before any auth work | `evidence/route.ts:18` **C** |
| Unassigned user guesses a task id | `requireVolunteerTask` throws → **404**, never 403 | `evidence/route.ts:24` **C** |
| Oversize / wrong MIME / content-type mismatch | 413 / 415 / 415 | `evidence/route.ts:34-37` **C** |
| DB write fails after bytes land | file removed, 500 returned | `evidence/route.ts:45-48` **C** |
| Predecessor still open | `TASK_DEPENDENCY_OPEN`; the UI also disables the form via `dependenciesOpen` | `service.ts:221`, `task-progress.tsx:11` **C** |
| Submit at <100 % | `TASK_NOT_COMPLETE` | `service.ts:222` **C** |
| Reviewer is an assignee | `SELF_APPROVAL` | `service.ts:237` **C** |
| `RETURN` with a short reason | `REASON_REQUIRED` after a round trip — the field has no `minLength` (QA-UI-001) | `service.ts:233`, `project-operations.tsx:60` **C** |
| Membership ended after assignment | every read and write re-checks live membership, so access stops immediately | `service.ts:200,219` **C** |

---

## 5. WF5 — Admin uploads media → attaches it to a document → publishes publicly

**Actor** `ADMIN` or `EDITOR` for upload and document editing; `ADMIN` only for trust profile and
settings (REQ-SEC-024).

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | Media library: filter pills, search, visibility toggle, upload | UI | `src/components/admin/media-library.tsx:25` | **C** |
| 2 | `POST /api/admin/upload` — same-origin check compares **host only** (QA-API-003) | API | `src/app/api/admin/upload/route.ts:11-13,21` | **C** |
| 3 | `requireAdmin()` with no role argument → `ADMIN` or `EDITOR`; `PORTAL_USER` rejected 401 | API | `src/app/api/admin/upload/route.ts:25-27`, `src/server/auth-guard.ts:45` | **C** |
| 4 | Rate limit `upload:<userId>` 120/h | API | `src/app/api/admin/upload/route.ts:30` | **C** |
| 5 | `visibility` defaults to `PUBLIC` unless the form says `PRIVATE`; width/height accepted only as integers in (0, 20000) | API | `src/app/api/admin/upload/route.ts:35-39` | **C** |
| 6 | Size, MIME allowlist and 16-byte magic-byte sniff | API | `src/app/api/admin/upload/route.ts:43-50`, `src/lib/storage.ts:42-58` | **C** |
| 7 | `storeFile(file, visibility)` with **no namespace** → key `public/YYYY-MM/<uuid>.<ext>` or `private/YYYY-MM/<uuid>.<ext>`; the latter is deliberately outside the four operational-private prefixes, which is what later lets it be used as a document original | *filesystem or Blob* | `src/lib/storage.ts:61-83`, `src/lib/storage.ts:27-32` | **C** |
| 8 | `db.media.create(...)` then `db.activityLog.create(...)`; `revalidateTag(CACHE_TAGS.media)`; 201 with the admin DTO (no `storageKey`, REQ-SEC-029) | *Postgres* | `src/app/api/admin/upload/route.ts:54-71`, `src/server/queries/admin-media.ts:23` | **C** |
| 9 | **No compensating delete** if `media.create` throws after the bytes land — the file is orphaned with no row to find it (QA-DB-003) | *gap* | `src/app/api/admin/upload/route.ts:72-75` | **C** |
| 10 | `MediaPicker` writes the chosen media id into a hidden input on the document form | UI | `src/components/admin/pickers.tsx:216` | **C** |
| 11 | `saveDocument` → `adminMutation()` → `requireAdmin()` (ADMIN or EDITOR) | server action | `src/server/actions/admin/evidence.ts:12,16`, `src/server/actions/admin-helpers.ts:21` | **C** |
| 12 | Slot rules: the public file must be `PUBLIC` media; the original must be `PRIVATE`; the original must **not** be operational-private media (REQ-DOC-002/003, REQ-MEDIA-007) | service | `src/server/actions/admin/evidence.ts:23,26,29` | **C** |
| 13 | `documentSchema` refines: personal data requires `isRedacted` before public publication; a published public document requires a public file (REQ-DOC-001/004) | validation | `src/lib/validations/admin.ts:285,289` | **C** |
| 14 | `publishedAtFor` stamps `publishedAt` once and never overwrites it | service | `src/server/actions/admin-helpers.ts:93-96` | **C** |
| 15 | `expire(documents, trust, projects, activities, reports, verification)` → `updateTag` per tag + `refresh()` | cache | `src/server/actions/admin/evidence.ts:36`, `admin-helpers.ts:87-90` | **C** |
| 16 | Public read re-applies the allowlist (`PUBLIC_DOCUMENT_WHERE`) and strips private media from DTOs (REQ-DOC-006) | output | `src/server/queries/public/shared.ts:40,101,122` | **C** |
| 17 | Direct DB / seed writes bypass invalidation; the dashboard offers an `ADMIN`-only manual refresh | cache | `APPLICATION_CONTEXT.md:97`, `src/app/admin/(dashboard)/page.tsx:71-76` | **C** |

### Deletion — where the guard stops

`deleteMedia()` performs exactly two checks before `db.media.delete()`: operational-private files are
refused to non-`ADMIN` (`src/server/actions/admin/media.ts:50`), and media backing a
`PUBLISHED` + `PUBLIC` `Document.fileId` is refused (`:51`, REQ-DOC-005). The `Media` model has
**21 inbound relations**: 4 `Restrict` (the evidence tables), 1 `Cascade` (`GalleryImage`,
`prisma/schema.prisma:1818`) and **16 `SetNull`**. QA-DB-001 already covers the `Restrict` four and
the `Cascade` one. The 16 `SetNull` relations are not covered anywhere:

- `Document.originalFileId` and `Document.thumbnailId` (`prisma/schema.prisma:1576,1577`) — the
  guard counts `fileId` only, so the un-redacted original behind a published redacted document can
  be deleted silently.
- `Trustee.photoId`, `Project.coverId`, `Activity.coverId`, `Story.coverId`, `NewsPost.coverId`,
  `GalleryAlbum.coverId`, `Certificate.imageId`, `AnnualReport.coverId`, `Testimonial.photoId`,
  `HistoryEvent.imageId`, `TrustProfile.logoId`/`heroImageId`, `SiteSetting.ogImageId`
  (`prisma/schema.prisma:853,854,882,935,990,1071,1486,1621,1653,1730,1769,1802,1854`) — deleting
  any of these on a **published** record blanks the image on a live public page and reports
  `"File deleted"`.

Filed as **QA-FLOW-002**. The delete dialog's copy is separately wrong in the other direction
(QA-UI-002), and the code comment at `media.ts:45` ("references are cleared by the schema") is only
true for these 16 and false for the other 5.

### Error paths

| Branch | Behaviour | Evidence |
|---|---|---|
| Cross-origin upload | 403 before auth | `upload/route.ts:21` **C** |
| `PORTAL_USER` uploads | 401 | `upload/route.ts:27` **C** |
| Renamed `.exe` as `image/png` | 415 "File contents do not match its type" | `upload/route.ts:50` **C** |
| Private media into the public slot | field error on `fileId` | `evidence.ts:23` **C** |
| Operational-private file as a document original | field error on `originalFileId` | `evidence.ts:29` **C** |
| Publish a personal-data document without `isRedacted` | schema refine rejects | `src/lib/validations/admin.ts:285` **C** |
| Delete media backing a published document | specific, friendly refusal | `media.ts:52` **C** |
| Delete media backing private evidence | `P2003` unmapped → "Something went wrong. Please try again." | `admin-helpers.ts:26-39` **C** (QA-DB-001) |
| Delete media used by a published gallery or as any cover/photo | succeeds silently; the public page loses the image | `prisma/schema.prisma:1818` and the 16 `SetNull` rows **C** (QA-FLOW-002) |

---

## 6. WF6 — Manual donation intake → donor sees it

**Where this workflow actually ends:** at `PENDING_VERIFICATION`, forever. `DonationStatus` has
exactly one member (`prisma/schema.prisma:65-67`), a SQL `CHECK` constraint pins the column to it
(`prisma/migrations/20261026073000_phase6_donation_intake/migration.sql:81`), and no code path
writes any other value. Verification, receipts, allocation and confirmed totals do not exist —
`getLiveDonationProvider()` always throws (`src/server/payments/provider.ts:17`) and
`requireLiveApprovals()` throws unconditionally (`src/server/fundraising/service.ts:67`). This is
inert **by design** (REQ-APPR-046), not an oversight.

### Happy path

| # | Step | Layer | Evidence | State |
|---|---|---|---|---|
| 1 | `/admin/donations` — `requireAdminPage("ADMIN")`; loads donor profiles, `PUBLISHED` non-demo projects, and the 100 most recent donations | page | `src/app/admin/(dashboard)/donations/page.tsx:13-17` | **C** |
| 2 | A fresh `idempotencyKey` is minted per server render and passed into the form as a hidden input | page → UI | `src/app/admin/(dashboard)/donations/page.tsx:25`, `src/components/admin/donation-intake.tsx:36` | **C** |
| 3 | **Prerequisite:** `linkDonorAccount` → `createDonorProfile` — the account must already exist **and** have role `PORTAL_USER`; `organizationName` kept only for `ORGANIZATION` (REQ-DON-043) | service + *Postgres `DonorProfile`* | `src/server/donations/service.ts:19-24` | **C** |
| 4 | `anonymousByDefault` is never written or read; the form control is checked and `disabled`, so it is excluded from the submission entirely | *gap* | `src/components/admin/donation-intake.tsx:26`, `src/server/donations/service.ts:21` | **C** (QA-REQ-007) |
| 5 | `recordManualDonationIntake` → `run()` → `requireAdmin("ADMIN")` → `manualDonationIntakeSchema` | server action | `src/server/actions/admin/donations.ts:15,41-43` | **C** |
| 6 | Validation: `idempotencyKey` must be a UUID; amount is a rupee string regex with ≤2 decimals and must convert to >0 paise; `receivedAt` cannot be in the future | validation | `src/lib/validations/donations.ts:4-5,15-25` | **C** |
| 7 | `createPendingManualDonation` computes a SHA-256 `requestFingerprint` over the whole payload and looks up the `idempotencyKey` first | service | `src/server/donations/service.ts:35-36` | **C** |
| 8 | Same key + same fingerprint → the **previous** row is returned unchanged; same key + different details → `IDEMPOTENCY_CONFLICT` | service | `src/server/donations/service.ts:37-40` | **C** |
| 9 | Donor must still be `PORTAL_USER`; project must be `PUBLISHED` and `isDemo === false`; a campaign, if given, must belong to that project | service | `src/server/donations/service.ts:45-50` | **C** |
| 10 | Writes `Donation` with `amountPaise` BigInt, `currency: "INR"`, `status: "PENDING_VERIFICATION"` hardcoded, plus an immutable `DonationHistory` snapshot and an audit event, in a Serializable transaction | *Postgres* | `src/server/donations/service.ts:51-61` | **C** |
| 11 | `revalidatePath("/admin/donations")` **and** `revalidatePath("/donor")` | cache | `src/server/actions/admin/donations.ts:17-18` | **C** |
| 12 | Admin sees "Offline donation recorded as pending verification. It is excluded from confirmed totals and balances." | output | `src/server/actions/admin/donations.ts:44` | **C** |
| 13 | Optional evidence: `POST /api/admin/donations/[id]/evidence` — `ADMIN` only, donation must be `PENDING_VERIFICATION`, 40/h, host+protocol origin check, compensating delete | API | `src/app/api/admin/donations/[id]/evidence/route.ts:16,22`, `src/server/donations/service.ts:70` | **C** |
| 14 | The donor opens `/donor`; `getAdminUser()` or redirect; `donorProfile.findUnique({ userId })` with its 100 most recent donations (REQ-DON-045) | page | `src/app/donor/page.tsx:12-14` | **C** |
| 15 | Without a linked profile: "Donor access is not linked. A trust administrator must link this existing portal account…" | output | `src/app/donor/page.tsx:18` | **C** |
| 16 | With a profile: a table of date, project title, method, `formatPaise(amount)` and a status cell containing the **literal string** `"Pending verification"` — not `d.status` | output | `src/app/donor/page.tsx:18` | **C** |
| 17 | A standing banner says donations are not enabled, campaigns are private drafts, and checkout/receipts/confirmed totals are unavailable | output | `src/app/donor/page.tsx:17` | **C** |
| 18 | Footer asserts "Anonymous display is the default; no donor name or amount is published" — a privacy promise with no enforcing code (the flag at step 4 is never read) | output | `src/app/donor/page.tsx:19` | **C** (QA-FLOW-010) |

### Alternative and error paths

| Branch | Behaviour | Evidence |
|---|---|---|
| Email not a `PORTAL_USER`, or no account | `EXISTING_PORTAL_ACCOUNT_REQUIRED` | `service.ts:20` **C** |
| Second donor profile for the same account | `P2002` → "This account already has a donor profile." | `actions/admin/donations.ts:25` **C** |
| `ORGANIZATION` with no name | `superRefine` error — server only, no client mirror (QA-UI-003) | `validations/donations.ts:12` **C** |
| No donor profiles or no published projects | submit button silently disabled, no explanation (QA-UI-005) | `donation-intake.tsx:47` **C** |
| Campaign linkage | supported end-to-end below the UI; `campaignId` is a hardcoded empty hidden input with no picker (QA-UI-004) | `donation-intake.tsx:37`, `service.ts:47-50` **C** |
| Duplicate submit, identical details, same page render | the earlier row is returned and the action still reports success, so a genuinely repeated identical donation would be silently absorbed | `service.ts:37-39` **U** — needs a runtime check of whether `router.refresh()` (`donation-intake.tsx:34`) always lands a new key before a second submit is possible |
| Amount with 3 decimals, or zero | regex / `>0` refine rejects | `validations/donations.ts:4-5` **C** |
| Evidence upload on a non-pending donation | `DONATION_UNAVAILABLE` — unreachable today, since no row can leave `PENDING_VERIFICATION` | `service.ts:70` **C** |

---

## 7. Cross-workflow observations

1. **Every review workflow is pull-only.** WF2, WF3 and WF4 all depend on an administrator
   spontaneously opening an admin page. The submit side writes no notification at all for club
   membership (`src/server/clubs/service.ts:132-143`); the decision side writes outbox rows that no
   consumer ever sends (`qa/architecture/application-architecture.md:90-96`). QA-FLOW-003.
2. **Optimistic concurrency is uniform and correct.** Every reviewed entity carries a `version`, and
   every mutation re-asserts it inside a `Serializable` transaction with a guarded `updateMany`
   (`clubs/service.ts:157`, `volunteers/service.ts:93,108`, `projects/service.ts:224,240`). No
   lost-update window was found on any of the six workflows.
3. **404-not-403 is applied consistently** on every scope-checked read in WF2 and WF4
   (`club/[id]/page.tsx:16`, `volunteer/tasks/[id]/page.tsx:15`,
   `api/project-tasks/[id]/evidence/route.ts:24`, `api/task-evidence/[id]/file/route.ts:14`).
4. **Consent is re-verified at use, not only at capture.** Club approval re-checks the consent
   version (`clubs/service.ts:153`); attendance, task assignment and every task read re-check
   `VOLUNTEER_CONSENT_VERSION` (`volunteers/service.ts:63`, `projects/service.ts:153,199`).
5. **Unit tests guard none of this.** `npm run test:unit` runs six files; three of them
   (`src/server/payments/provider.test.ts`, `src/lib/finance/chart.test.ts`,
   `src/lib/finance/journal-core.test.ts`) exercise modules with **zero importers anywhere in
   `src/`**, and the other three cover pure schemas and definitions. Not one line of the six
   workflows above is executed by the suite that gates CI (`package.json:11-12`). QA-FLOW-008.

---

## 8. Workflows NOT traced, and the evidence each would need

| Workflow | Why it was left out | Evidence that would let it be traced |
|---|---|---|
| Public content publication for trustees, projects, activities, stories, news, gallery, impact | Only the document path was in scope; the other seven share `adminMutation` + `publishedAtFor` + `expire` but each has its own refine set | Line-trace `src/lib/validations/admin.ts` per model (already deferred twice — `qa/architecture/application-architecture.md:104`) plus the matching `queries/public/*` read |
| Fundraising request → campaign | `requireLiveApprovals()` throws unconditionally (`src/server/fundraising/service.ts:67`), so no path reaches a non-DRAFT state | A decision to activate the approval engine, or a test fixture that stubs `requireLiveApprovals` |
| Approval policy DRAFT → ACTIVE | Nothing transitions a policy; `policyTransition` returns `POLICY_ACTIVATION_DISABLED` when unauthorized (`src/lib/approval/definition.ts:118-119`) and no caller passes `authorized: true` | A caller that can pass `authorized: true`; none exists today |
| Notification delivery | No consumer, sender, cron or queue exists | A delivery worker; until then REQ-NOTIF-047 is UNVERIFIABLE (`qa/discovery/requirements-inventory.md:68`) |
| Club project contribution reporting (`reportClubContribution`) | Traced only as far as its guard (`projects/service.ts:89-101`); the `/club/projects/[assignmentId]` screen was not stepped through | Read `src/app/club/projects/[assignmentId]/page.tsx` and `src/components/projects/project-contribution-form.tsx` end to end |
| Vercel Blob storage path | `STORAGE_DRIVER` was never read (values are out of scope) and no Blob call was made | Run the upload and private-read paths with `STORAGE_DRIVER=vercel-blob` against a real Blob store and compare failure modes with the local driver |
| Anything requiring runtime proof | No app, no database, no HTTP exchange in this environment | A disposable Postgres schema plus `npm run dev`; then the route-handler authz matrix proposed in QA-TEST-003 |

### Specific claims in this document that remain UNVERIFIED

1. `getClientIp()` exploitability (QA-AUTH-002) — needs a forged-header request against a deployed
   environment.
2. The idempotency-key duplicate-absorption window in WF6 step "Duplicate submit" — needs a browser
   session to observe whether `router.refresh()` always re-mints the key before a second submit.
3. `QA-FLOW-007` self-review reachability — the chain is traced in code but no `ADMIN` with a
   volunteer profile was observed; a seeded fixture would settle it.
4. Vercel Blob atomicity and failure modes for every `storeFile`/`readPrivateFile` step above.
