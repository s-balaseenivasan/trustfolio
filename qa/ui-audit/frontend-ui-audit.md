# Trustfolio — Frontend UI Audit

Phase 4 (UI/UX) output. Static analysis only — the app was not started; nothing in this report was
observed rendering. Scope: Next.js 16 App Router + React 19 + Tailwind 4, server-rendered, no
separate SPA. Audited by risk, not by file count: ~38 elements traced in depth out of 162 `.tsx`
files, concentrated on admin CRUD (`entity-form.tsx`, `resource-table.tsx`, `fields.tsx`, the
`forms/*` family), the generic admin resource list/table, the operationally dense admin screens
(clubs, volunteers, project-operations, donations, users, approvals), public listing/search pages,
and the portal-facing forms (club, volunteer, donor). Authorization correctness is phase 5's scope;
where a role-gating observation surfaced here it is cross-referenced, not re-investigated.

Classification set and columns follow `$SKILL_DIR/references/ui-audit-rules.md`.

## 1. Element inventory

| Element ID | Screen / route | Component:line | Type | Roles | Purpose | Handler | API/Action | Validation | Classification |
|---|---|---|---|---|---|---|---|---|---|
| UI-WEB-ADMIN-001 | `/admin/[resource]` | `resource-table.tsx:57` | Status/translation/demo filter pills + search | ADMIN, EDITOR | Filter the admin list client-side | `onClick`/`onChange` set local state, re-filters `rows` | NONE (client-side over server-rendered rows) | n/a | Essential |
| UI-WEB-ADMIN-002 | `/admin/[resource]` | `resource-table.tsx:171` | Bulk publish/draft/archive/delete bar | ADMIN, EDITOR | Bulk status change | `run()` → `bulkAction()` | `bulkAction` (`src/server/actions/admin/bulk.ts`) | Server-side only | Essential |
| UI-WEB-ADMIN-003 | `/admin/[resource]` | `resource-table.tsx:193` | Empty state (no rows / no matches) | ADMIN, EDITOR | Explains empty list, offers "New" or "Clear filters" | Link / button | n/a | n/a | Essential |
| UI-WEB-ADMIN-004 | `/admin/[resource]` | `resource-table.tsx:342` | Delete confirmation dialog | ADMIN, EDITOR | Confirm destructive bulk delete | `AlertDialogAction` → `run("delete")`; `AlertDialogCancel` dismisses | `bulkAction` | n/a | Essential |
| UI-WEB-ADMIN-005 | admin lists (toggle cells) | `row-actions.tsx:33` | `ToggleAction` switch | ADMIN, EDITOR | Optimistic publish/feature toggle | `onCheckedChange` → bound action | varies by caller | n/a | Essential |
| UI-WEB-ADMIN-006 | admin lists/forms | `row-actions.tsx:76` | `DeleteButton` + `AlertDialog` | ADMIN, EDITOR | Confirmed delete with dismissal path | `AlertDialogAction` → bound action | varies by caller | n/a | Essential |
| UI-WEB-ADMIN-007 | every `/admin/*/[id]` edit form | `entity-form.tsx:40` | `EntityForm` wrapper (`useActionState`) | ADMIN, EDITOR | Submit, surface server field errors, focus first invalid field | `formAction` → bound server action | all `src/server/actions/admin/*` | **Server-only** — form has `noValidate`; no client Zod | Essential |
| UI-WEB-ADMIN-008 | trustee/category/project/activity/story forms | `fields.tsx:202` `SlugField` | Auto-slug-from-title input | ADMIN, EDITOR | Derive URL slug from the bilingual title until hand-edited | `input` event listener on the form | `slug` validator server-side | Client: none beyond lowercase+hyphen typing | Essential |
| UI-WEB-ADMIN-009 | Trustee form | `trust-forms.tsx:19` | Full bilingual field set | ADMIN, EDITOR | Edit trustee profile | `EntityForm` → `saveTrustee` | `src/lib/validations/admin.ts:77` `trusteeSchema` | **maxLength attrs match schema max() exactly** (120/120/10000/2000/6000/15×200) | Essential |
| UI-WEB-ADMIN-010 | Trustee form | `trust-forms.tsx:36` | `publicationConsent` switch | ADMIN, EDITOR | Gate publish on recorded consent | `SwitchField` | `trusteeSchema.refine` requires consent when status=PUBLISHED | Client: none (visual only); server: enforced | Essential |
| UI-WEB-ADMIN-011 | Project/Activity/Story/Testimonial forms | `work-forms.tsx` | Bilingual content forms | ADMIN, EDITOR | Edit work/voices content | `EntityForm` → `save*` actions | matching schemas in `admin.ts` | maxLength parity verified for project/activity/testimonial/story | Essential |
| UI-WEB-ADMIN-012 | Testimonial form | `work-forms.tsx:201` | `relationshipVerified` switch | ADMIN, EDITOR | Flag a relationship as confirmed | `SwitchField` | **none** — no refine ties it to evidence | See QA-REQ-004 (existing, not re-filed) | Unclear purpose |
| UI-WEB-ADMIN-013 | Category manager (dialog) | `category-manager.tsx:26` | Add/edit/delete category | ADMIN, EDITOR | Manage taxonomy | `EntityForm` in a `Dialog` | `saveCategory`/`deleteCategory` | slug+name parity verified | Essential |
| UI-WEB-ADMIN-014 | Media library | `media-library.tsx:25` | Filter pills + search + visibility toggle | ADMIN, EDITOR | Filter/upload media | local state + `uploadMedia()` | `/api/admin/upload` | n/a | Essential |
| UI-WEB-ADMIN-015 | Media library (dialog) | `media-library.tsx:216` | Delete confirmation | ADMIN, EDITOR | Confirm file deletion | `DeleteButton` → `deleteMedia` | `src/server/actions/admin/media.ts:46` | n/a | **Broken copy — QA-UI-002** |
| UI-WEB-ADMIN-016 | Pickers (used across all content forms) | `pickers.tsx:216` `MediaPicker` | Media chooser dialog | ADMIN, EDITOR | Attach image/document | `MediaLibraryDialog` → hidden input | `/api/admin/media`, `/api/admin/upload` | `required` prop is visual only, not enforced client-side | Useful |
| UI-WEB-ADMIN-017 | Pickers | `pickers.tsx:348` `RelationPicker` | Searchable multi-select checklist | ADMIN, EDITOR | Link evidence documents etc. | local state → hidden JSON input | server `idList` schema | n/a | Essential |
| UI-WEB-ADMIN-018 | Donations | `donation-intake.tsx:16` `DonorLinkForm` | Link existing PORTAL_USER as donor | ADMIN only | Create private donor profile | `useActionState` → `linkDonorAccount` | `donorProfileSchema` | **No client mirror of conditional org-name requirement — QA-UI-003** | Useful |
| UI-WEB-ADMIN-019 | Donations | `donation-intake.tsx:26` | Disabled `anonymousByDefault` checkbox | ADMIN only | Shows intended default | n/a (disabled → excluded from submit) | n/a | Cross-ref existing **QA-REQ-007** (field never read) | Broken (pre-existing finding) |
| UI-WEB-ADMIN-020 | Donations | `donation-intake.tsx:31` `ManualDonationIntakeForm` | Record offline pending donation | ADMIN only | Private intake record | `useActionState` → `recordManualDonationIntake` | `manualDonationIntakeSchema` | reference/privateNote maxLength matches schema | Useful |
| UI-WEB-ADMIN-021 | Donations | `donation-intake.tsx:37` | Hidden `campaignId` input, always `""` | ADMIN only | Would link intake to a campaign | n/a | accepted, used server-side when non-empty | **No UI control exists — QA-UI-004** | Potentially unused |
| UI-WEB-ADMIN-022 | Donations | `donation-intake.tsx:47` | Submit button, disabled when no donors/projects | ADMIN only | Prevent invalid submit | `disabled` expression | n/a | **No empty-state explanation — QA-UI-005** | Useful |
| UI-WEB-ADMIN-023 | Donations | `donation-intake.tsx:51` `DonationEvidenceUpload` | Private evidence upload | ADMIN only | Attach evidence file to a donation | `fetch()` POST, manual pending/error state | `/api/admin/donations/[id]/evidence` | file `accept` + required title (3–160 chars) | Essential |
| UI-WEB-ADMIN-024 | Users | `user-manager.tsx:24` `RoleSelect` | Inline role dropdown per user | ADMIN only | Change a user's role | `onValueChange` → `updateUserRole` | `src/server/actions/admin/settings.ts:103` | **Server mirrors every client guard exactly** (self-change blocked, last-admin protected) — verified, no gap | Essential |
| UI-WEB-ADMIN-025 | Users | `user-manager.tsx:111` | Add-user form + role radios | ADMIN only | Create account with temp password | `useActionState` → `createUser` | `userSchema` | n/a | Essential |
| UI-WEB-ADMIN-026 | Approval drafts | `approval-foundation.tsx` (whole module) | ~15 draft-only forms (groups, permissions, policy builder, delegation, simulation) | ADMIN only | Model Phase-1 approval engine | multiple `useActionState` forms | `src/server/actions/admin/approvals.ts` | n/a | Useful (explicitly inert by design, matches architecture report — not a bug) |
| UI-WEB-ADMIN-027 | Clubs | `club-management.tsx:84` | Profile/status/membership/coordinator/documents editor | ADMIN only | Full club operations | 7 separate `useActionState` forms | `src/server/actions/admin/clubs.ts` | **Every client disable condition (consent, active-club, self-approval) is independently re-checked server-side** — verified | Essential |
| UI-WEB-ADMIN-028 | Volunteers | `volunteer-review.tsx:8` | Attendance/service review decision form | ADMIN only | Approve/reject/void a record | `useActionState` → `decideVolunteerRecord` | `reviewVolunteerRecord` (min-3-char reason for non-approve) | **Reason input has no `required`/`minLength` — QA-UI-001** | Broken |
| UI-WEB-ADMIN-029 | Project operations | `project-operations.tsx:52` `TaskRow` | Assign/dependency/review/status controls per task | ADMIN only | Operate on a task | 4 `useActionState` forms per row | `src/server/actions/admin/project-operations.ts` | Completion-review "reason if returning" **has no `required`/`minLength`, unlike the sibling status form 20 lines later — QA-UI-001** | Broken |
| UI-WEB-ADMIN-030 | Admin shell | `admin-shell.tsx:109` `SidebarNav` | Role-filtered navigation | ADMIN, EDITOR | Hide ADMIN-only sections from EDITOR | `.filter(item => !item.adminOnly \|\| role === "ADMIN")` | n/a | **Every `adminOnly` item verified to match the target page's `requireAdminPage("ADMIN")` call** — no nav/guard mismatch found | Essential |
| UI-WEB-PUBLIC-001 | Projects/Activities/Documents/News/Gallery/Stories/Trustees listing pages | `filter-shell.tsx:43` | Category + year + search filter, URL-synced | Public | Filter listing without reload | `update()` rewrites `history.replaceState` and re-filters pre-rendered children | NONE (client over SSR children, SEO-safe) | n/a | Essential |
| UI-WEB-PUBLIC-002 | same as above | `filter-shell.tsx:200` | Empty-state + "Clear filters" | Public | Explain zero matches | `onClick` resets all three filters | n/a | n/a | Essential |
| UI-WEB-PUBLIC-003 | `/[locale]/search` | `search/page.tsx:41` | GET search form + type filter | Public | Real server-rendered search | `<form method="get">`; type links rewrite the query | `searchSite()` (server query) | server trims/caps query to 100 chars | Essential |
| UI-WEB-PUBLIC-004 | `/[locale]/search` | `search/page.tsx:78` | Empty state ("no results") | Public | Explain zero results | n/a | n/a | n/a | Essential |
| UI-WEB-PUBLIC-005 | Contact page | `contact-form.tsx:19` | Contact form w/ live + submit validation | Public | Send a message | `onSubmit` client validation using the **same** `contactSchema` as the server, then `formAction` | `contact.ts` server action | **Shared Zod schema — exemplary client/server parity** | Essential |
| UI-WEB-PUBLIC-006 | Contact page | `contact-form.tsx:152` | Honeypot + timestamp anti-spam fields | Public | Spam mitigation | hidden fields read server-side | `contact.ts` | n/a | Essential |
| UI-WEB-CLUB-001 | `/club/[id]` | `membership-request.tsx:11` | Adult + consent checkboxes, request button | PORTAL_USER | Request club membership | `useActionState` → `requestMyClubMembership` | server requires both before REQUESTED | both `required`, matches server | Essential |
| UI-WEB-CLUB-002 | `/club/projects/[assignmentId]` | `project-contribution-form.tsx:9` | Record contribution note | PORTAL_USER (coordinator) | Log private contribution | `useActionState` → `reportClubContribution` | server `requireProjectClubCoordinator` | **Rendered only when `canReportContribution && operationalStatus === "ACTIVE"`** — verified correctly gated, no role-rejects-visible-action case | Essential |
| UI-WEB-VOL-001 | task detail pages | `task-evidence-upload.tsx:6` | Private evidence upload | PORTAL_USER (assigned volunteer) | Attach completion evidence | `fetch()` POST | `/api/project-tasks/[id]/evidence` | required title 3–160 chars, file `accept` | Essential |
| UI-WEB-SHARED-001 | all admin dialogs (messages, media, category, pickers) | `ui/dialog.tsx:33` | Radix `DialogContent` | all | Modal container | Escape / overlay click / `DialogClose` all dismiss | n/a | n/a | Essential — dismissal path confirmed |
| UI-WEB-SHARED-002 | site-wide | `admin-shell.tsx`, `site-header.tsx`, `testimonial-carousel.tsx`, `gallery-grid.tsx`, `pickers.tsx`, `row-actions.tsx`, `category-manager.tsx`, `list-editors.tsx`, `theme-toggle.tsx` | Icon-only buttons | all | Compact actions (edit, delete, reorder, pause/play, prev/next, menu) | varies | n/a | **Every icon-only button sampled carries `aria-label`** — no missing-accessible-name instances found | Essential |
| UI-WEB-SHARED-003 | all admin forms using `fields.tsx` | `shared/form-field.tsx:9` | Label/description/error wiring | all | Associate every input with a `<label htmlFor>` and `aria-describedby` | n/a | n/a | n/a | Essential — no unlabeled-input instances found in sampled forms |
| UI-WEB-TRUST-001 | Home hero | `trust/hero.tsx:26` | "Registered trust" status chip | Public | Status claim | n/a | public query | Cross-ref existing **QA-REQ-002** | Unclear purpose (pre-existing finding) |
| UI-WEB-TRUST-002 | Testimonials carousel | `testimonial-carousel.tsx:103` | "Relationship confirmed" badge | Public | Verification claim | n/a | public query | Cross-ref existing **QA-REQ-004** | Unclear purpose (pre-existing finding) |
| UI-WEB-IMPACT-001 | `/[locale]/impact` | `bar-chart.tsx:29`, `impact/page.tsx:88` | Year-on-year bar chart | Public | Compare figures across periods | n/a | public query | Cross-ref existing **QA-REQ-003** (unit never rendered) | Useful (pre-existing finding) |
| UI-WEB-CLUB-003 | `/club/[id]` | `club/[id]/page.tsx:20` | Member roster (name + email) | PORTAL_USER (coordinator) | Show club members | n/a | server query | Cross-ref existing **QA-REQ-006** | Useful (pre-existing finding) |

