# Trustfolio UI requirements and design (UIRD)

Status: **target screens and interactions; Phase 1 draft approval and Phase 2–6 gated operational screens implemented locally**. Updated: 2026-10-26. Requirement IDs refer to `../requirements/trustfolio-frd.md`; remaining decisions `D-*` stay open. The live approval inbox and donor payment workflows remain future work.

Implemented Phase 2 screens are `/admin/clubs` (filter, list, draft creation), `/admin/clubs/[id]` (profile, status, existing-account invitation, membership decisions, coordinator appointment, dedicated private upload, history), `/club` (own memberships and active-club requests), and `/club/[id]` (coordinator-only members and private documents). The club portal offers English interface copy and bilingual club fields; complete Tamil portal interface translation remains a later localization task. It does not publish club profiles to anonymous visitors.

Phase 3 adds `/volunteer` for a private consented profile, skills/interests, weekly availability, active-club attendance, approved-attendance hours, reviewed totals and decision history. `/admin/volunteers` has private profile search and separate paginated submitted/approved review lists for attendance and hours; corrections require a reason. `/club/[id]` shows opted-in skills only for active members of that club. Phase 4 adds `/admin/project-operations`, `/club/projects` and `/volunteer/tasks` with scoped assignment, task progress, review and private evidence views. These new portal screens currently use English UI copy; full Tamil coverage and certificate issuance remain pending.

Phase 5 adds ADMIN-only `/admin/fundraising` project selection, project request drafts and a request detail page with exact INR target, private evidence upload/read, one linked campaign planning draft and a bilingual private preview. The UI labels approval, publication and collection as closed; no anonymous campaign page or donation progress is rendered. New admin copy is English, while campaign content fields support English/Tamil with visible English fallback in the private preview. Request deadline and supporting evidence may be omitted while drafting but become required checks before a future submission workflow opens.

Phase 6 adds ADMIN-only `/admin/donations` with existing portal-account donor linking, offline cash/bank/UPI intake, exact INR paise, private supporting evidence and visibly pending-only status. `/donor` shows only the signed-in linked donor's pending history and keeps references/private notes hidden. These portal screens currently have English UI copy. No campaign browsing, checkout, receipt download, verification action or public collection progress is available; those controls remain closed until provider, approval and accounting gates are approved.

## Design foundation

Retain the existing institutional visual language, Tailwind design tokens, accessible `src/components/ui` primitives, admin table/form components and English/Tamil localization helpers. New portals should feel related but show only their own navigation and data. The route layout never grants access; every screen and action uses server checks. Proposed portal routes are `/admin`, `/club`, `/volunteer`, and `/donor`; public routes remain `/en/*` and `/ta/*`.

Use responsive layouts from narrow mobile through desktop. Tables become horizontal scroll or structured cards where necessary, without hiding critical amounts/status. Provide keyboard focus, labels, validation summaries, readable Tamil line height, accessible dialogs, loading/empty/error states and reduced-motion behavior. Display exact money with currency and period; show operational, approval, accounting and publication statuses as separately labeled fields.

## Information architecture

| Portal | Navigation | Critical screens |
| --- | --- | --- |
| Trust admin | Dashboard; Clubs; Volunteers; Projects; Tasks; Donation Requests; Campaigns; Donors; Donations; Finance; Funds; Budgets; Expenses; Approvals; Reports; Evidence; Notifications; Users and Permissions; Audit Logs; Settings | Work queues, scoped record detail, review/approval forms, finance journals, reconciliations, publication preview. Existing content menu remains available. |
| Club | Dashboard; My Clubs; Club Members; Assigned Projects; Tasks; Volunteers; Activities; Attendance; Documents; Reports; Notifications | Membership queue, assignment responsibilities, club contribution, authorized task board. |
| Volunteer | Dashboard; My Clubs; My Projects; My Tasks; Schedule; Attendance; Service Hours; Certificates; Notifications; Profile | Join request, availability/privacy, task update and evidence, service-hour correction request. |
| Donor | Dashboard; Explore Projects; Donation Campaigns; My Donations; Payment History; Receipts; Supported Projects; Recurring Donations; Notifications; Profile and Privacy | Campaign detail, checkout, pending/failed outcome, receipt, refund/dispute status. Recurring navigation is shown only if `D-04` enables it. |
| Public | Existing bilingual site plus Clubs; Opportunities; Campaigns; Project donation progress; Approved financial summaries; Utilization and completed project reports | Every new public page has English/Tamil content fallback, evidence links and publication states. |

## Screen specifications

