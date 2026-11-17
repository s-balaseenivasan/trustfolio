# Trustfolio — Database Dependency Map

Phase 3 (data architecture) output. Static analysis only. Read `qa/discovery/database-inventory.md`
first for store confirmation and the entity-ownership table; this report maps cascade reach,
cross-store flow and the consistency risks the brief asked for, in priority order.

## 1. Cascade blast radius — the opposite of the expected finding

The brief's premise was "map the cascade chains from User, Club, Project, Media — which single
delete removes the most rows". Reading all 134 `onDelete` declarations in `prisma/schema.prisma`
answers that premise directly: **84 are `Restrict`, 48 are `SetNull`, and only 2 are `Cascade`**
(both on the `GalleryImage` join row, `prisma/schema.prisma:1817-1818`). There is no chain from
`User`, `Club`, `Project` or `Media` that cascades through history, audit or evidence tables,
because none of those relations are declared `Cascade` — they are `Restrict`.

Combined with the append-only triggers in `database-inventory.md` §2, the real picture is:

- **`User`**: every relation that would carry business meaning (clubs created/coordinated,
  memberships, volunteer profile, approvals made/decided, donations/requests created, audit actor)
  is `Restrict`. The two exceptions are `ActivityLog.userId` and `Media.uploadedById`, both
  `SetNull` (`schema.prisma:713,774`). **Deleting a `User` who has ever done anything therefore
  fails at the database**, not cascades. See QA-DB-002: the delete action does not anticipate this.
- **`Club` / `Project`**: no code path calls `.delete()` on either (confirmed by grep across
  `src/server` and `src/app`). Their lifecycle is exclusively status-driven
  (`ClubStatus`/`ProjectOperationalStatus` enums). There is no cascade to analyse because there is
  no delete to trigger it.
- **`Media`**: the one place `Cascade` actually fires. Deleting a `Media` row that is used as a
  `GalleryImage` silently deletes the join row — see §2, this is the one real cascade chain in the
  schema and it is not guarded by the one delete action that touches `Media`.
- **Audit/history tables** (`ActivityLog`, `AuditEvent`, every `*History` table, `ProjectClubActivity`,
  `DonationHistory`, etc.): none are reachable by cascade from any entity. They cannot disappear
  when their subject is deleted, because the subject cannot be deleted while they exist
  (`Restrict`), and once created they cannot be mutated or deleted directly either (SQL triggers).
  **The audit-trail-disappears risk the brief asked to check for does not exist in this schema.**
  The inverted risk — that deletion of anything with history is permanently blocked — does exist,
  and is exactly what breaks `deleteUser()` and partially breaks `deleteMedia()`. Filed as
  QA-DB-001 / QA-DB-002.

## 2. Media / storage divergence

Two stores, one index (`Media` row → `storageKey`), no shared transaction between them.
`storeFile()` (`src/lib/storage.ts:61-84`) always runs before the owning row is created
(`src/app/api/admin/upload/route.ts:53-54`; `clubs/service.ts:90-91`; `projects/service.ts:272-273`;
`donations/service.ts:71-72`; `fundraising/service.ts:75-76`), so there is no code path where a
`Media`/evidence row exists before its bytes do. The two real windows are on the failure and
deletion sides:

**a) Write-fails-after-store-succeeds.** Every evidence/document upload route
(`src/app/api/project-tasks/[id]/evidence/route.ts:38-49`,
`src/app/api/admin/clubs/[id]/documents/route.ts:35-46`,
`src/app/api/admin/donations/[id]/evidence/route.ts:32-44`,
`src/app/api/admin/fundraising/requests/[id]/evidence/route.ts:32-40`) wraps the DB write in
`try`/`catch` and calls `deleteStoredFile()` on failure, compensating for the missing transaction.
**`src/app/api/admin/upload/route.ts:52-75` — the generic admin upload route — does not.** If
`db.media.create()` throws after `storeFile()` has already written the file (disk or Blob), the
file is permanently orphaned: no `Media` row ever points to it, so no admin UI can find or delete
it, and `deleteStoredFile()` is never called. Filed as QA-DB-003.