## 2. New findings (this phase)

Five new findings, filed as `QA-UI-001`–`QA-UI-005` in `qa/reports/findings.json`. Summary:

| ID | Severity | One-line |
|---|---|---|
| QA-UI-001 | Medium | Two admin review forms (volunteer attendance/hours, task-completion) omit `required`/`minLength` on the decision "reason" field that the server requires to be 3+ characters for non-approval decisions; a sibling form in the same file does include it |
| QA-UI-002 | Low | Media delete-confirmation dialog promises unconditional removal "from every document that uses it", but the server refuses deletion outright when a published document depends on the file |
| QA-UI-003 | Low | `DonorLinkForm`'s conditional "organisation name required when type=Organization" rule exists only server-side; no client toggle or hint |
| QA-UI-004 | Informational | `ManualDonationIntakeForm` hardcodes `campaignId=""`; the schema/action/service all support linking a campaign, but no picker exists in the UI |
| QA-UI-005 | Low | `ManualDonationIntakeForm`'s submit button is silently disabled with no empty-state message when there are no donor profiles or published projects yet |

None of these are security or data-integrity issues — in every case the server independently
enforces the correct rule (or, for QA-UI-002, is *safer* than the UI claims). They are UX/consistency
gaps in an otherwise unusually thorough client/server parity pattern: most admin forms in this
codebase deliberately push all validation to the server (`noValidate` + `EntityForm`) and rely on
`maxLength` for soft limits, and that pattern was verified field-by-field for trustee, project,
activity, testimonial, story and category forms with no mismatch found.

