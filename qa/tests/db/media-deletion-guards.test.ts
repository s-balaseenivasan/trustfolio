/**
 * TC-DB-MEDIA-* — media deletion guard, `findDeletionBlocker()` (QA priority 3: QA-DB-001 /
 * QA-FLOW-002).
 *
 * `findDeletionBlocker()` (src/server/actions/admin/media.ts:51-93) is not exported — it is a
 * module-private helper used only by `deleteMedia()`, which is itself wrapped in `adminMutation()`
 * → `requireAdmin()` → NextAuth `auth()`. That auth chain needs a real Next.js request scope (see
 * `qa/tests/security/login-lockout.test.ts` for the harness that provides one for `signIn()`);
 * wiring the same scope through a Server Action wrapper was judged not worth it here, because the
 * thing actually at risk — the four-branch deletion-blocker logic itself — has no auth dependency
 * at all. So this suite:
 *
 *   1. Reproduces `findDeletionBlocker()` verbatim (copied from src/server/actions/admin/media.ts,
 *      cited per branch below) and runs it directly against real seeded rows, using the REAL
 *      `db` client — not a reimplementation of the app's intent, a byte-for-byte copy of its
 *      queries.
 *   2. Separately proves, by calling the real `db.media.delete()` with NO guard in front of it,
 *      that the blocker is load-bearing: the schema-level `Restrict`/`Cascade`/`SetNull` behavior
 *      it exists to paper over is exactly what the source code comments say it is.
 *
 * Run:
 *   node --require ./node_modules/tsx/dist/cjs/index.cjs \
 *        --require ./qa/tests/_harness/server-only-stub.cjs \
 *        ./qa/tests/db/media-deletion-guards.test.ts
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://qa:qa_throwaway@127.0.0.1:55432/trustfolio_qa";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "qa-selftest-secret-at-least-32-characters-long";

type Result = { id: string; title: string; pass: boolean; detail: string };

async function main() {
  const { db } = require("../../../src/lib/db.ts");

  const results: Result[] = [];
  function record(id: string, title: string, pass: boolean, detail: string) {
    results.push({ id, title, pass, detail });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${id} — ${title} :: ${detail}`);
  }

  // Verbatim copy of src/server/actions/admin/media.ts:51-93 (DERIVED-FROM-CODE — the original is
  // not exported). Any future edit to the source must be mirrored here or this suite drifts from
  // what ships.
  async function findDeletionBlocker(mediaId: string): Promise<string | null> {
    const [clubDocuments, taskEvidence, requestEvidence, donationEvidence] = await Promise.all([
      db.clubDocument.count({ where: { mediaId } }),
      db.projectTaskEvidence.count({ where: { mediaId } }),
      db.donationRequestEvidence.count({ where: { mediaId } }),
      db.donationEvidence.count({ where: { mediaId } }),
    ]);
    const evidenceUses = clubDocuments + taskEvidence + requestEvidence + donationEvidence;
    if (evidenceUses) {
      return `This file is attached as evidence in ${evidenceUses} record${evidenceUses === 1 ? "" : "s"}. Remove the attachment first.`;
    }

    const galleryUses = await db.galleryImage.count({ where: { mediaId } });
    if (galleryUses) {
      const publishedAlbums = await db.galleryImage.count({ where: { mediaId, album: { status: "PUBLISHED" } } });
      return publishedAlbums
        ? "This photo is part of a published album. Remove it from the album first."
        : `This photo is used in ${galleryUses} album${galleryUses === 1 ? "" : "s"}. Remove it from the album first.`;
    }

    const [publishedDocuments, publishedProjects, publishedActivities, publishedNews, publishedStories, publishedAlbumCovers, trustUses, trusteeUses] =
      await Promise.all([
        db.document.count({ where: { OR: [{ fileId: mediaId }, { originalFileId: mediaId }, { thumbnailId: mediaId }], status: "PUBLISHED" } }),
        db.project.count({ where: { coverId: mediaId, status: "PUBLISHED" } }),
        db.activity.count({ where: { coverId: mediaId, status: "PUBLISHED" } }),
        db.newsPost.count({ where: { coverId: mediaId, status: "PUBLISHED" } }),
        db.story.count({ where: { coverId: mediaId, status: "PUBLISHED" } }),
        db.galleryAlbum.count({ where: { coverId: mediaId, status: "PUBLISHED" } }),
        db.trustProfile.count({ where: { OR: [{ logoId: mediaId }, { heroImageId: mediaId }] } }),
        db.trustee.count({ where: { photoId: mediaId, status: "PUBLISHED" } }),
      ]);
    const publishedUses =
      publishedDocuments + publishedProjects + publishedActivities + publishedNews + publishedStories + publishedAlbumCovers + trustUses + trusteeUses;
    if (publishedUses) {
      return `This file is used by ${publishedUses} published item${publishedUses === 1 ? "" : "s"}. Unpublish or replace them first.`;
    }
    return null;
  }

  const suffix = randomUUID().slice(0, 8);
  const cleanup: Array<() => Promise<void>> = [];
  const mkMedia = (visibility: "PUBLIC" | "PRIVATE", tag: string) =>
    db.media.create({
      data: {
        url: `https://example.test/qa-media-${tag}-${suffix}`,
        storageKey: `qa-fixtures/media-${tag}-${suffix}`,
        filename: `${tag}.jpg`,
        mimeType: "image/jpeg",
        size: 1024,
        visibility,
      },
    });

  try {
    const fixtureUser = await db.user.create({
      data: { email: `qa-media-fixture-${suffix}@example.test`, passwordHash: "test-only", role: "ADMIN", name: "QA media fixture (disposable)" },
    });
    cleanup.push(async () => db.user.delete({ where: { id: fixtureUser.id } }));

    // ------------------------------------------------------------------
    // TC-DB-MEDIA-001 — evidence attachment (ClubDocument) blocks deletion.
    // ------------------------------------------------------------------
    {
      const club = await db.club.create({ data: { code: `QA-MEDIA-${suffix}`, nameEn: "QA media fixture club", createdById: fixtureUser.id } });
      cleanup.push(async () => db.club.delete({ where: { id: club.id } }));
      const media = await mkMedia("PRIVATE", "evidence");
      const clubDocument = await db.clubDocument.create({
        data: { clubId: club.id, mediaId: media.id, titleEn: "QA fixture document", createdById: fixtureUser.id },
      });
      // Deleted inline (not via the generic `cleanup` LIFO stack) because the order matters here
      // and must not depend on push order: ClubDocument must go before Media, since it is Media
      // that ClubDocument restricts, not the reverse.

      const blocker = await findDeletionBlocker(media.id);
      record(
        "TC-DB-MEDIA-001",
        "a media file attached as club-document evidence is blocked from deletion",
        typeof blocker === "string" && blocker.includes("attached as evidence"),
        JSON.stringify(blocker),
      );

      // Prove the guard is load-bearing: without it, the raw delete throws the P2003 that
      // src/server/actions/admin/media.ts:98-100's comment says it would (ClubDocument.media is
      // onDelete: Restrict — prisma/schema.prisma:403).
      let threw: any = null;
      try {
        await db.media.delete({ where: { id: media.id } });
      } catch (e: any) {
        threw = e;
      }
      record(
        "TC-DB-MEDIA-001b",
        "bypassing the app guard and deleting the media directly throws Prisma P2003 (ClubDocument.media onDelete: Restrict, schema.prisma:403) — confirms the guard is not redundant with the schema",
        threw?.code === "P2003",
        `code=${threw?.code} message=${String(threw?.message).split("\n")[0]}`,
      );
      // media row still exists (the delete above failed) — remove the ClubDocument first, then
      // the media, in that explicit order.
      await db.clubDocument.delete({ where: { id: clubDocument.id } });
      await db.media.delete({ where: { id: media.id } });
    }

    // ------------------------------------------------------------------
    // TC-DB-MEDIA-002 — a PUBLISHED gallery album blocks deletion, and the raw delete (bypassing
    // the guard) cascades, silently removing the photo from the published album.
    // ------------------------------------------------------------------
    {
      const album = await db.galleryAlbum.create({
        data: { slug: `qa-media-album-${suffix}`, titleEn: "QA fixture album", status: "PUBLISHED", publishedAt: new Date() },
      });
      cleanup.push(async () => db.galleryAlbum.delete({ where: { id: album.id } }).catch(() => undefined));
      const media = await mkMedia("PUBLIC", "gallery");
      const galleryImage = await db.galleryImage.create({ data: { albumId: album.id, mediaId: media.id } });

      const blocker = await findDeletionBlocker(media.id);
      record(
        "TC-DB-MEDIA-002",
        "a media file used in a PUBLISHED gallery album is blocked from deletion",
        blocker === "This photo is part of a published album. Remove it from the album first.",
        JSON.stringify(blocker),
      );

      // Bypass the guard: GalleryImage.media is onDelete: Cascade (schema.prisma:1818), not
      // Restrict — the raw delete must succeed and silently remove the GalleryImage row.
      await db.media.delete({ where: { id: media.id } });
      const stillThere = await db.galleryImage.findUnique({ where: { id: galleryImage.id } });
      record(
        "TC-DB-MEDIA-002b",
        "bypassing the app guard cascades: the media delete succeeds and silently removes the photo from the still-PUBLISHED album (GalleryImage onDelete: Cascade, schema.prisma:1818) — confirms the guard is the only thing preventing this",
        stillThere === null,
        `galleryImage after raw delete = ${JSON.stringify(stillThere)}`,
      );
    }

    // ------------------------------------------------------------------
    // TC-DB-MEDIA-003 — a PUBLISHED project cover blocks deletion, and the raw delete (bypassing
    // the guard) nulls the live cover reference (SetNull).
    // ------------------------------------------------------------------
    {
      const media = await mkMedia("PUBLIC", "cover");
      const project = await db.project.create({
        data: {
          slug: `qa-media-project-${suffix}`,
          titleEn: "QA fixture project",
          summaryEn: "QA fixture project summary",
          status: "PUBLISHED",
          publishedAt: new Date(),
          coverId: media.id,
        },
      });
      cleanup.push(async () => db.project.delete({ where: { id: project.id } }).catch(() => undefined));

      const blocker = await findDeletionBlocker(media.id);
      record(
        "TC-DB-MEDIA-003",
        "a media file used as a PUBLISHED project's cover is blocked from deletion",
        typeof blocker === "string" && blocker.includes("published item"),
        JSON.stringify(blocker),
      );

      // Bypass the guard: Project.cover is onDelete: SetNull (schema.prisma:1071) — the raw
      // delete must succeed and silently null the live, published project's cover.
      await db.media.delete({ where: { id: media.id } });
      const projectAfter = await db.project.findUnique({ where: { id: project.id }, select: { coverId: true, status: true } });
      record(
        "TC-DB-MEDIA-003b",
        "bypassing the app guard nulls the cover reference on the still-PUBLISHED project (Project.cover onDelete: SetNull, schema.prisma:1071) — confirms the guard is the only thing preventing a silently blanked live page",
        projectAfter?.coverId === null && projectAfter?.status === "PUBLISHED",
        JSON.stringify(projectAfter),
      );
    }

    // ------------------------------------------------------------------
    // TC-DB-MEDIA-004 — an unused file has no blocker and deletes successfully.
    // ------------------------------------------------------------------
    {
      const media = await mkMedia("PUBLIC", "unused");
      const blocker = await findDeletionBlocker(media.id);
      record("TC-DB-MEDIA-004", "an unused media file has no deletion blocker", blocker === null, JSON.stringify(blocker));

      await db.media.delete({ where: { id: media.id } });
      const after = await db.media.findUnique({ where: { id: media.id } });
      record("TC-DB-MEDIA-004b", "an unused media file deletes successfully end to end", after === null, `after=${JSON.stringify(after)}`);
    }
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} passed`);
  return results;
}

main()
  .then((results) => {
    if (results.some((r) => !r.pass)) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  });
