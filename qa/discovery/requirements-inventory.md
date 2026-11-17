# Trustfolio — Requirements Inventory (test oracle)

Phase 2 output. **Static analysis only** — no application or database was started, no test was
executed. Every entry cites a documentation line (intent) and a source line (behaviour). Where the
two disagree the mismatch is reported as a finding; which side is wrong is the reader's call.

- Candidates extracted by `scripts/requirements.mjs`: **120** (`qa/discovery/requirement-candidates.json`).
- Candidates promoted to real, testable requirements: **47**.
- Candidates discarded: build/contribution/tooling statements, future-phase finance design
  (`docs/finance/*`, the money sections of `docs/requirements/trustfolio-srs.md`) describing systems
  not yet built, and table-header fragments mis-extracted as obligations.

Verdict key: SATISFIED - PARTIAL - VIOLATED - UNIMPLEMENTED - UNVERIFIABLE.
"Tested by" names the harness that exercises the rule; **none were executed in this run**
(`npm run test:unit` covers only approval definitions, fundraising/donation validation, finance
maths and the payment provider — see `qa/reports/evidence/mechanical/test.log`).

## Inventory

| ID | Statement (testable form) | Type | Source | Implemented by | Tested by | Verdict |
|---|---|---|---|---|---|---|
| REQ-DOC-001 | A document that contains personal data may be PUBLIC+PUBLISHED only if `isRedacted` is set; otherwise it must stay private | prohibition | README.md:76, APPLICATION_CONTEXT.md:86 | `src/lib/validations/admin.ts:285`; `src/server/actions/admin/bulk.ts:49`; `src/server/queries/public/shared.ts:102` | UNTESTED | SATISFIED |
| REQ-DOC-002 | Unredacted originals are stored as PRIVATE media and served only through an authenticated admin route | prohibition | README.md:77, APPLICATION_CONTEXT.md:87 | `src/lib/storage.ts:78`; `src/app/api/admin/media/[id]/file/route.ts:13` | UNTESTED | SATISFIED |
| REQ-DOC-003 | The public-file slot must hold PUBLIC media and the original slot PRIVATE media | invariant | APPLICATION_CONTEXT.md:87, README.md:231 | `src/server/actions/admin/evidence.ts:23`, `:26` | UNTESTED | SATISFIED |
| REQ-DOC-004 | A published public document must have a public media file | obligation | APPLICATION_CONTEXT.md:107 | `src/lib/validations/admin.ts:289`; `src/server/actions/admin/bulk.ts:50`; `src/server/queries/public/shared.ts:101` | UNTESTED | SATISFIED |
| REQ-DOC-005 | Media deletion must be rejected while the file is used by a published public document | prohibition | APPLICATION_CONTEXT.md:107, docs/requirements/trustfolio-srs.md:64 | `src/server/actions/admin/media.ts:51` | UNTESTED | SATISFIED (Oct-audit gap 1 closed) |
| REQ-DOC-006 | Private media never reaches a public DTO, even when linked by mistake | prohibition | APPLICATION_CONTEXT.md:87 | `src/server/queries/public/shared.ts:40`, `:122` | UNTESTED | SATISFIED |
| REQ-MEDIA-007 | Operational private namespaces (club, task, fundraising, donation) are excluded from legacy editor media lists, file reads, metadata edits and document-original linking | prohibition | APPLICATION_CONTEXT.md:87, docs/security/permissions-matrix.md:5 | `src/server/queries/admin.ts:366`; `src/app/api/admin/media/route.ts:23`; `src/app/api/admin/media/[id]/file/route.ts:19`; `src/server/actions/admin/media.ts:35`; `src/server/actions/admin/evidence.ts:29` | `scripts/verify-club-ui.ts:129` | SATISFIED |
| REQ-CON-008 | A trustee profile cannot be published without recorded consent (form, bulk and every public read) | prohibition | README.md:75, APPLICATION_CONTEXT.md:85 | `src/lib/validations/admin.ts:98`; `src/server/actions/admin/bulk.ts:44`; `src/server/queries/public/trust.ts:201`; `src/server/queries/public/search.ts:74` | UNTESTED | SATISFIED |
| REQ-CON-009 | A testimonial cannot be published without recorded consent | prohibition | README.md:75, APPLICATION_CONTEXT.md:85 | `src/lib/validations/admin.ts:235`; `src/server/actions/admin/bulk.ts:45`; `src/server/queries/public/trust.ts:311` | UNTESTED | SATISFIED |
| REQ-CON-010 | A story cannot be published without recorded consent | prohibition | README.md:75, APPLICATION_CONTEXT.md:85 | `src/lib/validations/admin.ts:258`; `src/server/actions/admin/bulk.ts:46`; `src/server/queries/public/work.ts:143`; `src/server/queries/public/search.ts:88` | UNTESTED | SATISFIED |
| REQ-MET-011 | A published impact figure must have a method, a source document or an annual report | obligation | README.md:78, APPLICATION_CONTEXT.md:88 | `src/lib/validations/admin.ts:212`; `src/server/actions/admin/bulk.ts:53` | UNTESTED | SATISFIED |
| REQ-MET-012 | Figures in different units are never added together | prohibition | README.md:27 | no summation exists; `src/app/[locale]/impact/page.tsx:39` groups by `metricKey` only | UNTESTED | **PARTIAL** (QA-REQ-003) |
| REQ-MET-013 | Every published figure shows its period, how it was counted and its source | obligation | README.md:25, APPLICATION_CONTEXT.md:88 | `src/lib/view-models.ts:27`; `src/components/impact/metric-tiles.tsx:55`; `src/app/[locale]/impact/page.tsx:120` | UNTESTED | SATISFIED |
| REQ-VER-014 | A published verification record must point to a document or an external registry/issuer link | obligation | README.md:79 | `src/lib/validations/admin.ts:344`, `:348` | UNTESTED | SATISFIED |
| REQ-VER-015 | A verification record's document source counts only when that document is itself public, published and has a public file | obligation | APPLICATION_CONTEXT.md:89 | `src/server/actions/admin/evidence.ts:80`; `src/server/actions/admin/bulk.ts:54`; `src/server/queries/public/shared.ts:105` | UNTESTED | SATISFIED (Oct-audit gap 2 closed) |
| REQ-VER-016 | A bare registration number is not inspectable evidence of registration | prohibition | APPLICATION_CONTEXT.md:107 | coverage `src/server/queries/public/evidence.ts:222`; hero chip `src/components/trust/hero.tsx:26` | UNTESTED | **PARTIAL** (QA-REQ-002) |
| REQ-EVC-017 | There is no trust score: an evidence area is ticked only when published records exist | invariant | README.md:29, APPLICATION_CONTEXT.md:81 | `src/server/queries/public/evidence.ts:204` | UNTESTED | SATISFIED |
| REQ-PUB-018 | Placeholder text is treated as missing and left out of structured data | obligation | README.md:80, APPLICATION_CONTEXT.md:90 | `src/server/queries/public/trust.ts:31`; `src/lib/seo.ts:107` | UNTESTED | SATISFIED |
| REQ-DEMO-019 | While any published demo record is visible: banner, noindex, and no Organization structured data | obligation | README.md:160, APPLICATION_CONTEXT.md:107 | `src/server/queries/public/trust.ts:331`; `src/app/[locale]/page.tsx:52`; `src/app/[locale]/layout.tsx:37` | `scripts/audit-demo.ts:113` | SATISFIED (Oct-audit gap 3 closed) |
| REQ-PUB-020 | No public UI element asserts verification that published records do not support | prohibition | README.md:3, APPLICATION_CONTEXT.md:88 | mostly enforced; `src/lib/view-models.ts:103` and `src/components/interactive/testimonial-carousel.tsx:103` publish a "Relationship confirmed by the trust" badge from an unconstrained checkbox | UNTESTED | **VIOLATED** (QA-REQ-004) |
| REQ-PUB-021 | No public query returns private club, volunteer, task or donation data; the public project read is a field allowlist | prohibition | docs/requirements/trustfolio-frd.md:44, APPLICATION_CONTEXT.md:60 | `src/server/queries/public/work.ts:255`; no club/volunteer/donation model is referenced under `src/server/queries/public/` | UNTESTED | SATISFIED |
| REQ-I18N-022 | Tamil is never generated automatically; untranslated text falls back to English with a lang attribute and a visible note | prohibition | README.md:81, APPLICATION_CONTEXT.md:9 | `src/lib/i18n/localized.ts:34`; `src/components/i18n/tx.tsx:33` | UNTESTED | **PARTIAL** (existing QA-I18N-005) |
| REQ-I18N-023 | Every public URL is prefixed with /en or /ta | invariant | README.md:105 | `src/proxy.ts:30` (portals excluded by design, `src/proxy.ts:27`) | UNTESTED | SATISFIED |
| REQ-SEC-024 | EDITOR cannot reach trust profile, settings, navigation, social links or users — enforced on the server for both page and action | prohibition | README.md:54, APPLICATION_CONTEXT.md:54 | pages `src/app/admin/(dashboard)/trust/page.tsx:24`, `settings/page.tsx:21`, `navigation/page.tsx:14`, `social/page.tsx:15`, `users/page.tsx:10`; actions `src/server/actions/admin/settings.ts:26`, `:118`; `src/server/actions/admin/trust.ts:25` | UNTESTED | SATISFIED |
| REQ-SEC-025 | PORTAL_USER is denied every /admin page and action | prohibition | README.md:55, APPLICATION_CONTEXT.md:56 | `src/server/auth-guard.ts:36`, `:45` | UNTESTED | SATISFIED |
| REQ-SEC-026 | The session user is re-read from the database on every request, so deleting an account revokes access immediately | invariant | APPLICATION_CONTEXT.md:54 | `src/server/auth-guard.ts:22` | UNTESTED | SATISFIED |
| REQ-SEC-027 | Every admin page calls requireAdminPage() and every action or route calls requireAdmin(); the proxy is only a fast redirect | obligation | README.md:113, APPLICATION_CONTEXT.md:27 | `src/app/admin/(dashboard)/layout.tsx:14`; `src/proxy.ts:15`; but `src/app/api/club/documents/[id]/file/route.ts:8`, `src/app/api/task-evidence/[id]/file/route.ts:8` authorize with getAdminUser() plus a scope check | UNTESTED | **PARTIAL** (QA-REQ-005) |
| REQ-SEC-028 | Every upload entry point checks origin, size, declared MIME type, magic bytes and a rate limit | obligation | README.md:50, APPLICATION_CONTEXT.md:93 | `src/app/api/admin/upload/route.ts:21`, `:50`; `src/app/api/admin/clubs/[id]/documents/route.ts:34`; `src/app/api/project-tasks/[id]/evidence/route.ts:37` | `scripts/verify-club-ui.ts:118` | SATISFIED |
| REQ-SEC-029 | Admin DTOs never include storage keys or password hashes | prohibition | README.md:115 | `src/server/queries/admin-media.ts:23`; `src/server/queries/admin.ts:371` | UNTESTED | SATISFIED |
| REQ-SEC-030 | Sign-in, contact form and uploads are rate limited | obligation | README.md:114 | `src/auth.ts:29`; `src/server/actions/contact.ts:59`; `src/app/api/admin/upload/route.ts:30` | UNTESTED | **PARTIAL** (existing QA-AUTH-001) |
| REQ-SEC-031 | ./private-uploads is never served directly; the public file route rejects traversal | prohibition | README.md:264 | `src/app/uploads/[...path]/route.ts:13` | UNTESTED | SATISFIED |
| REQ-CLUB-032 | /club/[id] is limited to that club's approved coordinator: active membership, COORDINATOR role, matching coordinatorId, active club | authorization | README.md:61, APPLICATION_CONTEXT.md:56 | `src/server/clubs/service.ts:203`; `src/app/club/[id]/page.tsx:16`, `:18` | `scripts/verify-club-ui.ts:152` | SATISFIED |
| REQ-CLUB-033 | Club membership never grants project access; project access needs an explicit active assignment carrying the required permission flag | prohibition | README.md:61, docs/security/permissions-matrix.md:5 | `src/server/projects/service.ts:81`; `src/app/club/projects/page.tsx:11`; `src/app/club/[id]/page.tsx:17` | `scripts/verify-project-ui.ts` (not executed) | SATISFIED |
| REQ-CLUB-034 | A membership request needs adult self-attestation and current versioned data-use consent; a trust admin decides and cannot approve their own request | obligation | README.md:61, APPLICATION_CONTEXT.md:56 | `src/server/clubs/service.ts:129`, `:152`; `prisma/migrations/20261025010000_phase2_clubs/migration.sql:138` | `scripts/verify-club-migration.ts:43` | SATISFIED |
| REQ-CLUB-035 | A coordinator sees skills and interests only for an active, opted-in member of their own club | authorization | APPLICATION_CONTEXT.md:58, docs/security/permissions-matrix.md:7 | `src/app/club/[id]/page.tsx:21` scopes the skills block, but `:20` also lists every active member's name and email | `scripts/verify-club-ui.ts:138` | **VIOLATED** as documented (QA-REQ-006) |
| REQ-CLUB-036 | Private club documents are served only after a fresh club-scope check; archived documents are unavailable | authorization | APPLICATION_CONTEXT.md:87 | `src/app/api/club/documents/[id]/file/route.ts:13`, `:15` (trust ADMIN is an explicit second path) | `scripts/verify-club-ui.ts:141` | SATISFIED |
| REQ-VOL-037 | Attendance requires an active approved membership of the named active club; service hours require that person's approved attendance | obligation | README.md:62, APPLICATION_CONTEXT.md:58 | `src/server/volunteers/service.ts:63`, `:75`, `:107` | `scripts/verify-volunteer-ui.ts` (not executed) | SATISFIED |
| REQ-VOL-038 | Trust-admin review can never be self-review, for volunteer records or task completion | prohibition | APPLICATION_CONTEXT.md:58, docs/security/permissions-matrix.md:7 | `src/server/volunteers/service.ts:92`, `:106`; `src/server/projects/service.ts:237` | `scripts/verify-volunteer-ui.ts` (not executed) | SATISFIED |
| REQ-VOL-039 | Only APPROVED minutes linked to APPROVED attendance count toward a volunteer total; voiding attendance voids its hours | invariant | README.md:62, APPLICATION_CONTEXT.md:58 | `src/app/volunteer/page.tsx:19`; `src/server/volunteers/service.ts:96` | UNTESTED | SATISFIED |
| REQ-PRJ-040 | A volunteer needs a current consented profile, active club membership and an explicit active task assignment to read or update a task | authorization | APPLICATION_CONTEXT.md:60, docs/security/permissions-matrix.md:9 | `src/server/projects/service.ts:197`; `src/app/volunteer/tasks/page.tsx:15` | `scripts/verify-project-ui.ts` (not executed) | SATISFIED |
| REQ-FND-041 | Donation request targets are positive integer INR paise; requests and campaigns stay DRAFT with null approval and release FKs | invariant | README.md:64, APPLICATION_CONTEXT.md:62 | `prisma/migrations/20261026064436_phase5_fundraising_drafts/migration.sql:173` | `scripts/verify-fundraising-migration.ts` (not executed) | SATISFIED |
| REQ-DON-042 | Every donation row is constrained by SQL to positive paise, INR and PENDING_VERIFICATION | invariant | APPLICATION_CONTEXT.md:64 | `prisma/migrations/20261026073000_phase6_donation_intake/migration.sql:81`; `prisma/schema.prisma:66` | `scripts/verify-donations-migration.ts` (not executed) | SATISFIED |
| REQ-DON-043 | A donor profile may link an existing PORTAL_USER account only; intake requires a published, non-demo project | obligation | APPLICATION_CONTEXT.md:64 | `src/server/donations/service.ts:20`, `:46` | `scripts/verify-donations-ui.ts` (not executed) | SATISFIED |
| REQ-DON-044 | Donor profiles default to anonymous public display | obligation | APPLICATION_CONTEXT.md:64 | column default only (`prisma/schema.prisma:1384`); no code reads it; the admin control is disabled (`src/components/admin/donation-intake.tsx:26`) | UNTESTED | **UNIMPLEMENTED** (QA-REQ-007) |
| REQ-DON-045 | Donors see only their own pending history; references, internal notes, evidence and amounts stay out of public queries | authorization | APPLICATION_CONTEXT.md:64 | `src/app/donor/page.tsx:14` | UNTESTED | SATISFIED |
| REQ-APPR-046 | Live financial and public-release approval remains disabled; no threshold or approver assignment is active | prohibition | README.md:59, APPLICATION_CONTEXT.md:62 | `src/server/fundraising/service.ts:67` (see `qa/architecture/role-permission-matrix.md:26`) | `src/lib/approval/definition.test.ts` | SATISFIED (inert by design) |
| REQ-NOTIF-047 | A financial mutation is never retried merely because notification delivery failed | prohibition | docs/architecture/trustfolio-expansion.md:97 | no delivery path exists; outbox rows are written and displayed only (`qa/architecture/application-architecture.md:90`) | n/a | **UNVERIFIABLE** until delivery exists |

