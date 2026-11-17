# Trustfolio permissions matrix

Status: **proposed full authorization matrix; Phase 1 draft configuration and Phase 2–5 operational scope implemented**. Updated: 2026-10-26. No person has been granted a new financial approval group or production policy authority. `D-03` fixes no self-approval and proposes the groups below, but actual assignments, thresholds and delegation authority remain open. The club/volunteer portion of `D-05` is confirmed.

Phase 2 adds `PORTAL_USER`, which cannot enter existing `/admin` pages or actions. A club coordinator must have an active approved `ClubMembership` with role `COORDINATOR`, match the club's assigned `coordinatorId`, and the club itself must be active. Club membership alone gives no project access. Applicants use existing accounts, attest they are 18 or older, and explicitly consent before a trust admin may approve; the maker cannot approve their own request. Club files are uploaded into a dedicated private namespace and served only after a fresh club-scope check. Legacy editor media lists, file reads, metadata edits and trust-document original linking exclude that namespace. Age is self-attested, so the trust admin remains responsible for review.

Phase 3 volunteer profile, availability, attendance and hours writes are owner-only. Attendance submission requires an active approved membership of the named active club; hours require that person's approved attendance and still-active club membership. Only legacy `ADMIN` may review, and may not review their own record. Only APPROVED service minutes linked to APPROVED attendance contribute to the volunteer total. A coordinator sees skills/interests only for an active member of their own club who explicitly opted in; no availability, attendance or private profile is exposed to coordinators or public routes. Direct actions recheck these rules server-side. No new approval group or financial/public-release policy is activated.

Phase 4 project planning, club assignment grants, milestone/task creation and task completion review use legacy `ADMIN` only. An assignment coordinator needs an active approved membership in that exact club plus an active assignment; `canViewTasks` and `canReportContribution` independently control scoped reads and contribution writes. A volunteer needs a current consented profile, active membership and explicit active task assignment to read or update that task. The volunteer cannot change another task; the admin reviewer cannot have ever been assigned the reviewed task. Private task evidence read routes repeat these scope checks, and legacy editor media routes exclude the task evidence namespace. Existing public `Project.status` is never inferred from operational status.

Phase 5 donation request and campaign **draft** reads/writes require the legacy `ADMIN` role on every page, action and file route. `EDITOR`, `PORTAL_USER`, club coordinators, volunteers, donors and public visitors receive no fundraising draft permission. Dedicated `private/donation-request-evidence/` files are excluded from legacy editor media pickers and served only after a fresh trust-admin check. Database constraints disallow submitted/approved request states and public/active campaign states. A trust admin gains no financial or public-release approval bypass: those policies remain inactive.

Phase 1 stores `AccessGroup`, `Permission`, group-permission mappings and draft memberships. The eight proposed group records are `TRUST_ADMIN`, `TRUSTEE_APPROVER`, `FINANCE_MANAGER`, `FINANCE_OFFICER`, `PROJECT_MANAGER`, `CLUB_COORDINATOR`, `CONTENT_APPROVER` and `AUDITOR`. They are catalog entries only. There are no new active memberships; existing `ADMIN`/`EDITOR` content access remains in force. The `AUDITOR` group accepts read permissions only. The draft approval engine is gated off for live decisions, including for `TRUST_ADMIN`.

## Authorization model

Authenticate the person, then evaluate an explicit permission and resource scope on the server for every read, action, export and file request. `UserRole` identifies capabilities; `UserScope` limits global/club/project/own-record access and dates. Club membership is evidence for a possible club grant, not automatic access to every linked project. An assignment supplies project-specific permissions. Deny by default. A person may hold several roles, but a transaction uses one authorized capacity and records it in the audit event. Portal selection and hidden buttons have no security meaning.

Existing `ADMIN` and `EDITOR` map to current content behavior during migration. Expansion role labels below are proposed capabilities, not automatic mappings of every existing admin to finance authority. A dedicated access administrator may manage grants but cannot grant themself financial posting/approval authority without a separately approved policy.

Legend: `G` = global permission, `S` = explicitly scoped, `O` = own records only, `A` = eligible under a versioned approval policy, `—` = deny. Public release also requires publication eligibility.