## 3. Cross-references (not re-filed)

- **QA-I18N-005** (locale fallback `lang` attribute): confirmed additional visible-text call sites
  through `text()` beyond the one already cited. Added as evidence to the existing finding in
  `qa/reports/findings.json`, not re-filed: `src/app/[locale]/page.tsx:76` (founder name),
  `src/components/trust/people.tsx:43,72` (trustee/founder card names), `src/app/[locale]/trustees/[slug]/page.tsx:42`
  (profile heading), `src/app/[locale]/impact/page.tsx:84,112` (chart/legend labels),
  `src/app/[locale]/verification/registration/page.tsx:60` and `src/app/[locale]/reports/[slug]/page.tsx:96`
  (document/report titles), `src/app/[locale]/news/page.tsx:26` (category filter label).
- **QA-REQ-002/003/004/006/007**: the UI elements behind these (hero chip, impact chart, testimonial
  badge, club roster, donation anonymity checkbox) were re-examined from the UI side and the existing
  findings stand; no new UI-side evidence changes their verdict.

## 4. What worked well (not findings, but load-bearing for the audit's conclusions)

- `EntityForm` + `fields.tsx` give every admin content form the same error-surfacing, focus-management
  and `maxLength`-vs-`z.max()` discipline; spot-checked across 6 form modules with no drift.
