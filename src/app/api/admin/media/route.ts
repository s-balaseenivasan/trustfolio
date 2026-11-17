import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { OPERATIONAL_PRIVATE_STORAGE_PREFIXES } from "@/lib/storage";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/server/auth-guard";
import { toAdminMedia } from "@/server/queries/admin-media";

/** Media library listing for the admin picker (auth required). */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind");
  const visibility = params.get("visibility");
  const q = params.get("q")?.trim().slice(0, 100);
  const page = Math.max(0, Number(params.get("page")) || 0);

  const where: Prisma.MediaWhereInput = {
    ...(actor.role === "ADMIN" ? {} : { AND: OPERATIONAL_PRIVATE_STORAGE_PREFIXES.map((prefix) => ({ storageKey: { not: { startsWith: prefix } } })) }),
    ...(kind === "image" ? { mimeType: { startsWith: "image/" } } : kind === "document" ? { mimeType: "application/pdf" } : {}),
    ...(visibility === "PUBLIC" || visibility === "PRIVATE" ? { visibility } : {}),
    ...(q
      ? {
          OR: [
            { filename: { contains: q, mode: "insensitive" } },
            { altEn: { contains: q, mode: "insensitive" } },
            { altTa: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.media.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * 48, take: 48 }),
    db.media.count({ where }),
  ]);
  return NextResponse.json({ items: items.map(toAdminMedia), total, page });
}
