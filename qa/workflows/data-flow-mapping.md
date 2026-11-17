# Trustfolio — Data Flow Mapping

Phase 6 output. Source-to-destination for the data that matters in the six traced workflows, with
validation, transformation and ownership named at **each hop**.

**Redaction.** No value from any real account, `.env` file or credential store appears here. Shapes
are described (`UUID v4`, `bcrypt hash, 60 chars`, `BigInt paise`); values are not. Credentials are
mapped only as far as the boundary where they stop existing in plaintext.

Static analysis only — no value was observed flowing.

---

## 0. Ownership key

| Store | What it owns | Evidence |
|---|---|---|
| **Postgres** (Prisma 7 + `@prisma/adapter-pg`) | every row of all 63 models; authoritative for everything except file bytes | `src/lib/db.ts:1-24` |
| **Local filesystem** `./uploads` / `./private-uploads` | file bytes, default driver | `src/lib/storage.ts:34-35,78-83` |
| **Vercel Blob** | file bytes when `STORAGE_DRIVER=vercel-blob` | `src/lib/storage.ts:67-76` — **REQUIRES_VERIFICATION**, never exercised |
| **JWT cookie** | `sub` + `role`, 8 h | `src/auth.config.ts:13-15,27-33` — derived, never authoritative |
| **`unstable_cache` tag store** | derived public read models | `src/server/actions/admin-helpers.ts:87-90` |

The single cross-store relationship in the application is `Media.storageKey` → file bytes. There is
no second database, no cache-as-source-of-truth, and no event log outside Postgres.

---

## 1. Login credentials (WF1)

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `email` | string, `type="email"`, `autoComplete="username"` | client `required` only; form is `noValidate` | none | browser | `src/app/admin/login/login-form.tsx:27` |
| 2 | `password` | string, `autoComplete="current-password"` | client `required` only | none | browser | `login-form.tsx:31` |
| 3 | both | FormData | `loginSchema.safeParse` | per that schema | server action | `src/server/actions/auth.ts:24` |
| 4 | `email` | string | re-parsed inside `authorize` | **used as rate-limit key material** | NextAuth | `src/auth.ts:25,29` |
| 5 | `email` + client IP | string | — | `hashIdentifier(ip:email)` → opaque digest; the plaintext pair never reaches the `RateLimit` table | Postgres `RateLimit` | `src/auth.ts:29`, `src/lib/rate-limit.ts:17` |
| 6 | `password` | string | — | `bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)` — compared even when no user exists, so timing does not disclose registration | — | `src/auth.ts:12,34` |
| 7 | `passwordHash` | bcrypt, cost 12 | — | read-only | Postgres `User` | `src/auth.ts:33` |
| 8 | — | — | — | plaintext password is **never written anywhere**: no log, no `ActivityLog.summary`, no error payload | — | `src/auth.ts:38-43` |
| 9 | `id`, `email`, `name`, `role` | — | — | returned to NextAuth, placed in the JWT as `sub` + `role` | JWT cookie | `src/auth.ts:45`, `src/auth.config.ts:27-33` |
| 10 | `role` | enum | — | **re-derived from the database on every request**, never trusted from the token for authorization | Postgres `User` | `src/server/auth-guard.ts:22-30` |

**Side effects of a successful login:** `User.lastLoginAt = now()` and one `ActivityLog` row
(`action: "LOGIN"`, `summary: "Signed in"`) in a single transaction (`src/auth.ts:38-43`).
**Side effects of a failure:** the `RateLimit` counter only. No failed-login audit record exists
anywhere — an observation, not a filed finding.

**Derived copy worth noting.** `session.user.role` defaults to `"EDITOR"` when the token has no role
claim (`src/auth.config.ts:36`). That default is never load-bearing because every guard re-reads the
row, but a future consumer that trusts `session.user.role` directly would silently promote a
`PORTAL_USER` to `EDITOR`. Recorded as a latent trap; not filed.

