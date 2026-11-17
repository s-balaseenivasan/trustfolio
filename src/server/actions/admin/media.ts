"use server";

import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { CACHE_TAGS } from "@/lib/constants";
import { deleteStoredFile, isOperationalPrivateMedia } from "@/lib/storage";
import { idSchema } from "@/lib/validations/common";
import { albumSchema, mediaMetaSchema, newsSchema } from "@/lib/validations/admin";
import { adminMutation, expire, logActivity, parseForm, publishedAtFor } from "@/server/actions/admin-helpers";

const MEDIA_TAGS = [
  CACHE_TAGS.media,
  CACHE_TAGS.trust,
  CACHE_TAGS.trustees,
  CACHE_TAGS.projects,
  CACHE_TAGS.activities,
  CACHE_TAGS.gallery,
  CACHE_TAGS.news,
  CACHE_TAGS.stories,
  CACHE_TAGS.documents,
  CACHE_TAGS.verification,
  CACHE_TAGS.impact,
  CACHE_TAGS.certificates,
  CACHE_TAGS.reports,
  CACHE_TAGS.history,
  CACHE_TAGS.testimonials,
] as const;

export async function updateMediaMeta(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(mediaMetaSchema, formData);
  if (!parsed.ok) return parsed.state;
  return adminMutation(
    async (user) => {
      const source = await db.media.findUnique({ where: { id: idSchema.parse(id) }, select: { storageKey: true } });
      if (source && isOperationalPrivateMedia(source.storageKey) && user.role !== "ADMIN") return { status: "error", message: "This operational file is restricted to trust administration." };
      const media = await db.media.update({ where: { id: idSchema.parse(id) }, data: parsed.data });
      await logActivity(user, "UPDATE", "Media", id, `Updated details of ${media.filename}`);
      expire(...MEDIA_TAGS);
      return { status: "success", message: "Media details saved" };
    },
    { values: parsed.values },
  );
}

/**
 * Returns an actionable message when a file cannot safely be deleted, or null when it can.
 *
 * Ordered so the hard blockers (Restrict relations, which would otherwise surface as a raw
 * database error) are reported before the published-content blockers.
 */
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

  // GalleryImage cascades: deleting the file removes the photo from its album with no other signal.
  const galleryUses = await db.galleryImage.count({ where: { mediaId } });
  if (galleryUses) {
    const publishedAlbums = await db.galleryImage.count({
      where: { mediaId, album: { status: "PUBLISHED" } },
    });
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
    publishedDocuments + publishedProjects + publishedActivities + publishedNews +
    publishedStories + publishedAlbumCovers + trustUses + trusteeUses;
  if (publishedUses) {
    return `This file is used by ${publishedUses} published item${publishedUses === 1 ? "" : "s"}. Unpublish or replace them first.`;
  }

  return null;
}

/**
 * Deletes the record and the stored file.
 *
 * Nullable references are cleared by the schema, but two groups must be checked first:
 *  - operational evidence tables declare `onDelete: Restrict`, so the delete would fail with a raw
 *    P2003 and a generic error rather than a message the admin can act on;
 *  - `GalleryImage` declares `onDelete: Cascade`, so deleting the file silently removes the photo
 *    from its album — including a published one.
 * Published content that references the file through a SetNull relation is also blocked, because
 * nulling it blanks an image on a live public page while reporting success.
 */
export async function deleteMedia(id: string): Promise<ActionState> {
  return adminMutation(async (user) => {
    const mediaId = idSchema.parse(id);
    const source = await db.media.findUnique({ where: { id: mediaId }, select: { storageKey: true } });
    if (source && isOperationalPrivateMedia(source.storageKey) && user.role !== "ADMIN") return { status: "error", message: "This operational file is restricted to trust administration." };

    const blocker = await findDeletionBlocker(mediaId);
    if (blocker) return { status: "error", message: blocker };

    const media = await db.media.delete({ where: { id: mediaId } });
    await deleteStoredFile(media);
    await logActivity(user, "DELETE", "Media", id, `Deleted ${media.filename}`);
    expire(...MEDIA_TAGS);
    return { status: "success", message: "File deleted" };
  });
}

export async function saveAlbum(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(albumSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { imageIds, ...data } = parsed.data;
  return adminMutation(
    async (user) => {
      // Albums are public by nature: only public images may be added.
      const privateCount = await db.media.count({ where: { id: { in: imageIds }, visibility: "PRIVATE" } });
      if (privateCount) return { status: "error", fieldErrors: { imageIds: ["Private files cannot be added to a public album"] }, values: parsed.values };

      const existing = id ? await db.galleryAlbum.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const payload = { ...data, publishedAt: publishedAtFor(data.status, existing?.publishedAt) };
      const row = await db.$transaction(async (tx) => {
        const album = id ? await tx.galleryAlbum.update({ where: { id }, data: payload }) : await tx.galleryAlbum.create({ data: payload });
        await tx.galleryImage.deleteMany({ where: { albumId: album.id } });
        await tx.galleryImage.createMany({ data: imageIds.map((mediaId, sortOrder) => ({ albumId: album.id, mediaId, sortOrder })) });
        return album;
      });
      await logActivity(user, id ? "UPDATE" : "CREATE", "GalleryAlbum", row.id, `${id ? "Updated" : "Created"} album “${row.titleEn}” (${imageIds.length} photos)`);
      expire(CACHE_TAGS.gallery, CACHE_TAGS.projects, CACHE_TAGS.activities, CACHE_TAGS.stories);
      return { status: "success", message: "Album saved", id: row.id };
    },
    { values: parsed.values },
  );
}

export async function saveNews(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(newsSchema, formData);
  if (!parsed.ok) return parsed.state;
  return adminMutation(
    async (user) => {
      const existing = id ? await db.newsPost.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const data = { ...parsed.data, publishedAt: publishedAtFor(parsed.data.status, existing?.publishedAt) };
      const row = id ? await db.newsPost.update({ where: { id }, data }) : await db.newsPost.create({ data });
      await logActivity(user, id ? "UPDATE" : "CREATE", "NewsPost", row.id, `${id ? "Updated" : "Created"} ${row.kind === "EVENT" ? "event" : "post"} “${row.titleEn}”`);
      expire(CACHE_TAGS.news);
      return { status: "success", message: "Post saved", id: row.id };
    },
    { values: parsed.values },
  );
}
