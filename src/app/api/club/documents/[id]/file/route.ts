import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CLUB_DOCUMENT_STORAGE_PREFIX, readPrivateFile } from "@/lib/storage";
import { getAdminUser } from "@/server/auth-guard";
import { requireClubCoordinator } from "@/server/clubs/service";

export async function GET(_request: Request, { params }: RouteContext<"/api/club/documents/[id]/file">) {
  const actor = await getAdminUser();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (id.length > 64) return new NextResponse("Not found", { status: 404 });
  const document = await db.clubDocument.findUnique({ where: { id }, include: { media: { select: { visibility: true, storageKey: true, mimeType: true, filename: true } } } });
  // The storage-key prefix check matches the three sibling private-file routes: it confirms the
  // media was created through the club-document upload path, so a PRIVATE file from any other
  // flow cannot be served here even if its id were reachable.
  if (!document || document.archivedAt || document.media.visibility !== "PRIVATE" || !document.media.storageKey.startsWith(CLUB_DOCUMENT_STORAGE_PREFIX)) return new NextResponse("Not found", { status: 404 });
  if (actor.role !== "ADMIN") {
    try { await requireClubCoordinator(actor.id, document.clubId); } catch { return new NextResponse("Not found", { status: 404 }); }
  }
  const body = await readPrivateFile(document.media.storageKey);
  if (!body || (body instanceof Uint8Array && body.byteLength === 0)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body as BodyInit, { headers: { "Content-Type": document.media.mimeType, "Content-Disposition": `inline; filename="${encodeURIComponent(document.media.filename)}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