**b) Delete-time divergence — the REQ-DOC-005 coverage question.** The brief asked whether
`deleteMedia()`'s published-document guard (`src/server/actions/admin/media.ts:51`) also covers
private evidence media. It does not, in either direction:

- `ClubDocument.mediaId`, `ProjectTaskEvidence.mediaId`, `DonationRequestEvidence.mediaId`,
  `DonationEvidence.mediaId` are all `onDelete: Restrict` (`schema.prisma:403,1259,1323,1451`).
  `deleteMedia()` checks only `Document` usage (`media.ts:51`); it does not check these four
  tables. Attempting to delete media that any of them reference throws an unhandled
  `Prisma.PrismaClientKnownRequestError` (code `P2003`, foreign-key violation). `adminMutation`
  (`src/server/actions/admin-helpers.ts:20-40`) maps only `P2002` and `P2025` to friendly messages;
  `P2003` falls through to the generic `"Something went wrong. Please try again."` The database
  correctly prevents the orphan — but the admin gets no explanation, and the comment on
  `media.ts:45` ("references are cleared by the schema") is wrong for these four relations.
- `GalleryImage.mediaId` is `onDelete: Cascade` (`schema.prisma:1818`) — the one real cascade in
  the schema (§1). `deleteMedia()` does not check gallery usage at all. Deleting media that
  illustrates a photo in a **published** `GalleryAlbum` succeeds silently: the `GalleryImage` row
  is cascade-deleted, the photo disappears from a live public page, and the admin sees only
  `"File deleted"` — no warning, no count, nothing resembling the published-document guard that
  exists for exactly this situation one model over.

Filed as QA-DB-001 (one finding, two evidenced behaviours).

**c) Cross-check on visibility drift.** `mediaMetaSchema` (`src/lib/validations/admin.ts:392-395`)
has no `visibility` field, so `updateMediaMeta` cannot flip a `Media` row from `PUBLIC` to
`PRIVATE` or back after upload — and the public gallery query re-filters
`media: { visibility: "PUBLIC" }` at read time regardless
(`src/server/queries/public/gallery.ts:23-27`). No drift window here; confirmed safe, not a
finding.

## 3. Soft-delete / archive consistency

`archivedAt` exists on four models: `ClubDocument`, `ProjectTaskEvidence`,
`DonationRequestEvidence`, `DonationEvidence`. Every read path found filters it:

| Read | Evidence |
|---|---|
| Club workspace documents list | `src/app/club/[id]/page.tsx:17` — `documents: { where: { archivedAt: null }, ... }` |
| Club private-document file route | `src/app/api/club/documents/[id]/file/route.ts:13` |
| Task detail evidence list | `src/app/volunteer/tasks/[id]/page.tsx:16` |
| Task evidence file route | `src/app/api/task-evidence/[id]/file/route.ts:13` |
| Project-operations task evidence | `src/app/admin/(dashboard)/project-operations/[id]/page.tsx:22` |
| Fundraising request evidence list | `src/app/admin/(dashboard)/fundraising/requests/[id]/page.tsx:13` |
| Fundraising evidence file route | `src/app/api/admin/fundraising/evidence/[id]/file/route.ts:11` |
| Donations list evidence | `src/app/admin/(dashboard)/donations/page.tsx:17` |
| Donation evidence file route | `src/app/api/admin/donations/evidence/[id]/file/route.ts:11` |

No gap found — the characteristic bug the brief warned about (one query forgetting the filter)
**did not occur** in any of the 9 read sites checked. The actual defect is upstream of the read
side: only `ClubDocument` has a working archive *write* path
(`src/server/clubs/service.ts:99-101`). `ProjectTaskEvidence.archivedAt`,
`DonationRequestEvidence.archivedAt` and `DonationEvidence.archivedAt` are never set by any code
in `src/server` (confirmed by grep for `archivedAt: new Date()`), so the filter in those three read
paths is currently a no-op guarding against data that can't exist yet. Filed as QA-DB-004
(Informational — same shape as the already-triaged QA-DATA-006/QA-REQ-007 pattern: a column built
ahead of its consumer).

