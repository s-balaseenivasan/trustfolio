import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { deleteStoredFile, isAllowedType, sniffMatches, storeFile } from "@/lib/storage";
import { requireAdmin } from "@/server/auth-guard";
import { ClubError, createClubDocumentFromUpload } from "@/server/clubs/service";

export async function POST(request: NextRequest, { params }: RouteContext<"/api/admin/clubs/[id]/documents">) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && new URL(origin).host === request.headers.get("host")); } catch { /* Invalid Origin header. */ }
  if (!sameOrigin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  let actor;
  try { actor = await requireAdmin("ADMIN"); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Club not found" }, { status: 404 });
  const limit = await rateLimit(`club-document-upload:${actor.id}`, { limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limit.success) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  const club = await db.club.findUnique({ where: { id }, select: { status: true } });
  if (!club || !["DRAFT", "ACTIVE"].includes(club.status)) return NextResponse.json({ error: "Club unavailable" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const titleEn = z.string().trim().min(3).max(160).safeParse(form?.get("titleEn"));
  const titleTa = z.string().trim().max(160).safeParse(form?.get("titleTa") ?? "");
  if (!titleEn.success || !titleTa.success) return NextResponse.json({ error: "Enter a valid document title." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > env().UPLOAD_MAX_MB * 1024 * 1024) return NextResponse.json({ error: "File is too large." }, { status: 413 });
  if (!isAllowedType(file.type)) return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffMatches(file.type, head)) return NextResponse.json({ error: "File contents do not match its type." }, { status: 415 });
  const stored = await storeFile(file, "PRIVATE", "club-documents");
  try {
    const document = await createClubDocumentFromUpload({ clubId: id, titleEn: titleEn.data, titleTa: titleTa.data, filename: file.name.slice(0, 200).replace(/[^\p{L}\p{N}._ -]/gu, "_"), mimeType: file.type, size: file.size, ...stored }, actor.id);
    revalidatePath(`/admin/clubs/${id}`);
    return NextResponse.json({ id: document.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await deleteStoredFile({ ...stored, visibility: "PRIVATE" });
    if (error instanceof ClubError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[clubs] private upload failed", error);
    return NextResponse.json({ error: "Could not save the club document." }, { status: 500 });
  }
}
