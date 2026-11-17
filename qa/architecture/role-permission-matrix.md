# Trustfolio — Role and Permission Matrix

Built from guards **present in code**. Claims found only in documentation are listed separately.

## Roles enforced in code

`Role` enum (`prisma/schema.prisma:24-28`): `ADMIN`, `EDITOR`, `PORTAL_USER`.

| Role / scope | Enforced by | Evidence |
|---|---|---|
| **ADMIN** | `requireAdmin("ADMIN")` / `requireAdminPage("ADMIN")` — identity, settings, navigation, social, users, clubs, project-operations, fundraising, donations, volunteers, approvals | `src/server/auth-guard.ts:33-48`; call sites across `src/app/admin/(dashboard)/*/page.tsx` and `src/server/actions/admin/*` |
| **EDITOR** | `requireAdmin()` / `requireAdminPage()` with no role argument → ADMIN **or** EDITOR; PORTAL_USER explicitly excluded | `src/server/auth-guard.ts:33-48` |
| **PORTAL_USER** | Denied every `/admin` page and action; scoped to `/club`, `/volunteer`, `/donor` via per-page `getAdminUser()` plus service-level scope guards | `src/server/auth-guard.ts:36,45` |
| **Club coordinator** (a `ClubMembershipRole`, not a `Role`) | `requireClubCoordinator()` — membership ACTIVE, `role === COORDINATOR`, club ACTIVE, and `club.coordinatorId === userId` | `src/server/clubs/service.ts:203-212` |
| **Project-assignment coordinator** | `requireProjectClubCoordinator()` — assignment ACTIVE, club ACTIVE, coordinator match, project status in `["ACTIVE","PLANNED"]`, required permission flag set, plus a live club-membership re-check | `src/server/projects/service.ts:81-86` |
| **Assigned volunteer (task)** | `requireVolunteerTask()` — active `TaskAssignment` at the current `VOLUNTEER_CONSENT_VERSION`, task/assignment/club/project all ACTIVE, plus live membership re-check | `src/server/projects/service.ts:197-203` |
| **Reviewer independence** | `reviewVolunteerRecord()` throws `SELF_APPROVAL` when `row.profile.userId === actorId`; `reviewTaskCompletion()` throws when the actor is one of the task's assignees | `src/server/volunteers/service.ts:92,106`; `src/server/projects/service.ts:237` |

Session integrity: `getAdminUser()` re-reads the user row from the database on **every** request, so
deleting a user revokes access immediately even with a valid JWT (`src/server/auth-guard.ts:22-30`).

## Documented but not enforced, or not yet active

| Claim | Status in code |
|---|---|
| Phase 1 approval engine (`ApprovalPolicy`, `AccessGroup`, `READ`/`WRITE`/`APPROVE` effects) | Present in schema and `src/server/approval/foundation.ts`, reachable only as DRAFT. Nothing transitions a policy to ACTIVE from a live workflow; `src/server/fundraising/service.ts:67-68` throws `APPROVAL_POLICY_INACTIVE` / `PUBLIC_RELEASE_INACTIVE` unconditionally. Confirmed inert by design. |
| Live payment provider / online donation collection | `getLiveDonationProvider()` always throws (`src/server/payments/provider.ts:17-19`). No role can reach it because the path does not exist. |
| Donor "verified" / "receipt" states | `DonationStatus` has only `PENDING_VERIFICATION` (`prisma/schema.prisma:65-67`). No code path sets any other status; the verification/receipt language in the docs has no enforcing code. |
| Notification delivery to users | `NotificationOutbox` rows are created but never consumed or sent. Role-targeted notifications are **recorded, not delivered** — see QA-NOTIFY-007. |

## Audit priority

The scope guards are the highest-risk code in the application and have **zero automated coverage**
(QA-TEST-003). Of particular note for later phases:

- `/club`, `/volunteer` and `/donor` have no shared layout guard — each page must call
  `getAdminUser()` individually. A page that omits it is unauthenticated with no second line of
  defence. This needs enumerating page by page.
- Three API routes authorize with `getAdminUser()` plus a scope check rather than a role check.
  Those scope checks are the IDOR boundary for private file downloads.