Public content models (`status: DRAFT|PUBLISHED|ARCHIVED` + `publishedAt`) were spot-checked, not
re-audited — `qa/discovery/requirements-inventory.md` already covers publication-gate correctness
in depth (REQ-DOC-001 through REQ-PUB-021) and this phase did not find reason to re-open it.

## 4. Missing constraints and indexes

**Confirmed safe:** `RateLimit.key` primary key (see database-inventory.md §4); every uniqueness
rule read in the schema (`Club.code`, `User.email`, `Donation.idempotencyKey`,
`ClubMembership.[clubId,userId]`, etc.) has a matching `UNIQUE`/`PRIMARY KEY` in the init migration
SQL, not only a Prisma annotation — spot-checked across all 9 migration files.

**Missing FK indexes.** Cross-referencing every `@relation(fields: [...])` scalar against every
`@@index`/`@@unique`/`@id` in `prisma/schema.prisma` found relation columns with no supporting
index at all (not even as a non-leading member — these have none):

| Model.column | Evidence | Why it matters |
|---|---|---|
| `ActivityLog.userId` | `schema.prisma:706,713` (only `createdAt` and `entity,entityId` are indexed, :715-716) | Table grows on every admin mutation (`admin-helpers.ts:71-81`); "activity by this user" and the `SetNull` sweep on user deletion are both full scans |
| `Media.uploadedById` | `schema.prisma:768,798-799` (indexed on `visibility,createdAt` and `mimeType` only) | Table grows on every upload; also the first column scanned when deciding what to `SetNull` on user deletion |
| `GalleryImage.mediaId` | `schema.prisma:1814,1820` (`@@unique([albumId, mediaId])` — `mediaId` is the second, non-leading column) | This is the table the one real `Cascade` (§1, §2) has to scan to find rows to delete every time a `Media` row is deleted |
| `ProjectTask.milestoneId` | `schema.prisma:1175,1203-1205` (indexed on `[projectId,status,dueDate]`, `[clubAssignmentId,...]`, `[parentId]` — not `milestoneId`) | "Tasks for this milestone" is unindexed |
| `ApprovalInstance.policyId`, `AccessGroupMembership.groupId`, `ApprovalDelegation.groupId`, `HistoryEvent.trusteeId`, `ImpactMetric.{categoryId,reportId,projectId}`, `Certificate.documentId`, `VerificationRecord.{documentId,certificateId,projectId,trusteeId}`, `Testimonial.{projectId,activityId}`, `Story.{albumId,activityId,projectId}`, `GalleryAlbum.{categoryId,activityId,projectId}`, `NewsPost.{categoryId,activityId,projectId}` | Same method, see `schema.prisma` model blocks at 600-628, 561-577, 648-666, 968-995, 1504-1542, 1629-1658, 1663-1697, 1701-1735, 1737-1775, 1779-1809, 1826-1860 | Content tables; row counts are editor-bounded (tens to low hundreds), so impact is lower, but every `SetNull` cascade from a deleted `Category`/`Document`/`Project`/`Activity` scans these columns unindexed |

Filed as QA-DB-005, severity weighted toward the three unbounded/cascade-relevant columns.

**Uniqueness enforced only in application code:** none found. Every uniqueness rule inspected in
service/validation code (e.g. "one active administrator remains",
`src/server/actions/admin/settings.ts:109-111`) is a business rule layered on top of a real DB
constraint elsewhere, not a substitute for one.

## 5. Migration safety (all 7 migration directories + the 1 rename-only migration)

No destructive statement found: no `DROP TABLE`, no `DROP COLUMN`, no `ALTER COLUMN ... TYPE`, no
`TRUNCATE`. The only `RENAME` is a constraint rename
(`prisma/migrations/20261026073100_phase6_foreign_key_names/migration.sql:2-4`), which is metadata
-only and non-destructive.