---

## 2. Membership consent (WF2)

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `adult`, `consent` | checkboxes, value `"yes"` | both `required` client-side | — | browser | `src/components/club/membership-request.tsx:15-16` |
| 2 | `clubId` | string | `z.string().min(1).max(64)` | — | server action | `src/server/actions/club/membership.ts:16` |
| 3 | both flags | — | re-checked `=== "yes"` server-side | → booleans | server action | `membership.ts:17-19` |
| 4 | both flags | — | re-checked a **third** time in the service | — | service | `src/server/clubs/service.ts:131` |
| 5 | consent record | `{consentAt, adultAttestedAt, consentVersion}` | — | `consentAt`/`adultAttestedAt` = `new Date()` server-side (never client-supplied); `consentVersion = CLUB_CONSENT_VERSION` from `src/lib/validations/club.ts` | Postgres `ClubMembership` | `src/server/clubs/service.ts:38,138-139` |
| 6 | consent record | — | re-verified at approval: all three must be present and the version must equal the current constant | service | `src/server/clubs/service.ts:153` |
| 7 | consent snapshot | — | `ClubMembershipHistory` row; immutable at SQL level | Postgres (trigger-protected) | `src/server/clubs/service.ts:140`, `prisma/migrations/20261025010000_phase2_clubs/migration.sql:141` |
| 8 | audit | `{membershipId, consentVersion}` JSON | — | `AuditEvent` with a fresh `correlationId` UUID | Postgres `AuditEvent` | `src/server/clubs/service.ts:29-36,141` |

**Consent text is not in the repository as a versioned artefact** — `CLUB_CONSENT_TEXT` is a
TypeScript constant rendered directly into the form (`membership-request.tsx:16`). The stored
`consentVersion` therefore points at a string literal in source, not at an archived document. This
is exactly the gap `qa/discovery/requirements-inventory.md:157` records: whether the member actually
consented to the roster disclosure in QA-REQ-006 **cannot be decided from code**.

### Personal data downstream of an approved membership

| Field | Flows to | Audience | Opt-in? | Evidence |
|---|---|---|---|---|
| `User.name` | coordinator workspace roster | club coordinator | **no** | `src/app/club/[id]/page.tsx:20` |
| `User.email` | coordinator workspace roster | club coordinator | **no** — QA-REQ-006 | `src/app/club/[id]/page.tsx:20` |
| `VolunteerProfile.skills`, `.interests` | skills section of the same page | club coordinator | **yes** — filtered on `shareSkillsWithClubs` | `src/app/club/[id]/page.tsx:21` |
| `User.name`, `.email` | admin club detail, admin volunteers queue | ADMIN | n/a | `src/app/admin/(dashboard)/clubs/[id]/page.tsx:24`, `volunteers/page.tsx:32` |
| any of the above | **public queries** | visitors | — | **never**: no club, volunteer, task or donation model is referenced anywhere under `src/server/queries/public/` (REQ-PUB-021, `qa/discovery/requirements-inventory.md:42`) |

Both roster fields travel in a single **unbounded** response (`src/app/club/[id]/page.tsx:17`, no
`take`) — QA-API-002 compounding QA-REQ-006.

---