| Operation | Trust admin/content editor | Club coordinator | Volunteer | Donor | Finance maker | Finance checker/approver | Accountant/poster | Public |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trust identity/settings/users | G admin; content editor only current content grants | — | — | — | — | — | — | Published only |
| Club create/archive/grants | G with permission | S profile only if granted | — | — | — | — | — | Published only |
| Club membership request/decision | G if granted | S decision if granted | O request | — | — | — | — | — |
| Volunteer profile/availability | G limited staff | S minimum needed for assignment | O | — | — | — | — | Consented public opportunity data only |
| Project operational plan | G if granted | S assigned project fields | O assigned view | — | — | — | S budget view if granted | Published content only |
| Project task create/assign/review | G if granted | S project-specific grant | O update of assigned task fields | — | — | — | — | — |
| Donation request submit/approve | G submit if granted; `A` approve | S submit if granted | — | — | S finance review if granted | A | — | Published campaign only |
| Campaign publish/unpublish | A publication grant | — | — | — | — | A if designated | — | Published view |
| Donor profile/payment/receipt | Phase 6: ADMIN links existing PORTAL_USER account; no donor-self registration or receipt action | — | — | O own pending history only | — | — | — | — |
| Manual donation enter/verify | Phase 6: ADMIN records pending intake and private evidence only | — | — | — | Future scoped maker | Future distinct checker | Future poster only | — |
| Fund/budget/expense creation | No implied finance grant | S request if granted | — | — | S create | A approve | S post/close if granted | Approved summary only |
| Journal post/reverse/period close | No implied finance grant | — | — | — | — | A authorization | S execute after approval | Approved aggregate only |
| Reconciliation import/match/approve | No implied finance grant | — | — | — | S import/match if granted | A approve, separate matcher | S accounting review | Approved aggregate only |
| Policy/grants/audit/export | G only specific administration/audit permissions | S own activity | O own activity | O own history | S finance work | S decisions | S books | — |
| Private documents | G only if explicit file permission | S own club/project files | O assigned files | O own receipts | S evidence needed | S evidence needed | S accounting evidence | — |

The final role-permission table, thresholds and grant administrators require approval. Existing content admin access is preserved while explicit finance grants are introduced.

## Scope and separation rules

1. `requirePermission(permission, scope)` checks current user state, role grants, scope validity, club/project assignment, entity state and any self-approval rule. It is called by query, action, export and file code. A list query applies the scope in SQL before pagination, not after retrieving all records.
2. Volunteer updates target only their own active task assignment; coordinator updates require the specific active project-club assignment and a task permission. A coordinator for Club A cannot read Club B through a shared project unless explicitly granted the shared record view.
3. Donor access is own-profile/own-transaction by stable user/donor binding. Organization donor delegates need a separately approved membership/authority model; never infer access from an email domain.
4. Financial maker, checker, approver, payment executor, poster and reconciler are distinct permissions. A maker can never approve their own request, including through another role or delegated authority. `D-03` still must define actual assignments, thresholds and any further separation rules. A global administrator has no automatic financial approval bypass.
5. Permission and scope changes are audited and take effect on subsequent server checks. In-flight approvals retain policy snapshots but eligibility rechecks current active identity/grants at decision time.
6. Public permission is never inferred from an internal record being approved. `ContentStatus`, privacy, consent, source accessibility and the public disclosure approval all apply.

## File, API and data boundaries

- Operational attachments default private. Grant file reads by explicit linked entity and allowed role/scope. Existing `/api/admin/media/[id]/file` remains admin-only for legacy originals; new portal private-file routes require their own scope checks. Phase 6 donation evidence uses a dedicated private prefix and ADMIN-only fresh authorization; donor references, private notes, and evidence are not returned in the donor DTO.
- Public `/uploads` serves only the public storage root. Public document selection requires a public, published, accessible file and any required redaction. Block deleting a file needed by a published claim or atomically unpublish the dependent claim under approved workflow.
- Gateway webhooks authenticate the provider signature and event identity; they never use a donor browser session. Their permissions are narrowly scoped to payment-state transitions.
- Payment, donor, volunteer, bank, approval and journal rows are private by default and excluded from shared public cache and metadata. Public DTO allowlists and exports receive independent privacy tests.
- Every privileged mutation emits an immutable audit event in the same transaction where practical. Structured logs omit secrets and private payloads.

## Verification

`../testing/test.md` includes matrix tests for every portal, cross-club/project access, multi-role isolation, self-approval, donor ownership, file leakage, export leakage and revoked grants. Access denied by UI must also be denied by direct action/route invocation.
