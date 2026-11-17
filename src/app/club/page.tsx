import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MembershipRequest } from "@/components/club/membership-request";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";
import { logout } from "@/server/actions/auth";

export const metadata: Metadata = { title: "My clubs" };

export default async function ClubPortalPage({ searchParams }: PageProps<"/club">) {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login?callbackUrl=/club");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const where = { status: "ACTIVE" as const, ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { nameEn: { contains: q, mode: "insensitive" as const } }, { nameTa: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const pageHref = (next: number) => `/club?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) })}#explore-clubs`;
  const [clubs, total, memberships] = await Promise.all([
    db.club.findMany({ where, orderBy: { nameEn: "asc" }, skip: (page - 1) * 24, take: 24, select: { id: true, code: true, nameEn: true, nameTa: true, summaryEn: true } }),
    db.club.count({ where }),
    db.clubMembership.findMany({ where: { userId: user.id }, include: { club: { select: { id: true, code: true, nameEn: true, status: true, coordinatorId: true } } }, orderBy: { updatedAt: "desc" } }),
  ]);
  const membershipByClub = new Map(memberships.map((membership) => [membership.clubId, membership]));
  return <main className="mx-auto min-h-dvh max-w-6xl px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><Building2 className="size-5" /></span><div><p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Trustfolio</p><h1 className="text-2xl font-semibold">Club portal</h1></div></div><div className="flex items-center gap-4 text-sm"><span className="text-muted-foreground">{user.name ?? user.email}</span><Link href="/en" className="inline-flex items-center gap-1 text-brand hover:underline">Public site <ExternalLink className="size-3" /></Link><form action={logout}><button type="submit" className="text-muted-foreground hover:text-foreground">Sign out</button></form></div></header>
    <nav aria-label="Club portal" className="mt-5 flex gap-5 border-b pb-3 text-sm"><a href="#my-clubs" className="font-medium text-brand">My clubs</a><Link href="/club/projects" className="text-muted-foreground hover:text-foreground">Assigned projects</Link><a href="#explore-clubs" className="text-muted-foreground hover:text-foreground">Explore clubs</a></nav>
    <section id="my-clubs" className="mt-8"><h2 className="text-lg font-semibold">My clubs</h2><p className="mt-1 text-sm text-muted-foreground">Membership and coordinator access are shown separately.</p>{memberships.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">You have no club memberships yet. Explore active clubs below.</div> : <div className="mt-4 grid gap-4 md:grid-cols-2">{memberships.map((membership) => <article key={membership.id} className="rounded-2xl border bg-card p-5 shadow-soft"><div className="flex items-start justify-between gap-2"><div><p className="text-xs text-muted-foreground">{membership.club.code}</p><h3 className="mt-1 font-semibold">{membership.club.nameEn}</h3></div><Badge variant={membership.status === "ACTIVE" ? "success" : "outline"}>{membership.status}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{membership.role === "COORDINATOR" && membership.status === "ACTIVE" && membership.club.status === "ACTIVE" && membership.club.coordinatorId === user.id ? "Club coordinator" : "Membership record"}</p>{membership.role === "COORDINATOR" && membership.status === "ACTIVE" && membership.club.status === "ACTIVE" && membership.club.coordinatorId === user.id && <Link href={`/club/${membership.clubId}`} className="mt-4 inline-block text-sm font-medium text-brand underline">Open club workspace</Link>}</article>)}</div>}</section>
    <section id="explore-clubs" className="mt-10"><h2 className="text-lg font-semibold">Explore active clubs</h2><p className="mt-1 text-sm text-muted-foreground">Membership requires an adult declaration, data-use consent and trust-admin approval.</p><form method="get" className="mt-4 flex gap-2"><input name="q" aria-label="Search active clubs" placeholder="Search clubs" defaultValue={q} className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Search</button></form><p className="mt-2 text-xs text-muted-foreground">{total} matching clubs · page {page}</p>{clubs.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">There are no active clubs matching this search.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{clubs.map((club) => { const membership = membershipByClub.get(club.id); return <article key={club.id} className="rounded-2xl border bg-card p-5 shadow-soft"><p className="text-xs text-muted-foreground">{club.code}</p><h3 className="mt-1 font-semibold">{club.nameEn}</h3>{club.nameTa && <p lang="ta" className="mt-1 text-sm text-muted-foreground">{club.nameTa}</p>}{club.summaryEn && <p className="mt-3 text-sm text-muted-foreground">{club.summaryEn}</p>}{!membership || ["INVITED", "REJECTED", "ENDED"].includes(membership.status) ? <MembershipRequest clubId={club.id} /> : <p className="mt-4 text-sm text-muted-foreground">Your membership status: {membership.status.toLowerCase()}.</p>}</article>; })}</div>}<div className="mt-4 flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)} className="text-brand underline">Previous</Link> : <span />}{page * 24 < total && <Link href={pageHref(page + 1)} className="text-brand underline">Next</Link>}</div></section>
  </main>;
}