## Non-SATISFIED detail

**QA-REQ-002 / REQ-VER-016 (PARTIAL).** The November safeguard stopped the Evidence Center from
counting a bare registration number (`src/server/queries/public/evidence.ts:222` requires
`trust.registration.document`), but the home hero still shows the "Registered trust" chip when only
`registration.number` is filled in (`src/components/trust/hero.tsx:26`). The most prominent claim on
the site is therefore the least evidenced. README.md:19 describes the current behaviour, so the two
documents also disagree with each other.

**QA-REQ-003 / REQ-MET-012 (PARTIAL).** Nothing adds figures, so the literal rule holds. But
`metricKey` is a free slug and the unit columns are free text with no invariant tying them together
(`src/lib/validations/admin.ts:190`), and the year-on-year chart plots every period of one
`metricKey` on a shared axis while rendering only prefix and suffix — the unit never appears
(`src/app/[locale]/impact/page.tsx:88`, `src/components/impact/bar-chart.tsx:61`). Two periods
recorded in different units are compared on one scale, which is the error the rule exists to prevent.

**QA-REQ-004 / REQ-PUB-020 (VIOLATED).** `relationshipVerified` is an unconstrained admin checkbox
(`src/lib/validations/admin.ts:228`) that renders a public badge reading "Relationship confirmed by
the trust" (`src/lib/i18n/dictionaries/en.ts:298`). Every comparable claim — trustee profile,
redacted document, impact figure, verification record — carries an evidence or consent requirement;
this one carries none, and records no evidence link, no confirming person and no date. The demo
auditor asserts that no demo testimonial is marked verified (`scripts/audit-demo.ts:113`), which
shows the authors treat the flag as a verification claim.

