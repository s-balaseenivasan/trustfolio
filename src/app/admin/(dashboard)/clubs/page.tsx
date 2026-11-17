import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CreateClubForm } from "@/components/admin/club-management";
import { DataCard, PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Clubs" };

export default async function ClubsPage({ searchParams }: PageProps<"/admin/clubs">) {
  await requireAdminPage("ADMIN");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const status = typeof query.status === "string" && ["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"].includes(query.status) ? query.status as "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED" : undefined;
  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const pageHref = (next: number) => `/admin/clubs?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(next) })}`;
  const where = { ...(status ? { status } : {}), ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { nameEn: { contains: q, mode: "insensitive" as const } }, { nameTa: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [clubs, total] = await Promise.all([
    db.club.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, select: { id: true, code: true, nameEn: true, nameTa: true, status: true, publicationStatus: true, coordinator: { select: { name: true, email: true } }, _count: { select: { memberships: true, documents: true } } } }),
    db.club.count({ where }),
  ]);
  return <>
    <PageHeader title="Clubs" description="Manage club profiles, approved members and private records. Club publication remains separate." />
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(25rem,1fr)]">
      <div className="space-y-4">
        <form method="get" className="flex flex-wrap gap-2"><input name="q" aria-label="Search clubs" placeholder="Search name or code" defaultValue={q} className="min-w-44 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><select name="status" aria-label="Filter status" defaultValue={status ?? ""} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">All statuses</option>{["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"].map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" type="submit">Filter</button></form>
        <p className="text-xs text-muted-foreground">Showing page {page} · {total} matching clubs.</p>
        <DataCard>{clubs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No clubs match this filter.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Clubs</caption><thead className="border-b bg-muted/40 text-left"><tr><th scope="col" className="px-4 py-3">Club</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Members</th><th scope="col" className="px-4 py-3">Coordinator</th></tr></thead><tbody className="divide-y">{clubs.map((club) => <tr key={club.id}><td className="px-4 py-3"><Link href={`/admin/clubs/${club.id}`} className="font-medium text-brand hover:underline">{club.nameEn}</Link><span className="block text-xs text-muted-foreground">{club.code}{club.nameTa ? ` · ${club.nameTa}` : ""}</span></td><td className="px-4 py-3"><Badge variant={club.status === "ACTIVE" ? "success" : club.status === "SUSPENDED" ? "warning" : "outline"}>{club.status}</Badge></td><td className="px-4 py-3 tabular-nums">{club._count.memberships}</td><td className="px-4 py-3">{club.coordinator?.name ?? club.coordinator?.email ?? "—"}</td></tr>)}</tbody></table></div>}</DataCard>
        <div className="flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)} className="text-brand underline">Previous</Link> : <span />}{page * 50 < total && <Link href={pageHref(page + 1)} className="text-brand underline">Next</Link>}</div>
      </div>
      <CreateClubForm />
    </div>
  </>;
}
