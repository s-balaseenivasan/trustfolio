"use server";

import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { CACHE_TAGS } from "@/lib/constants";
import { isOperationalPrivateMedia } from "@/lib/storage";
import { idSchema } from "@/lib/validations/common";
import { certificateSchema, documentSchema, reportSchema, verificationSchema } from "@/lib/validations/admin";
import { adminMutation, expire, logActivity, parseForm, publishedAtFor } from "@/server/actions/admin-helpers";
import { PUBLIC_DOCUMENT_WHERE } from "@/server/queries/public/shared";

export async function saveDocument(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(documentSchema, formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;
  return adminMutation(
    async (user) => {
      // The public file slot must never hold private media, and vice versa.
      const [publicFile, original] = await Promise.all([
        data.fileId ? db.media.findUnique({ where: { id: data.fileId }, select: { visibility: true } }) : null,
        data.originalFileId ? db.media.findUnique({ where: { id: data.originalFileId }, select: { visibility: true, storageKey: true } }) : null,
      ]);
      if (publicFile && publicFile.visibility !== "PUBLIC") {
        return { status: "error", fieldErrors: { fileId: ["The public file must be a public upload"] }, values: parsed.values };
      }
      if (original && original.visibility !== "PRIVATE") {
        return { status: "error", fieldErrors: { originalFileId: ["Originals must be uploaded as private files"] }, values: parsed.values };
      }
      if (original && isOperationalPrivateMedia(original.storageKey)) {
        return { status: "error", fieldErrors: { originalFileId: ["Operational files cannot be used as trust document originals"] }, values: parsed.values };
      }
      const existing = id ? await db.document.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const payload = { ...data, publishedAt: publishedAtFor(data.status, existing?.publishedAt) };
      const row = id ? await db.document.update({ where: { id }, data: payload }) : await db.document.create({ data: payload });
      await logActivity(user, id ? "UPDATE" : "CREATE", "Document", row.id, `${id ? "Updated" : "Added"} document “${row.titleEn}”`);
      expire(CACHE_TAGS.documents, CACHE_TAGS.trust, CACHE_TAGS.projects, CACHE_TAGS.activities, CACHE_TAGS.reports, CACHE_TAGS.verification);
      return { status: "success", message: "Document saved", id: row.id };
    },
    { values: parsed.values },
  );
}

export async function saveReport(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(reportSchema, formData);
  if (!parsed.ok) return parsed.state;
  return adminMutation(
    async (user) => {
      const existing = id ? await db.annualReport.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const data = { ...parsed.data, publishedAt: publishedAtFor(parsed.data.status, existing?.publishedAt) };
      const row = id ? await db.annualReport.update({ where: { id }, data }) : await db.annualReport.create({ data });
      await logActivity(user, id ? "UPDATE" : "CREATE", "AnnualReport", row.id, `${id ? "Updated" : "Added"} annual report ${row.periodLabel}`);
      expire(CACHE_TAGS.reports, CACHE_TAGS.impact);
      return { status: "success", message: "Report saved", id: row.id };
    },
    { values: parsed.values },
  );
}

export async function saveCertificate(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(certificateSchema, formData);
  if (!parsed.ok) return parsed.state;
  return adminMutation(
    async (user) => {
      const existing = id ? await db.certificate.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const data = { ...parsed.data, publishedAt: publishedAtFor(parsed.data.status, existing?.publishedAt) };
      const row = id ? await db.certificate.update({ where: { id }, data }) : await db.certificate.create({ data });
      await logActivity(user, id ? "UPDATE" : "CREATE", "Certificate", row.id, `${id ? "Updated" : "Added"} “${row.titleEn}”`);
      expire(CACHE_TAGS.certificates);
      return { status: "success", message: "Certificate saved", id: row.id };
    },
    { values: parsed.values },
  );
}

export async function saveVerificationRecord(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(verificationSchema, formData);
  if (!parsed.ok) return parsed.state;
  return adminMutation(
    async (user) => {
      if (parsed.data.status === "PUBLISHED" && parsed.data.documentId && !parsed.data.externalUrl) {
        const source = await db.document.count({ where: { id: parsed.data.documentId, ...PUBLIC_DOCUMENT_WHERE } });
        if (!source) return { status: "error", fieldErrors: { documentId: ["Choose a published document with a public file, or add an external source"] }, values: parsed.values };
      }
      const existing = id ? await db.verificationRecord.findUniqueOrThrow({ where: { id: idSchema.parse(id) }, select: { publishedAt: true } }) : null;
      const data = { ...parsed.data, publishedAt: publishedAtFor(parsed.data.status, existing?.publishedAt) };
      const row = id ? await db.verificationRecord.update({ where: { id }, data }) : await db.verificationRecord.create({ data });
      await logActivity(user, id ? "UPDATE" : "CREATE", "VerificationRecord", row.id, `${id ? "Updated" : "Added"} verification record “${row.titleEn}”`);
      expire(CACHE_TAGS.verification, CACHE_TAGS.projects);
      return { status: "success", message: "Verification record saved", id: row.id };
    },
    { values: parsed.values },
  );
}
