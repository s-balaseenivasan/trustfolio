import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { deleteStoredFile, isAllowedType, sniffMatches, storeFile } from "@/lib/storage";
import { getAdminUser } from "@/server/auth-guard";
import { createTaskEvidenceFromUpload, ProjectOperationError, requireVolunteerTask } from "@/server/projects/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const incoming = new URL(request.url);
    const submitted = new URL(origin ?? "");
    sameOrigin = submitted.host === request.headers.get("host") && submitted.protocol === incoming.protocol;
  } catch { /* Invalid Origin. */ }
  if (!sameOrigin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const actor = await getAdminUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (actor.role !== "ADMIN") {
    try { await requireVolunteerTask(actor.id, id); } catch { return NextResponse.json({ error: "Task not found" }, { status: 404 }); }
  }
  const limit = await rateLimit(`task-evidence-upload:${actor.id}`, { limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limit.success) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const title = z.string().trim().min(3).max(160).safeParse(form?.get("title"));
  const kind = z.enum(["ATTACHMENT", "COMPLETION"]).safeParse(form?.get("kind"));
  if (!title.success || !kind.success) return NextResponse.json({ error: "Enter a valid title and evidence type." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > env().UPLOAD_MAX_MB * 1024 * 1024) return NextResponse.json({ error: "File is too large." }, { status: 413 });
  if (!isAllowedType(file.type)) return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffMatches(file.type, head)) return NextResponse.json({ error: "File contents do not match its type." }, { status: 415 });
  let stored: Awaited<ReturnType<typeof storeFile>> | undefined;
  try {
    stored = await storeFile(file, "PRIVATE", "project-task-evidence");
    const evidence = await createTaskEvidenceFromUpload({ taskId: id, title: title.data, kind: kind.data, filename: file.name.slice(0, 200).replace(/[^\p{L}\p{N}._ -]/gu, "_"), mimeType: file.type, size: file.size, ...stored }, actor);
    revalidatePath(`/volunteer/tasks/${id}`);
    return NextResponse.json({ id: evidence.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (stored) await deleteStoredFile({ ...stored, visibility: "PRIVATE" });
    if (error instanceof ProjectOperationError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[project-tasks] evidence upload failed", error);
    return NextResponse.json({ error: "Could not save task evidence." }, { status: 500 });
  }
}
