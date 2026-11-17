import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DONATION_REQUEST_EVIDENCE_STORAGE_PREFIX, readPrivateFile } from "@/lib/storage";
import { requireAdmin } from "@/server/auth-guard";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin("ADMIN"); } catch { return new NextResponse("Unauthorized", { status: 401 }); }
  const { id } = await params;
  if (!id || id.length > 64) return new NextResponse("Not found", { status: 404 });
  const evidence = await db.donationRequestEvidence.findUnique({ where: { id }, include: { media: { select: { visibility: true, storageKey: true, mimeType: true, filename: true } } } });
  if (!evidence || evidence.archivedAt || evidence.media.visibility !== "PRIVATE" || !evidence.media.storageKey.startsWith(DONATION_REQUEST_EVIDENCE_STORAGE_PREFIX)) return new NextResponse("Not found", { status: 404 });
  const body = await readPrivateFile(evidence.media.storageKey);
  if (!body || (body instanceof Uint8Array && body.byteLength === 0)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body as BodyInit, { headers: { "Content-Type": evidence.media.mimeType, "Content-Disposition": `inline; filename="${encodeURIComponent(evidence.media.filename)}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
