# UI Audit — Review Queue

Items below need a human product/engineering decision. Each states what was checked, what could
not be checked from static code alone, and the specific question. None of these were classified
`REMOVE CANDIDATE` outright — per the removal rule in `ui-audit-rules.md`, every candidate for
removal needs a decision from a human with product context first.

---

## RQ-UI-001 — Manual donation intake has no campaign picker (QA-UI-004)

**Checked:** `ManualDonationIntakeForm` (`src/components/admin/donation-intake.tsx:31-48`) hardcodes
`campaignId` to an empty hidden input. `manualDonationIntakeSchema` (`src/lib/validations/donations.ts:19`)
accepts a `campaignId`, and `createPendingManualDonation` (`src/server/donations/service.ts:34,47-53`)
looks up and links a `DonationCampaign` when one is supplied. No UI control to choose a campaign exists
anywhere in the admin screen.

**Could not check:** Whether any `DonationCampaign` can currently reach a state where linking it would
matter — campaign/fundraising activation is itself gated behind a draft phase per
`qa/architecture/application-architecture.md`. Whether campaign linkage is planned for a later phase of
the donations module was not documented anywhere found.

**Question for a human:** Is campaign-linked offline intake a near-term requirement, or is the hidden
empty field intentionally reserved for a later phase? If the latter, should it be documented as
reserved (same treatment as `anonymousByDefault` / QA-REQ-007) rather than left silent?

---

## RQ-UI-002 — Media delete-confirmation copy vs. actual published-document refusal (QA-UI-002)

**Checked:** The confirmation dialog text (`src/components/admin/media-library.tsx:220`) and the actual
`deleteMedia` behavior (`src/server/actions/admin/media.ts:46-59`), which refuses deletion when a
published public document depends on the file (REQ-DOC-005, confirmed SATISFIED elsewhere in this audit).

**Could not check:** Whether this mismatch has ever confused a real admin (no telemetry exists to check,
and none was invented).

**Question for a human:** Should the copy be corrected to describe the published-document exception (the
cheap fix), or should the dialog instead show the exception *proactively* — e.g. disabling delete and
explaining why, before the admin confirms, rather than after?

---

## RQ-UI-003 — Reason-field validation parity across review forms (QA-UI-001)

**Checked:** `volunteer-review.tsx:10` and the task-completion review form in `project-operations.tsx:60`
both lack `required`/`minLength` on their reason fields, while `reviewVolunteerRecord` and
`reviewTaskCompletion` both require a 3+ character reason server-side for non-approval decisions. A
third, near-identical form in the very same `project-operations.tsx` file (the administrative-status
form) *does* carry `required minLength={3}`.

**Could not check:** Whether this was a deliberate choice (e.g. because the review decision is expected
to be made quickly and a client block was considered unwanted friction) or an oversight.

**Question for a human:** Should the two forms be brought in line with the third, or is the inconsistency
intentional for some reason not visible in the code (e.g. a product decision that review reasons are
"nice to have" but status-change reasons are "must have")?

---

## RQ-UI-004 — Donor-type-conditional field requirement (QA-UI-003)

**Checked:** `DonorLinkForm`'s `type` select and `organizationName` input
(`src/components/admin/donation-intake.tsx:24-25`) are independent; the conditional requirement lives
only in `donorProfileSchema.superRefine` (`src/lib/validations/donations.ts:7-13`).

**Could not check:** Expected admin usage volume for this specific form — it is a low-traffic,
ADMIN-only screen (donor-account linking is rare by design, since donor sign-up is not enabled), so the
cost of the extra round trip may be judged negligible by the product owner.

**Question for a human:** Is this worth a client-side fix given the form's low usage, or is it
acceptable as-is?

---

## RQ-UI-005 — Should ResourceTable-style empty states be a cross-cutting UI pattern? (related to QA-UI-005)

**Checked:** `ResourceTable` and `FilterShell` both have a dedicated `EmptyState`/empty-state branch,
but the hand-written admin forms in `donation-intake.tsx`, `club-management.tsx` and
`project-operations.tsx` instead silently disable a submit button with no explanatory message when a
prerequisite list (donors, projects, eligible clubs, approved members) is empty.

**Could not check:** Whether this inconsistency is visible to real admins in practice — in a populated
trust (clubs, projects and donor profiles already created), these empty branches may rarely trigger.

**Question for a human:** Is a shared "prerequisite missing" inline-message component worth building,
or is this an acceptable low-severity inconsistency given how rarely these specific forms would be
opened with empty prerequisite lists?