| ID | Screen/flow | Required controls and states | Permission/data rule |
| --- | --- | --- | --- |
| UI-01 | Portal dashboard | Role/scope switcher, assigned work, pending approvals, exceptions, notifications; loading and empty states. | Counts use only authorized rows; a portal switch does not change grants. FR-IDN-01. |
| UI-02 | Club directory/detail | Search/filter, create/edit/archive, unique code, coordinator, members, projects, documents, history. | Club coordinator sees assigned clubs only. FR-CLB-01/03. |
| UI-03 | Membership flow | Invite or request, status, approver, reason, effective dates, role, history. | Duplicate active membership blocked; reject/return reason visible only to entitled parties. FR-CLB-02. |
| UI-04 | Volunteer profile | Skills, interests, availability, privacy/consent, participation and certificate tabs. | Sensitive fields masked from public and unrelated coordinators. FR-VOL-01/02. |
| UI-05 | Project workspace | Existing bilingual public-content editor linked to operational plan, owner, clubs, milestones, tasks, budget, requests, expenses and evidence. | Operational and public status shown independently; retain old slug/routes. FR-PRJ-01/02. |
| UI-06 | Task board/detail | Filter by project/club/assignee/status/priority/due date; updates, dependencies, attachments, review and history. | Volunteer controls limited to assigned task fields. FR-TSK-01/02. |
| UI-07 | Donation request review | Purpose, amount, needed-by date, evidence, approver steps, comments, return/reject reason and timeline. | Submission locks approval snapshot; private comments do not render publicly. FR-FND-01, FR-APR-01. |
| UI-08 | Campaign editor/preview | Approved request reference, bilingual copy, target, dates, supporting public files and separate publish action. | Preview identifies missing eligibility; approval alone cannot make campaign active. FR-FND-02. |
| UI-09 | Donation checkout | Campaign/project selection, exact amount, donor/anonymous-public preference, consent, provider handoff and pending/success/failure views. | No success claim until server verification; never expose provider secret. FR-DON-01/02. |
| UI-10 | Manual donation entry/check | Current: ADMIN intake form for existing donor profile, published project, cash/bank/UPI, date/reference/private note and private evidence. | Pending-only; no checker, reconciliation, receipt or confirmed total. Idempotency token prevents duplicate form submission. FR-DON-03. |
| UI-11 | Donor history/receipt | Current: own pending records with project, date, method and INR amount. Receipt/download, confirmed/refund states, supported campaigns and communication controls remain future. | Donor reads only records bound to current user; private references, notes and evidence are omitted. FR-DON-01/04. |
| UI-12 | Finance workbench | Funds, accounts, budgets, expenses, journals, periods, reconciliation, exceptions and report export. | Show source, maker/checker, posting status, period and reversal chain; no edit of posted lines. FR-FIN-01..07. |
| UI-13 | Approval inbox/policy | Eligible queue, policy version, step/quorum, delegation, history, reason, approve/reject/return. | Ineligible/self-prohibited actors see no actionable control and are rejected server-side. FR-APR-01/02. |
| UI-14 | Public finance/evidence | Approved aggregate, as-of date, scope, method, source/evidence, caveat and bilingual fallback. | No donor identity, raw ledger, bank data, internal comments or private file. FR-PUB-01..03. |
| UI-15 | Audit/notifications | Search by actor/entity/date/event; inbox, delivery status, preferences. | Audit access is permission-gated; no sensitive payload in list previews. FR-AUD-01, FR-NTF-01. |

## Interaction and content rules

- Confirmation dialogs for archive, approval, posting, refund, period close and publication show the exact record, amount, fund and effect. A destructive or irreversible step requires the role granted by policy; a dialog alone is not a control.
- State changes use a version token. On conflict, preserve entered data and show “This record changed; review the latest version” with a reload action. Never submit a duplicate money action automatically.
- Forms show field-level validation, a summary, safe error code and next action. Payment/network uncertainty says “Pending verification” and offers status refresh; it never says “Donation received” before confirmation.
- Public and donor money views distinguish target, confirmed collected, refunds, allocated, spent and available amounts; these are not interchangeable. Definitions await `D-01`, `D-02` and `D-06`.
- File picker marks public/redacted versus private/original. Publication preview must show exactly what a visitor will see, including missing Tamil fallback and inaccessible evidence warnings.
- The existing English-reference and human-reviewed Tamil pattern applies to new public content, receipt messages and portal UI. No automatic translation or legal text is assumed.

## Accessibility and responsive acceptance

Keyboard-only users can complete membership, task, donation and approval workflows; dialogs trap/restore focus; status is conveyed in text as well as color; errors are announced and linked to fields; tables have headers/captions; exported report controls have accessible names. Verify both locales at 320 px, tablet and desktop widths, plus system Chrome headed Playwright for each portal. Actual results belong in `../testing/test.md` execution records, not this design.

## Decision-dependent content

`D-03` now confirms a draft-only engine and eight proposed group names; actual assignments, thresholds, delegation and activation remain undecided. `D-04` determines provider/recurring UI; `D-05` determines registration and minor/guest flows; `D-06` determines public disclosure depth. Other screens remain specifications and cannot be treated as accepted behavior.