**QA-REQ-005 / REQ-SEC-027 (PARTIAL).** The README sentence is now too broad: three API routes and
the four portal action modules authorize with `getAdminUser()` plus a scope check, which by design
admits PORTAL_USER. The guards exist and are correct; the documentation misdescribes them.

**QA-REQ-006 / REQ-CLUB-035 (VIOLATED as documented).** The coordinator workspace lists every active
member's name and email address (`src/app/club/[id]/page.tsx:20`) in addition to the opted-in skills
block. The documentation says a coordinator sees "only an active member's opted-in skills/interests".

**QA-REQ-007 / REQ-DON-044 (UNIMPLEMENTED).** `anonymousByDefault` is written by the column default
and never read anywhere in `src/`. No present defect, since no public donor display exists.

**QA-REQ-001 (documentation).** `APPLICATION_CONTEXT.md:109` presents three "known gaps" as current
behaviour and tells the reader to recheck before relying on the list. All three were re-checked this
pass and none of them still holds.

## Behaviour with no documented requirement

1. The club coordinator workspace discloses member identities (QA-REQ-006).
2. `src/app/robots.ts:6` disallows /admin and /api/ only; /club, /volunteer and /donor rely on
   per-layout noindex metadata (`src/app/club/layout.tsx:7`). Defensible, but README.md:117
   presents the exclusion list as if it were complete.
