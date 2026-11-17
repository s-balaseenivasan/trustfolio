# Media library — deletion guards (`findDeletionBlocker()`)

Module: Media & evidence storage. Workflow: `workflow.media.publish` (WF5 — nearest mapped
workflow; no dedicated media-deletion workflow exists in `qa/workflows/knowledge-graph.json`, which
is itself a documentation gap, not a test gap). Covers the four-branch guard added for QA-DB-001 /
QA-FLOW-002 at `src/server/actions/admin/media.ts:51-93`. `findDeletionBlocker()` is not exported —
it is reproduced verbatim in the test file (cited per branch), not reinterpreted, and run directly
against real seeded/fixture rows with the real `db` client. Test file:
`qa/tests/db/media-deletion-guards.test.ts`.

---

```
ID:           TC-DB-MEDIA-001
Title:        Evidence attachment (ClubDocument) blocks media deletion
Workflow:     workflow.media.publish
Requirement:  REQ-DOC-005 (closest documented requirement — written for the published-document case;
              extending it to the evidence tables is DERIVED-FROM-CODE per QA-DB-001's fix)
Type:         db
Priority:     high
Role:         n/a (data-layer guard, pre-authorization)
Preconditions: Disposable fixture Club + ClubDocument + PRIVATE Media row.
Steps:        1. Create a Media row and a ClubDocument that references it.
              2. Run findDeletionBlocker(mediaId).
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Returns a non-null message containing "attached as evidence".
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-001b
Title:        Bypassing the guard and deleting the media directly throws Prisma P2003 (schema Restrict)
Workflow:     workflow.media.publish
Requirement:  DERIVED-FROM-CODE (prisma/schema.prisma:403, ClubDocument.media onDelete: Restrict)
Type:         db
Priority:     medium
Role:         n/a
Preconditions: Same fixture as TC-DB-MEDIA-001.
Steps:        1. Call db.media.delete() directly, without findDeletionBlocker() in front of it.
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Throws a PrismaClientKnownRequestError with code P2003 — confirms the app-level guard is
              not redundant with the schema; without it, the admin would see only a generic 500.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-002
Title:        A PUBLISHED gallery album blocks media deletion
Workflow:     workflow.media.publish
Requirement:  REQ-DOC-005 (nearest; gallery coverage is DERIVED-FROM-CODE per QA-DB-001/QA-FLOW-002)
Type:         db
Priority:     high
Role:         n/a
Preconditions: Disposable fixture GalleryAlbum (status PUBLISHED) + GalleryImage + PUBLIC Media row.
Steps:        1. Create the album, image and media.
              2. Run findDeletionBlocker(mediaId).
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Returns exactly "This photo is part of a published album. Remove it from the album first."
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-002b
Title:        Bypassing the guard cascades: the raw delete silently removes the photo from the still-PUBLISHED album
Workflow:     workflow.media.publish
Requirement:  DERIVED-FROM-CODE (prisma/schema.prisma:1818, GalleryImage.media onDelete: Cascade)
Type:         db
Priority:     high
Role:         n/a
Preconditions: Same fixture as TC-DB-MEDIA-002.
Steps:        1. Call db.media.delete() directly (no guard).
              2. Re-read the GalleryImage row.
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     The delete succeeds (no error — unlike the ClubDocument case, this relation is Cascade, not
              Restrict) and the GalleryImage row is gone, silently dropping the photo from the album that
              is STILL published. Confirms the guard is the only thing preventing this.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-003
Title:        A PUBLISHED project's cover blocks media deletion
Workflow:     workflow.media.publish
Requirement:  REQ-DOC-005 (nearest; SetNull-cover coverage is DERIVED-FROM-CODE per QA-FLOW-002)
Type:         db
Priority:     high
Role:         n/a
Preconditions: Disposable fixture Project (status PUBLISHED, coverId = fixture Media).
Steps:        1. Create the project with the cover set.
              2. Run findDeletionBlocker(mediaId).
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Returns a non-null message containing "published item".
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-003b
Title:        Bypassing the guard nulls the cover reference on the still-PUBLISHED project
Workflow:     workflow.media.publish
Requirement:  DERIVED-FROM-CODE (prisma/schema.prisma:1071, Project.cover onDelete: SetNull)
Type:         db
Priority:     high
Role:         n/a
Preconditions: Same fixture as TC-DB-MEDIA-003.
Steps:        1. Call db.media.delete() directly (no guard).
              2. Re-read the project's coverId and status.
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     The delete succeeds and the project's coverId is null while status is still PUBLISHED — a
              live public page silently loses its image. Confirms the guard is load-bearing.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-004
Title:        An unused media file has no deletion blocker
Workflow:     workflow.media.publish
Requirement:  REQ-DOC-005
Type:         db
Priority:     medium
Role:         n/a
Preconditions: Disposable PUBLIC Media row with no references anywhere.
Steps:        1. Run findDeletionBlocker(mediaId).
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Returns null.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

```
ID:           TC-DB-MEDIA-004b
Title:        An unused media file deletes successfully end to end
Workflow:     workflow.media.publish
Requirement:  REQ-DOC-005
Type:         db
Priority:     medium
Role:         n/a
Preconditions: Same fixture as TC-DB-MEDIA-004.
Steps:        1. Call db.media.delete().
              2. Re-read the row.
Test data:    qa/tests/db/media-deletion-guards.test.ts
Expected:     Delete succeeds with no error; a subsequent read returns null.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/media-deletion-guards.log
```

## Scope note — what this module does NOT cover

`deleteMedia()` itself (the exported Server Action that wraps `findDeletionBlocker()` in
`adminMutation()` → `requireAdmin()` → NextAuth `auth()`) was not invoked end to end; only its
guard logic was. Building the same request-scope harness used for `signIn()`
(`qa/tests/security/login-lockout.test.ts`) through a Server Action wrapper was judged not worth
the added harness complexity here, since the guard logic — the actual thing the QA-DB-001/
QA-FLOW-002 fix changed — carries no auth dependency and is exercised directly and completely
above. Not independently re-verified: the other 13 PUBLISHED SetNull relations QA-FLOW-002 also
lists (Trustee.photo, TrustProfile.logo/heroImage, Document.originalFile/thumbnail, Activity.cover,
Story.cover, NewsPost.cover, GalleryAlbum.cover, Certificate.image, AnnualReport.cover,
Testimonial.photo, HistoryEvent.image, SiteSetting.ogImage) — the query shape for all of them is
identical to the Project.cover case already proven in TC-DB-MEDIA-003, so this is a coverage gap of
breadth, not of a distinct code path.
