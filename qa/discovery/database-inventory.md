# Trustfolio — Database Inventory

Phase 3 (data architecture) output. **Static analysis only** — no database was started, no query
was executed, no migration was applied. Every claim below is a reading of `prisma/schema.prisma`
(1,877 lines, 63 models), the 7 migration directories, and the query/write layer under
`src/server/` and `src/app/api/`. `npx prisma validate` passed before this pass began.

## 1. Data stores (confirming `qa/discovery/repository-inventory.json`)

| Store | Confidence | Verified by |
|---|---|---|
| PostgreSQL via Prisma 7 + `@prisma/adapter-pg` | **Confirmed** | `src/lib/db.ts:1-24` (single adapter-backed `PrismaClient`, no second datasource block in `prisma/schema.prisma:18-20`) |
| `RateLimit` table (fixed-window counter, raw SQL upsert) | **Confirmed** | `src/lib/rate-limit.ts:24-31`; backing table `prisma/schema.prisma:720-726`; primary key confirmed in SQL at `prisma/migrations/20260930085332_init/migration.sql:68-73` (not just the Prisma schema — see §4) |
| Local filesystem (`./uploads`, `./private-uploads`) | **Confirmed, default driver** | `src/lib/storage.ts:34-35,78-84` |
| Vercel Blob | Coded path, `STORAGE_DRIVER` env-selected | `src/lib/storage.ts:5,67-76,89-91,104-106` — **REQUIRES_VERIFICATION** (env value not read this pass) |
| Redis / search index / message broker | **Not present** | No client, no config, no second connection string anywhere in `src/` outside the two stores above |

There is no third store. "Cross-store" analysis in this report is therefore specifically
Postgres-row ↔ stored-file (filesystem or Blob), via the `Media` table as the index.

## 2. Schema shape

- 63 models, 1,877 lines. No `relationMode = "prisma"` — all foreign keys are real Postgres
  constraints (`prisma/schema.prisma:18-20`, no override).
- `onDelete` is declared on every relation scalar field: 134 declarations total —
  **84 `Restrict`, 48 `SetNull`, 2 `Cascade`**. The 2 `Cascade` relations are both on the
  `GalleryImage` join row (`album` and `media`, `prisma/schema.prisma:1817-1818`) — nothing else in
  the schema cascades. See `qa/architecture/database-dependency-map.md` §1 for what this means for
  deletion.
- Money: `Decimal(30,8)` for approval amounts (`prisma/schema.prisma:608`), `BigInt` paise for
  fundraising/donations (`prisma/schema.prisma:1275,1404`). `ImpactMetric.value` is `Float`
  (`prisma/schema.prisma:1510`) — already filed as QA-DATA-006, triaged wontfix; not re-raised.
- Bilingual columns are paired `…En`/`…Ta` throughout; no separate translation table — confirmed
  by direct reading, consistent with `qa/architecture/application-architecture.md`.
- DB-level business rules beyond foreign keys, found in migration SQL (not visible in
  `schema.prisma`, which cannot express them):
  - Partial unique indexes: one `PENDING` `ApprovalInstance` per subject
    (`prisma/migrations/20261025000000_phase1_approval_foundation/migration.sql:326-327`), one
    `ACTIVE` `ApprovalPolicy` version per key (`:328-329`).
  - `CHECK` constraints enforcing scope shape, amount/currency pairing, delegation windows
    (`…phase1…/migration.sql:330-337`), donor/donation intake gates
    (`…phase6_donation_intake/migration.sql:80-82`), fundraising draft gates
    (`…phase5…/migration.sql:173-178`), task progress/schedule invariants
    (`…phase4…/migration.sql:292-299`).
  - `BEFORE UPDATE OR DELETE` triggers that make **every** `*History` table and `AuditEvent` /
    `ApprovalDecision` literally immutable at the SQL level, not just by application convention:
    `ApprovalDecision`, `AuditEvent` (`…phase1…/migration.sql:276-285`), `ClubMembershipHistory`
    (`…phase2…/migration.sql:141`), `VolunteerAttendanceHistory`, `VolunteerServiceLogHistory`
    (`…phase3…/migration.sql:172,174`), `ProjectClubAssignmentHistory`, `ProjectClubActivity`,
    `ProjectTaskHistory` (`…phase4…/migration.sql:300-302`), `DonationRequestHistory`,
    `DonationCampaignHistory` (`…phase5…/migration.sql:181-182`), `DonationHistory`
    (`…phase6…/migration.sql:89`). A direct SQL client, not only the app, cannot rewrite history.

This is a materially stronger integrity posture than the brief's premise assumed — see the
dependency map for what it implies about cascade blast radius.

## 3. Entity ownership (selected; full list is the 63 models in `prisma/schema.prisma`)