- `resource-table.tsx`, `filter-shell.tsx` and `media-library.tsx` all have real empty states wired to
  the actual zero-rows vs zero-matches distinction — no blank-panel case found.
- Every status-gated button sampled in `club-management.tsx` and `project-operations.tsx` has an
  **independent, matching server-side check** (version/optimistic-lock conflicts, self-approval,
  active-club/active-member, consent) — the client `disabled` attribute is a UX convenience, not the
  only guard.
- Role-filtered admin navigation (`admin-shell.tsx`) matches the target pages' `requireAdminPage("ADMIN")`
  calls exactly for all 11 `adminOnly` items checked — no nav-visible-but-rejected action found.
- No icon-only button or unlabeled input was found in the sampled set; dialogs are Radix-based with a
  working close button, Escape and overlay-click dismissal everywhere checked.

## Unknowns and limitations

1. **No runtime verification.** Nothing was rendered, clicked, or measured in a browser. "Broken" and
   "Useful with issues" classifications above are code-reading conclusions (status `CONFIRMED` is used
   in the sense of "the mismatch is a plain fact of the source", not "reproduced against a running app").
2. **Scope, not census.** ~38 elements were traced in depth out of 162 `.tsx` files, chosen for risk
   (admin mutation surfaces, validation parity, portal role gates). Many presentational-only components
   (`motion/*`, `cards/*`, `ui/*` primitives beyond `dialog.tsx`) were not individually audited; absence
   of a finding there is not evidence of correctness, only of non-inspection.
3. **No accessibility tooling.** No axe/Lighthouse run was available or installed; contrast, touch-target
   size and full keyboard-trap testing were not performed. The accessibility conclusions above are limited
   to what is verifiable by reading JSX: label association, `aria-label` presence, and dialog primitives.
4. **Dynamic/registry-based rendering was not searched.** No i18n-key-driven or feature-flag-driven dynamic
   component lookup was found in this codebase (content is bilingual-field-driven, not key-registry-driven),
   but a targeted search for such a pattern was not separately run beyond the role/demo-gate greps already
   covered by the architecture and requirements phases.
5. **QA-UI-004's severity depends on fundraising-campaign activation**, which is itself gated behind a
   draft/inert phase per the architecture report; whether any `DonationCampaign` can reach a usable state
   today was not independently re-verified here.
6. **Authorization correctness is out of this phase's scope** by brief; role-gating observations above are
   reported as cross-references to phase 1/2/5 material, not as independently adjudicated security findings.