Every `NOT NULL` column added after the initial migration carries a `DEFAULT` in the same
statement — e.g. `ALTER TABLE "Activity" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false`
(`prisma/migrations/20260930103253_demo_flags/migration.sql:5`, repeated for 19 tables in the same
file). A `NOT NULL` column added with a constant `DEFAULT` does not require a backfill or a table
rewrite on modern Postgres — the specific risk the brief asked to check for ("later migration
makes a column NOT NULL without a backfill") **was not found**: there is no bare `SET NOT NULL`
anywhere in the 7 migrations.

No large-table lock risk is assessed as material: this is a pre-launch schema (`prisma validate`
is the only check that has run against it; no seeded production data exists per the brief's
constraints), so every migration to date runs against empty or near-empty tables. This is a
point-in-time observation, not a guarantee for future migrations once the tables above (notably
`ActivityLog`, `Media`, `Donation`) carry real volume — at that point an index addition should move
to `CREATE INDEX CONCURRENTLY` outside the default Prisma migration transaction, which none of the
7 migrations currently need to do.

## 6. Delete-action audit (every `.delete()` call in `src/server`)

| Call site | Target | Guard present | Outcome if guard insufficient |
|---|---|---|---|
| `media.ts:53` | `Media` | Published-`Document` check only | QA-DB-001 |
| `settings.ts:127` | `User` | None | QA-DB-002 |
| `trust.ts:116` | `Category` | None | All referencing FKs are `SetNull` — safe from an integrity standpoint, but silently declassifies published content with no "used by N items" warning (QA-DB-007, Informational) |
| `messages.ts:39` | `ContactMessage` | None needed — no inbound FK references this table | No risk |
| `volunteers/service.ts:50` | `VolunteerAvailability` | None needed — leaf row, no children | No risk |
| `projects/service.ts:191` | `ProjectTaskDependency` | None needed — composite-PK leaf row | No risk |

`Club` and `Project` have no `.delete()` call anywhere in `src/server` or `src/app` — confirmed by
grep; their lifecycle is exclusively status-driven, so they do not appear in this table.

## 7. Timezone / precision / encoding

- `VolunteerAttendance.serviceDate` is `@db.Date` (`schema.prisma:451`) — the one explicit
  date-only column; every other temporal column is `DateTime` (timestamp, implicitly UTC under
  Prisma's default mapping). No mixed-precision timestamp columns found.
- Money: `Decimal(30,8)` (`ApprovalInstance.amount`) vs `BigInt` paise
  (`DonationRequest.targetPaise`, `Donation.amountPaise`) are two different representations for the
  same concept, but **no code path converts between them today** — `startApproval()`
  (`src/server/approval/foundation.ts:200-230`) accepts a generic `subject.amount` and is only
  reachable once `requireLiveApprovals()` stops throwing, which it unconditionally does
  (`src/server/fundraising/service.ts:67`, consistent with REQ-APPR-046, SATISFIED/inert-by-design).
  This is a latent unit-conversion decision deferred to the gated Phase 7 work, not a present
  defect — noted here for the next phase that re-opens `docs/finance/phase7-ledger-design.md`, not
  filed as a finding.
- `ImpactMetric.value` as `Float` is already filed (QA-DATA-006, triaged wontfix); not re-raised.

## 8. Unknowns and limitations

1. No database was started; §4's "missing index" claims are schema/SQL-text analysis, not an
   `EXPLAIN` of an actual query plan. Whether Postgres's planner would ever choose a sequential
   scan in practice depends on table size, which is unverified (`REQUIRES_VERIFICATION`).
2. `AuditEvent` has no reader in `src/app` found by this pass (see database-inventory.md §5.3) —
   whether it is genuinely unread or read somewhere outside the directories in scope is open.
3. Vercel Blob's actual runtime behaviour (its own atomicity, latency, failure modes) was not
   exercised; §2's divergence analysis is based on symmetric reading of `src/lib/storage.ts`'s two
   branches, not on a live Blob failure.
4. Row counts for every table are unknown; severity on the index and pagination findings
   (QA-DB-005, QA-DB-006) is reasoned from write frequency in code, not measured growth.
5. This phase did not line-trace `src/lib/validations/admin.ts` end-to-end for every model (that
   was explicitly deferred to a later phase in `qa/architecture/application-architecture.md` §Unknowns
   item 4); only the fields relevant to deletion, archiving and media visibility were checked here.