## 3. Volunteer records and the hours total (WF3)

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `skills`, `interests` | comma-separated string, `maxLength=400` | `z.string().trim().max(400)` | split on `,` → trim → drop empties → **de-duplicate via `Set`** → `slice(0, 12)` | — | `src/lib/validations/volunteer.ts:6` |
| 2 | `shareSkillsWithClubs` | checkbox `"yes"` | `z.boolean()` | `=== "yes"` → boolean | Postgres `VolunteerProfile` | `src/server/actions/volunteer/records.ts:37` |
| 3 | `startTime`, `endTime` | `HH:MM` strings from `<input type="time">` | regex `^([01]\d\|2[0-3]):[0-5]\d$` **before** Zod | → `minuteOfDay` integer 0–1439 / 1–1440; `endMinute > startMinute` refine | Postgres `VolunteerAvailability` | `records.ts:47-52`, `src/lib/validations/volunteer.ts:15-20` |
| 4 | `timeZone` | string, default `"Asia/Kolkata"` | `z.string().trim().min(1).max(64)` then **`new Intl.DateTimeFormat`** as a liveness check | stored verbatim | Postgres | `src/server/volunteers/service.ts:36` |
| 5 | `serviceDate` | `YYYY-MM-DD` | `z.iso.date()` then a round-trip equality check and a not-in-the-future check | `new Date(\`${d}T00:00:00.000Z\`)` — **UTC midnight**, stored in a `@db.Date` column | Postgres `VolunteerAttendance` | `src/server/volunteers/service.ts:56-57`, `prisma/schema.prisma:451` |
| 6 | `activityTitle` | string | `min(3).max(160)` client **and** server | trim | Postgres | `src/lib/validations/volunteer.ts:25`, `workspace.tsx:37` |
| 7 | `minutes` | number input `min=1 max=1440` | `z.coerce.number().int().min(1).max(1440)` — client and server agree exactly | coerce | Postgres `VolunteerServiceLog` | `src/lib/validations/volunteer.ts:29`, `workspace.tsx:38` |
| 8 | `description` | string | `min(3).max(1000)` client **and** server | trim | Postgres | `src/lib/validations/volunteer.ts:30` |
| 9 | `reason` (reviewer) | string | server `max(1000)` at the action, `>= 3` for non-approve in the service; **client has neither `required` nor `minLength`** | trim; empty → `null` in history | Postgres history | `src/server/actions/admin/volunteers.ts:19`, `src/server/volunteers/service.ts:86`, `src/components/admin/volunteer-review.tsx:10` — QA-UI-001 |
| 10 | snapshot | JSON | — | attendance snapshot `{serviceDate (date only), activityTitle}`; log snapshot `{minutes, description, attendanceId}` — copies, frozen by trigger | Postgres history | `src/server/volunteers/service.ts:95,110` |
| 11 | **derived total** | integer minutes | — | `aggregate _sum.minutes` where log `APPROVED` **and** attendance `APPROVED`; rendered as `floor(m/60)` h + `m%60` min | computed per request, **never stored** | `src/app/volunteer/page.tsx:19`, `src/components/volunteer/workspace.tsx:38` |

**Ownership note.** The confirmed hours total is a pure derivation with no cached or denormalised
copy anywhere. Nothing can drift, and `REQ-VOL-039` cannot be violated by a stale counter.

**Timezone asymmetry.** `serviceDate` is date-only UTC (`@db.Date`), while availability carries an
IANA timezone string and `reviewedAt`/`createdAt` are UTC timestamps. A volunteer in a non-IST zone
submitting near midnight local records the previous or next UTC day. The not-in-the-future check uses
`Date.now()` against UTC midnight (`src/server/volunteers/service.ts:57`), so "today" in IST is
accepted; a timezone ahead of UTC could in principle be rejected. **UNVERIFIED** — needs a request
with a non-IST clock to confirm.

---

## 4. Task evidence file (WF4) — the only genuinely cross-store flow