3. The /club, /volunteer and /donor portals are English-only hard-coded strings inside an
   application README.md:3 describes as bilingual. No document states that the portals are exempt.
4. `createUser` returns a one-time temporary password inside the action result message
   (`src/server/actions/admin/settings.ts:97`). README.md:186 says it is shown once but does not
   state that it transits the action response.

## Coverage

| Measure | Count |
|---|---|
| Candidates extracted | 120 |
| Promoted to requirements | 47 |
| Traced to implementing code | 46 of 47 (REQ-DON-044 has a column default and no consumer) |
| Traced to a named test harness | 15 of 47, none executed in this run |
| SATISFIED | 38 |
| PARTIAL | 5 (REQ-MET-012, REQ-VER-016, REQ-I18N-022, REQ-SEC-027, REQ-SEC-030) |
| VIOLATED | 2 (REQ-PUB-020, REQ-CLUB-035) |
| UNIMPLEMENTED | 1 (REQ-DON-044) |
| UNVERIFIABLE | 1 (REQ-NOTIF-047) |
| New findings raised | 7 (QA-REQ-001 to QA-REQ-007) |

Documents judged stale or unusable as an oracle:

- `APPLICATION_CONTEXT.md:109` to `:117` — stale; all three "current behavior" gaps are closed.
- `README.md:113` — stale generalization since the portal routes were added.
- `docs/finance/accounting-rules.md`, `docs/finance/phase7-ledger-design.md` and the money sections
  of `docs/requirements/trustfolio-srs.md` — not requirements of this build; they describe a Phase 7
  ledger gated behind decisions D-01 to D-06. 33 of the 120 candidates come from these files and
  were discarded for that reason, not because they are wrong.
- `docs/design/trustfolio-uird.md` — largely unverifiable as written ("a dialog alone is not a
  control"); usable only once the screens it describes exist.

## Unknowns and limitations

1. No application or database was started. Every verdict is a reading of source and migration SQL.
   Rules enforced by Postgres CHECK constraints were read, not exercised.
2. No test was executed. "Tested by" names harnesses that need system Chrome and a local disposable
   PostgreSQL schema; whether they pass today is unknown.
3. Cache-invalidation completeness (`docs/architecture/trustfolio-expansion.md:94`) was spot-checked
   only and is not in the inventory; it needs a generated tag-to-query matrix.
4. Vercel Blob storage paths were not verified; STORAGE_DRIVER was not read.
5. The club and volunteer data-use consent texts are not in the repository, so whether the
   REQ-CLUB-035 disclosure is covered by the consent the member gave cannot be decided from code.
6. Counts describe promoted requirements, not documentation lines: one README table row often
   produced two requirements, and several requirements merge README and APPLICATION_CONTEXT
   statements of the same rule.