| Entity | Owning store | Defining module | Writing service(s) | Reading service(s) | Delete behaviour |
|---|---|---|---|---|---|
| `User` | Postgres | `schema.prisma:269-318` | `src/server/actions/admin/settings.ts` | `src/server/auth-guard.ts`, `src/server/queries/admin.ts:370-372` | Hard delete exposed (`deleteUser`, `settings.ts:122-134`); blocked by `Restrict` from ~20 relations once the user has any activity — see QA-DB-002 |
| `Media` | Postgres (row) + filesystem/Blob (bytes) | `schema.prisma:753-800` | `src/app/api/admin/upload/route.ts`, 4 operational evidence upload routes | `src/server/queries/admin-media.ts`, all public query modules via `shared.ts` | Hard delete exposed (`deleteMedia`, `media.ts:46-58`); checks published-document usage only — see QA-DB-001 |
| `Club` | Postgres | `schema.prisma:320-347` | `src/server/clubs/service.ts` | `src/app/club/[id]/page.tsx`, `src/server/queries/admin.ts` | No delete path found; lifecycle is status-driven (`DRAFT→ACTIVE→SUSPENDED→ARCHIVED`) |
| `Project` | Postgres | `schema.prisma:1022-1091` | `src/server/projects/service.ts`, `src/server/actions/admin/project-operations.ts` | `src/server/queries/public/work.ts`, `src/app/admin/(dashboard)/project-operations/[id]/page.tsx` | No delete path found; status-driven |
| `ClubDocument` / `ProjectTaskEvidence` / `DonationRequestEvidence` / `DonationEvidence` | Postgres (row) + private filesystem/Blob (bytes) | `schema.prisma:392-408,1249-1264,1314-1327,1441-1455` | `clubs/service.ts`, `projects/service.ts`, `fundraising/service.ts`, `donations/service.ts` | One admin page per model, all filter `archivedAt: null` where a filter exists | `ClubDocument` has a real archive action (`clubs/service.ts:99-101`); the other three have the column but **no writer ever sets it** — see QA-DB-004 |
| `ActivityLog` | Postgres | `schema.prisma:704-717` | `src/server/actions/admin-helpers.ts:71-81` (`logActivity`, every admin mutation) | `src/server/queries/admin.ts:316` (`take: 12`) | `onDelete: SetNull` on `userId` — row survives user deletion, loses attribution |
| `AuditEvent` | Postgres | `schema.prisma:669-684` | `src/server/approval/foundation.ts` | not read anywhere outside its own table (no admin viewer found) | `onDelete: Restrict` on `actorId`; immutable by trigger |
| `RateLimit` | Postgres | `schema.prisma:720-726` | `src/lib/rate-limit.ts:24-31` (raw SQL upsert) | same file | Opportunistic `deleteMany` on ~2% of calls (`rate-limit.ts:34-36`) |
| `NotificationOutbox` | Postgres | `schema.prisma:686-702` | `clubs/service.ts`, `volunteers/service.ts`, `projects/service.ts`, `approval/foundation.ts` — all inside the same `$transaction` as the business write (confirmed, e.g. `clubs/service.ts:120-123`) | `src/app/admin/(dashboard)/approvals/page.tsx:20` (display only) | No consumer transitions `PENDING`→`SENT`/`FAILED` — already documented in `qa/architecture/application-architecture.md` §Background work (QA-NOTIFY-007); not re-raised here since it is same-store, not a data-layer defect |

## 4. Rate limiter constraint — confirmed, not app-only

The brief asked to confirm `RateLimit.key`'s uniqueness is real SQL, not only the Prisma schema
annotation, because `rateLimit()` depends on `ON CONFLICT ("key")` succeeding atomically
(`src/lib/rate-limit.ts:24-30`). Confirmed:
`prisma/migrations/20260930085332_init/migration.sql:68-73` declares
`CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")`. The `ON CONFLICT` target exists at the database
level. No finding.

## 5. Unknowns and limitations

1. No database was started; every claim is a reading of schema and SQL text, not an observed
   query plan or constraint violation. Lock behaviour, actual row counts and query latency are
   unverified (`REQUIRES_VERIFICATION` where stated).
2. Vercel Blob is a coded path but its runtime selection (`STORAGE_DRIVER`) was not read in this
   pass; divergence analysis in §2 of the dependency map covers both drivers by reading
   `src/lib/storage.ts` symmetrically, not by exercising either one.
3. `AuditEvent` has no admin-facing reader found anywhere in `src/app/`; this may be a dead write
   path (write-only table) or a reader that exists outside the directories in scope for this phase.
   Not filed as a finding because it was not exhaustively searched outside `src/server` and
   `src/app`.
4. Table sizes are unknown (no data was queried). Severity judgements about "tables expected to
   grow unbounded" (e.g. `ActivityLog`, `Media`) are inferred from write frequency in the code
   (every admin mutation logs; every upload creates a row), not from measurement.
5. This report does not re-verify the publication/visibility gates already covered in
   `qa/discovery/requirements-inventory.md` (REQ-DOC-001 through REQ-DOC-006, REQ-MEDIA-007); it
   only adds the deletion- and storage-divergence angles those requirements did not test.
