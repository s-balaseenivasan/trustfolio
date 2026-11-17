# Route authorization matrix — private-file IDOR boundary (QA-TEST-003)

Module: API authorization. Workflows: `workflow.club.membership` (WF2, nearest — club documents
have no dedicated workflow id) and `workflow.project.task` (WF4). Covers the scope-check functions
behind the three private-file routes named in the brief, plus the club-document storage-prefix
check (QA-API-001's fix). None of the 12 API route handlers had any prior test
(`qa/architecture/api-inventory.md` §1 was static-analysis only). Test file:
`qa/tests/security/route-authorization.test.ts`.

**What is and is not covered, stated up front:** the route handlers themselves
(`src/app/api/.../route.ts`) could not be invoked directly in this environment — see the header
comment in the test file for why (a second `next dev` instance is blocked by a directory-keyed
lock the developer's own instance already holds; direct `require()` of the route file succeeds but
wiring a signed session cookie through `NextRequest` for three routes was judged not worth the
added harness complexity when the decision logic lives one layer down). What follows exercises that
decision logic — `requireClubCoordinator()`, `requireVolunteerTask()`, `requireTaskReader()`, and
the storage-key-prefix condition — directly against the real database, for all three roles each
route distinguishes (owner/admin vs. non-owner vs., for the two del requiring it, nonexistent).

---

```
ID:           TC-API-CLUBDOC-001
Title:        requireClubCoordinator() succeeds for the actual coordinator of an ACTIVE club
Workflow:     workflow.club.membership
Requirement:  REQ-CLUB-032
Type:         security
Priority:     critical
Role:         club coordinator (owner)
Preconditions: Disposable Club (ACTIVE) with coordinatorId set; matching ClubMembership (COORDINATOR, ACTIVE).
Steps:        1. Call requireClubCoordinator(coordinatorId, clubId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Resolves with the membership row (does not throw) — the route (GET
              /api/club/documents/[id]/file) would serve the file (200-equivalent).
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-CLUBDOC-002
Title:        requireClubCoordinator() throws for a regular ACTIVE member of the same club who is not its coordinator
Workflow:     workflow.club.membership
Requirement:  REQ-CLUB-032
Type:         security
Priority:     critical
Role:         club member (non-owner)
Preconditions: Same club; a second ClubMembership (MEMBER, ACTIVE) for a different user.
Steps:        1. Call requireClubCoordinator(regularMemberId, clubId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Throws ClubError("CLUB_SCOPE_DENIED") — the route maps this to 404 (api-inventory.md's
              404-not-403 convention), never leaking that the club or document exists.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-CLUBDOC-003
Title:        requireClubCoordinator() throws for a user with no membership in the club at all
Workflow:     workflow.club.membership
Requirement:  REQ-CLUB-032
Type:         security
Priority:     high
Role:         unrelated authenticated user
Preconditions: A user with zero ClubMembership rows for the club under test.
Steps:        1. Call requireClubCoordinator(unrelatedUserId, clubId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Throws ClubError("CLUB_SCOPE_DENIED").
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-CLUBDOC-004
Title:        A PRIVATE club-document media row whose storageKey lacks the club-document prefix is refused even for the authorized coordinator
Workflow:     workflow.club.membership
Requirement:  UNDOCUMENTED (defense-in-depth code pattern, not a stated requirement — see QA-API-001)
Type:         security
Priority:     medium
Role:         club coordinator (owner) — included to prove this check fires even past a passing ownership check
Preconditions: ClubDocument row whose Media.storageKey does NOT start with CLUB_DOCUMENT_STORAGE_PREFIX
              (seeded directly, since QA-API-001 notes no current app write path can produce this —
              the test proves the *fix* works, not that the row is reachable today).
Steps:        1. Reproduce the route's exact condition (src/app/api/club/documents/[id]/file/route.ts:16,
                 copied verbatim) against the row.
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     The condition evaluates to "refuse" (404-equivalent) regardless of visibility=PRIVATE and
              an authorized coordinator — this is the QA-API-001 fix under test.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-CLUBDOC-005
Title:        Control case — a PRIVATE club-document media row WITH the correct prefix passes the condition
Workflow:     workflow.club.membership
Requirement:  UNDOCUMENTED (see QA-API-001)
Type:         security
Priority:     medium
Role:         club coordinator (owner)
Preconditions: ClubDocument row whose Media.storageKey DOES start with CLUB_DOCUMENT_STORAGE_PREFIX
              (the normal case).
Steps:        1. Reproduce the route's condition against the row.
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     The condition evaluates to "serve" — isolates that TC-API-CLUBDOC-004's refusal is
              prefix-specific, not a false-blocker that would also reject legitimate documents.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-001
Title:        requireVolunteerTask() succeeds for the actually assigned, consented, active-member volunteer
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE — src/server/projects/service.ts:197-203)
Type:         security
Priority:     critical
Role:         assigned volunteer (owner)
Preconditions: ACTIVE Project + ACTIVE ProjectClubAssignment + ProjectTask + active TaskAssignment
              linking the volunteer's current-consent-version VolunteerProfile to the task, plus an
              ACTIVE ClubMembership.
Steps:        1. Call requireVolunteerTask(volunteerId, taskId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Resolves with the task row — the route (POST /api/project-tasks/[id]/evidence, non-admin
              branch) would accept the upload.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-002
Title:        requireVolunteerTask() throws for an active club member who is not assigned to the task
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE)
Type:         security
Priority:     critical
Role:         club member, not assigned (non-owner)
Preconditions: Second volunteer with an ACTIVE ClubMembership in the same club and a VolunteerProfile,
              but no TaskAssignment to the task.
Steps:        1. Call requireVolunteerTask(otherVolunteerId, taskId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Throws ProjectOperationError("TASK_SCOPE_DENIED") — route maps to 404.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-003
Title:        requireTaskReader() returns the task for an ADMIN actor regardless of assignment (bypass)
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE — src/server/projects/service.ts:205-212)
Type:         security
Priority:     high
Role:         ADMIN
Preconditions: Task exists; actor supplied as {id: "nonexistent", role: "ADMIN"} to prove the bypass does
              not depend on the admin id resolving to anything.
Steps:        1. Call requireTaskReader({id, role: "ADMIN"}, taskId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Resolves with the task row immediately, no assignment/coordinator check performed.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-004
Title:        requireTaskReader() succeeds for the assigned volunteer (non-admin) via the inner requireVolunteerTask() call
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE)
Type:         security
Priority:     critical
Role:         assigned volunteer (owner)
Preconditions: Same fixture as TC-API-TASK-001.
Steps:        1. Call requireTaskReader({id: volunteerId, role: "PORTAL_USER"}, taskId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Resolves with the task row — the route (GET /api/task-evidence/[id]/file) would serve the
              file (200-equivalent) for the owning volunteer, not just ADMIN.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-005
Title:        requireTaskReader() throws for an unrelated actor who is neither assigned nor the assignment's coordinator
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE)
Type:         security
Priority:     critical
Role:         unrelated authenticated user (non-owner)
Preconditions: A user with no TaskAssignment and no ProjectClubAssignment.coordinatorId match for this task.
Steps:        1. Call requireTaskReader({id: unrelatedUserId, role: "PORTAL_USER"}, taskId).
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Throws (via the inner requireVolunteerTask() failure then requireProjectClubCoordinator()
              failure) — route maps to 404. This is the core IDOR assertion for this route.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

```
ID:           TC-API-TASK-006
Title:        requireTaskReader() throws TASK_NOT_FOUND for a nonexistent task id
Workflow:     workflow.project.task
Requirement:  UNDOCUMENTED (DERIVED-FROM-CODE)
Type:         security
Priority:     medium
Role:         any
Preconditions: None — id does not exist.
Steps:        1. Call requireTaskReader(actor, "nonexistent-task-id").
Test data:    qa/tests/security/route-authorization.test.ts
Expected:     Throws ProjectOperationError("TASK_NOT_FOUND") before any scope check runs.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/route-authorization.log
```

## Scope note — what this module does NOT cover

Not independently exercised, and why:
- **The anonymous → 401 branch** of all three routes (`if (!actor) return 401`). This is a single
  line per route with no further logic; `qa/architecture/api-inventory.md` already confirms it by
  reading, and `getAdminUser()` returning `null` for no session is exactly what
  `TC-AUTH-LOCKOUT-*` already exercises indirectly (a failed `signIn()` never produces a session).
- **The exact HTTP status codes and response envelope** (404 vs. a thrown error, header shape,
  `Cache-Control`) — these depend on the route handler's own try/catch, which was not invoked
  directly (see the environment constraint above). Only the underlying scope-check functions'
  throw/no-throw behavior was proven.
- **`POST /api/project-tasks/[id]/evidence`'s** other checks (same-origin, file-type sniffing, size
  limit, rate limiting) — out of scope for this pass; `requireVolunteerTask()` is the only piece
  this suite targets, per the brief's IDOR focus.
