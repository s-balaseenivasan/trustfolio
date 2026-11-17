import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { deleteStoredFile, isAllowedType, sniffMatches, storeFile } from "@/lib/storage";
import { requireAdmin } from "@/server/auth-guard";
import { createDonationEvidenceFromUpload, DonationError } from "@/server/donations/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let sameOrigin = false;
  try { const origin = new URL(request.headers.get("origin") ?? ""); sameOrigin = origin.host === request.headers.get("host") && origin.protocol === new URL(request.url).protocol; } catch { /* Invalid origin. */ }
  if (!sameOrigin) return NextResponse.json({ error: "Invalid origin", code: "INVALID_ORIGIN" }, { status: 403 });
  let actor;
  try { actor = await requireAdmin("ADMIN"); } catch { return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }); }
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Donation not found", code: "NOT_FOUND" }, { status: 404 });
  const rate = await rateLimit(`donation-evidence:${actor.id}`, { limit: 40, windowMs: 60 * 60 * 1000 });
  if (!rate.success) return NextResponse.json({ error: "Upload limit reached. Try again later.", code: "RATE_LIMITED" }, { status: 429 });
  const record = await db.donation.findUnique({ where: { id }, select: { status: true } });
  if (record?.status !== "PENDING_VERIFICATION") return NextResponse.json({ error: "Donation unavailable", code: "DONATION_UNAVAILABLE" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const title = z.string().trim().min(3).max(160).safeParse(form?.get("title"));
  if (!title.success) return NextResponse.json({ error: "Enter an evidence title.", code: "VALIDATION_ERROR" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file.", code: "VALIDATION_ERROR" }, { status: 400 });
  if (file.size > env().UPLOAD_MAX_MB * 1024 * 1024) return NextResponse.json({ error: "File is too large.", code: "FILE_TOO_LARGE" }, { status: 413 });
  if (!isAllowedType(file.type)) return NextResponse.json({ error: "Unsupported file type.", code: "UNSUPPORTED_TYPE" }, { status: 415 });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffMatches(file.type, head)) return NextResponse.json({ error: "File contents do not match its type.", code: "SIGNATURE_MISMATCH" }, { status: 415 });
  let stored: Awaited<ReturnType<typeof storeFile>> | undefined;
  try {
    stored = await storeFile(file, "PRIVATE", "donation-evidence");
    const evidence = await createDonationEvidenceFromUpload({ donationId: id, title: title.data, filename: file.name.slice(0, 200).replace(/[^\p{L}\p{N}._ -]/gu, "_"), mimeType: file.type, size: file.size, ...stored }, actor.id);
    revalidatePath("/admin/donations");
    return NextResponse.json({ id: evidence.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (stored) await deleteStoredFile({ ...stored, visibility: "PRIVATE" });
    if (error instanceof DonationError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    console.error("[donations] evidence upload failed", error);
    return NextResponse.json({ error: "Could not save private donation evidence.", code: "UPLOAD_FAILED" }, { status: 500 });
  }
}