```
browser File  →  multipart POST  →  magic-byte sniff  →  bytes on disk/Blob
                                                              ↓ (no shared transaction)
                                                   Media row  →  ProjectTaskEvidence row
```

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `file` | `File`, `accept="image/jpeg,png,webp,avif,gif,application/pdf"` | client `required` + `accept` | — | browser | `src/components/projects/task-evidence-upload.tsx:22` |
| 2 | `title` | string | `minLength=3 maxLength=160` client **and** `z.string().trim().min(3).max(160)` server | trim | — | `task-evidence-upload.tsx:22`, `src/app/api/project-tasks/[id]/evidence/route.ts:30` |
| 3 | `kind` | `ATTACHMENT` \| `COMPLETION` | `z.enum` server-side; the select offers exactly those two | — | — | `evidence/route.ts:31` |
| 4 | request | multipart | `Origin` host **and** protocol must match | — | — | `evidence/route.ts:12-18` |
| 5 | `file.size` | bytes | `<= UPLOAD_MAX_MB * 1024 * 1024` | — | — | `evidence/route.ts:34`, `src/lib/env.ts` |
| 6 | `file.type` | MIME string | `isAllowedType` allowlist of 6 | — | — | `evidence/route.ts:35`, `src/lib/storage.ts:16-23` |
| 7 | first 16 bytes | `Uint8Array` | `sniffMatches` — JPEG `FF D8 FF`, PNG `89 50 4E 47`, `GIF8`, `RIFF`+`WEBP`, `ftyp` at offset 4, `%PDF` | a renamed file is rejected here | — | `src/lib/storage.ts:42-58` |
| 8 | `file.name` | string | — | `slice(0, 200)` then `replace(/[^\p{L}\p{N}._ -]/gu, "_")` — unicode letters/digits kept, everything else underscored | Postgres `Media.filename` | `evidence/route.ts:41` |
| 9 | bytes | — | — | `storeFile(file, "PRIVATE", "project-task-evidence")` → key `private/project-task-evidence/YYYY-MM/<uuid v4>.<ext>`; local path strips the leading segment and writes under `./private-uploads` | **filesystem or Blob** | `src/lib/storage.ts:61-83` |
| 10 | `url` | string | — | PRIVATE → `private:<storageKey>` sentinel, **never a fetchable URL**; PUBLIC → `/uploads/<relative>` | Postgres `Media.url` | `src/lib/storage.ts:83` |
| 11 | `storageKey` | string, `@unique` | re-asserted to start with `private/project-task-evidence/` inside the service | — | Postgres `Media.storageKey` | `src/server/projects/service.ts:263` |
| 12 | row pair | — | one `Serializable` transaction writes `Media` (`visibility: "PRIVATE"`, `uploadedById`) then `ProjectTaskEvidence` | — | Postgres | `src/server/projects/service.ts:272-273` |
| 13 | task history | — | — | a note is appended: `"Completion evidence uploaded: <evidenceId>"` or `"Attachment uploaded: …"` | Postgres `ProjectTaskHistory` (trigger-immutable) | `src/server/projects/service.ts:274` |
| 14 | failure | — | — | `deleteStoredFile({...stored, visibility:"PRIVATE"})` removes the bytes, so no orphan | both stores | `evidence/route.ts:45` |
| 15 | read back | — | `archivedAt` null, `visibility === "PRIVATE"`, `storageKey.startsWith(TASK_EVIDENCE_STORAGE_PREFIX)`, then `requireTaskReader` | local driver re-resolves the path and refuses anything escaping `./private-uploads` | — | `src/app/api/task-evidence/[id]/file/route.ts:13-15`, `src/lib/storage.ts:95` |
| 16 | response | bytes | — | `Content-Disposition: inline; filename="<urlencoded>"`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff` | — | `task-evidence/file/route.ts:17` |

**`storageKey` never leaves the server.** The admin media DTO strips it
(`src/server/queries/admin-media.ts:23`, REQ-SEC-029) and the evidence routes return only `{id}`
(`evidence/route.ts:43`). No response in this flow discloses a filesystem path or a Blob pathname.

### The same flow on the generic admin upload route (WF5) diverges once

| Hop | Generic `/api/admin/upload` | The four evidence routes |
|---|---|---|
| same-origin | host only (`src/app/api/admin/upload/route.ts:11-13`) | host **and** protocol (`evidence/route.ts:16`) — QA-API-003 |
| namespace | **none** → `public/…` or `private/…` | `private/<namespace>/…` |
| failure after bytes land | **no compensation** → bytes orphaned (`upload/route.ts:72-75`) — QA-DB-003 | `deleteStoredFile` called |
| secondary write | `ActivityLog` created **after** `Media`, inside the same `try`; if it throws, the response is 500 while the `Media` row already exists, so a retry produces a second file **and** a second row | no secondary write in the critical path |

The last row is an additional, narrower window than QA-DB-003 (which covers the bytes-without-row
case). It is recorded here rather than filed because `logActivity` elsewhere swallows its own errors
(`src/server/actions/admin-helpers.ts:80`) while this route calls `db.activityLog.create` directly
(`upload/route.ts:67`) — **UNVERIFIED**: needs an induced `ActivityLog` failure to confirm the 500
path.

---

## 5. Document publication (WF5)

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `fileId` | Media id | must reference `visibility === "PUBLIC"` | — | Postgres `Document.fileId` | `src/server/actions/admin/evidence.ts:23` |
| 2 | `originalFileId` | Media id | must reference `visibility === "PRIVATE"` **and** must not be operational-private media | — | Postgres `Document.originalFileId` | `evidence.ts:26,29` |
| 3 | `containsPersonalData`, `isRedacted` | booleans | publishing publicly with personal data requires `isRedacted` | — | Postgres | `src/lib/validations/admin.ts:285` |
| 4 | `status` | `DRAFT`\|`PUBLISHED`\|`ARCHIVED` | `PUBLISHED` + `PUBLIC` requires a public file | — | Postgres | `src/lib/validations/admin.ts:289` |
| 5 | `publishedAt` | timestamp | — | `publishedAtFor`: set once on first publish, **never overwritten or cleared** | Postgres | `src/server/actions/admin-helpers.ts:93-96` |
| 6 | audit | — | — | `ActivityLog` row: `"Added document “<titleEn>”"`, `summary.slice(0,300)` | Postgres `ActivityLog` | `admin-helpers.ts:79` |
| 7 | cache | — | — | `expire(documents, trust, projects, activities, reports, verification)` → `updateTag` each + `refresh()` | tag store | `evidence.ts:36`, `admin-helpers.ts:87-90` |
| 8 | public read | — | `PUBLIC_DOCUMENT_WHERE` allowlist re-applied; private media stripped from the DTO | derived view model | Postgres → DTO | `src/server/queries/public/shared.ts:40,101,122` |

**Three independent enforcement layers** for the same rules — Zod refine, bulk-action re-check
(`src/server/actions/admin/bulk.ts:44-54`), and the public read filter. A record that slipped past
the first two is still invisible publicly.

**Derived-copy inventory for `Media`:** the bytes are the only true copy; `Media.url` is a derived
convenience (a sentinel for PRIVATE), and every content model holds a foreign key, not a copy. There
is no thumbnail generation, no CDN mirror and no second rendition anywhere in `src/lib/storage.ts`.

---

## 6. Donation amount (WF6)

| Hop | Field | Shape | Validation | Transformation | Owner | Evidence |
|---|---|---|---|---|---|---|
| 1 | `amountRupees` | string, `inputMode="decimal"`, placeholder `0.00` | **no client validation at all** | — | browser | `src/components/admin/donation-intake.tsx:42` |
| 2 | `amountRupees` | string | regex `^(?:0\|[1-9]\d{0,13})(?:\.\d{1,2})?$` — at most 2 decimals, no leading zeros, ≤14 integer digits | — | — | `src/lib/validations/donations.ts:4` |
| 3 | `amountRupees` | string | refine: `rupeesToPaise(value) > 0n` | — | — | `src/lib/validations/donations.ts:5` |
| 4 | → `amountPaise` | `BigInt` | `rupeesToPaise` re-validates the regex, then `BigInt(whole)*100n + BigInt(fraction.padEnd(2,"0"))` — **integer arithmetic only, no float ever involved** | string → BigInt paise | — | `src/lib/validations/fundraising.ts:7-13` |
| 5 | `amountPaise` | `BigInt` column | SQL `CHECK` enforces > 0 and currency `INR` | — | Postgres `Donation.amountPaise` | `prisma/schema.prisma:1404`, `prisma/migrations/20261026073000_phase6_donation_intake/migration.sql:81` |
| 6 | snapshot | string | — | `amountPaise.toString()` inside the `DonationHistory` JSON snapshot (JSON cannot hold BigInt) | Postgres `DonationHistory` | `src/server/donations/service.ts:59` |
| 7 | audit | string | — | same `.toString()` in the `AuditEvent` details | Postgres `AuditEvent` | `src/server/donations/service.ts:61` |
| 8 | display | string | — | `formatPaise`: `₹` + `Intl.NumberFormat("en-IN")` on `paise/100n` + `.` + `(paise%100n)` zero-padded — **integer division, no rounding error** | derived | `src/lib/validations/fundraising.ts:15-19` |
| 9 | donor view | string | — | same `formatPaise`; the **status cell is a hardcoded literal**, not `d.status` | derived | `src/app/donor/page.tsx:18` — QA-FLOW-010 |

**Money representation is internally consistent for this workflow.** `Decimal(30,8)` exists on
`ApprovalInstance.amount` (`prisma/schema.prisma:608`) but **no code path converts between the two
representations today** — `startApproval` is unreachable while `requireLiveApprovals()` throws
(`src/server/fundraising/service.ts:67`). The latent unit-conversion decision is recorded in
`qa/architecture/database-dependency-map.md:187-195` and is deliberately not re-filed here.

### Idempotency and fingerprint

| Hop | Field | Shape | Notes | Evidence |
|---|---|---|---|---|
| 1 | `idempotencyKey` | UUID v4 | minted **server-side** per page render via `node:crypto randomUUID()`, passed to the client as a hidden input | `src/app/admin/(dashboard)/donations/page.tsx:25`, `donation-intake.tsx:36` |
| 2 | `idempotencyKey` | UUID | `z.uuid()`; `@unique` in Postgres | `src/lib/validations/donations.ts:16`, `qa/architecture/database-dependency-map.md:122` |
| 3 | `requestFingerprint` | SHA-256 hex | `createHash("sha256").update(JSON.stringify([donorProfileId, projectId, campaignId, amountPaise.toString(), method, receivedAt, reference, privateNote]))` — covers **every** input field, so no detail can change under a reused key | `src/server/donations/service.ts:35` |
| 4 | replay | — | same key + same fingerprint → the existing row is returned and the action still reports success; same key + different fingerprint → `IDEMPOTENCY_CONFLICT` | `src/server/donations/service.ts:37-39` |

A genuinely repeated identical donation submitted under one page render would be absorbed as a
replay. The button is `disabled` while pending and `router.refresh()` re-mints the key on success
(`donation-intake.tsx:34,47`), so the window is narrow — **UNVERIFIED**, needs a browser session.

### Private donation fields and where they are allowed to go

| Field | Reaches admin | Reaches donor | Reaches public | Evidence |
|---|---|---|---|---|
| `amountPaise` | yes | yes (own rows only) | **no** | `donations/page.tsx:29`, `donor/page.tsx:18` |
| `reference` | yes | **no** | no | `donations/page.tsx:29` vs `donor/page.tsx:14` select list |
| `privateNote` | written, **not selected by either page** | no | no | `src/server/donations/service.ts:55`; absent from both page selects |
| `DonationEvidence` file | yes, via an ADMIN-only route | no | no | `src/app/api/admin/donations/evidence/[id]/file/route.ts:7` |
| donor identity | yes | own only | **no donor display exists** | REQ-DON-045, `qa/discovery/requirements-inventory.md:66` |

`REQ-DON-045` holds: `/donor` selects exactly `{id, amountPaise, currency, method, status,
receivedAt, project.titleEn}` (`src/app/donor/page.tsx:14`) — no reference, no note, no evidence.

---

## 7. Cross-workflow data-ownership summary

| Datum | Authoritative store | Derived copies | Can they drift? |
|---|---|---|---|
| `User.role` | Postgres `User` | JWT `role` claim | **No** — every guard re-reads the row (`auth-guard.ts:22`) |
| Membership status | Postgres `ClubMembership` | none | No copies exist |
| Approved volunteer minutes | computed per request | none | No — pure aggregate |
| Task progress / status | Postgres `ProjectTask` | `ProjectTaskHistory` snapshots (immutable, intentionally frozen) | History is a deliberate point-in-time copy |
| File bytes | filesystem or Blob | `Media.url` sentinel, `Media.storageKey` index | **Yes, in two directions** — QA-DB-003 (bytes without a row) and QA-FLOW-002 / QA-DB-001 (row deleted while a published page still expects it) |
| Donation amount | Postgres `Donation.amountPaise` | `DonationHistory.snapshot`, `AuditEvent.details` (both strings, both immutable) | Snapshots are intentional |
| Public read models | Postgres | `unstable_cache` tagged entries | **Yes** — direct DB or seed writes bypass `expire()` (`APPLICATION_CONTEXT.md:97`); the dashboard offers an ADMIN-only manual refresh |

---

## 8. Validation parity table (client vs server) for the fields traced above

| Field | Client | Server | Verdict |
|---|---|---|---|
| login email/password | `required` only | `loginSchema` | server-only by design (`noValidate`) |
| membership adult/consent | both `required` | re-checked twice | **parity, plus defence in depth** |
| volunteer `activityTitle` | `minLength=3 maxLength=160` | `min(3).max(160)` | **exact parity** |
| volunteer `minutes` | `min=1 max=1440` | `min(1).max(1440)` | **exact parity** |
| volunteer `description` | `minLength=3 maxLength=1000` | `min(3).max(1000)` | **exact parity** |
| availability times | `type="time"` | regex + minute range + ordering refine | server stricter — fine |
| review `reason` | **none** | `>= 3` for non-approve | **mismatch — QA-UI-001** |
| task `progressPercent` | `min=0 max=100` | `min(0).max(100)` | **exact parity** |
| task `note` | `minLength=3 maxLength=2000` | `min(3).max(2000)` | **exact parity** |
| evidence `title` | `minLength=3 maxLength=160` | `min(3).max(160)` | **exact parity** |
| evidence file type | `accept` attribute | MIME allowlist + magic bytes | server far stricter — correct |
| donor `organizationName` | `maxLength=180` only | conditional `superRefine` on type | **mismatch — QA-UI-003** |
| donation `amountRupees` | **none** | regex + `>0` refine | **mismatch** — no client hint at all (narrower than QA-UI-003; recorded, not filed) |
| donation `receivedAt` | `max={today}` | `z.iso.date()` + not-future refine | **parity** |
| document slots / publication | none (`EntityForm` is `noValidate` by design) | Zod refines + bulk re-check + public filter | server-only by design, three layers |

---

## 9. Unknowns and limitations

1. No value was observed flowing. Every transformation above is read from source, not traced at
   runtime.
2. **Vercel Blob** (`STORAGE_DRIVER=vercel-blob`) was never exercised; hops 9–10 and 15 of §4 were
   read symmetrically from `src/lib/storage.ts` for both drivers. Blob's own atomicity and failure
   modes are unknown.
3. `UPLOAD_MAX_MB` and every other environment value were **not read** (names only, per the
   playbook), so the concrete size ceiling in §4 hop 5 is unknown.
4. The timezone edge in §3 and the idempotency window in §6 are both marked **UNVERIFIED** above
   with the exact evidence each needs.
5. `privateNote` is written but selected by neither page read in this pass; whether any other query
   surfaces it was not exhaustively searched outside `src/app` and `src/server`.
6. `src/lib/env.ts` was read only for the names it exports; no defaulting or coercion logic inside
   it was line-traced.
