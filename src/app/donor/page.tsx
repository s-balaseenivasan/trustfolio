import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatPaise } from "@/lib/validations/fundraising";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";
import { logout } from "@/server/actions/auth";

export const metadata: Metadata = { title: "My donations" };

export default async function DonorPortalPage() {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login?callbackUrl=/donor");
  const profile = await db.donorProfile.findUnique({ where: { userId: user.id }, include: { donations: { orderBy: { receivedAt: "desc" }, take: 100, select: { id: true, amountPaise: true, currency: true, method: true, status: true, receivedAt: true, project: { select: { titleEn: true } } } } } });
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Trustfolio</p><h1 className="text-2xl font-semibold">Donor portal</h1><p className="mt-1 text-sm text-muted-foreground">{user.name ?? user.email}</p></div><div className="flex gap-4 text-sm"><Link href="/en" className="text-brand underline">Public site</Link><form action={logout}><button className="text-muted-foreground underline">Sign out</button></form></div></header>
    <section className="mt-6 rounded-2xl border border-warning/40 bg-warning/5 p-5"><h2 className="font-semibold">Donations are not enabled yet</h2><p className="mt-1 text-sm">Campaigns are still private drafts. Online checkout, receipts, and confirmed collection totals are unavailable while finance and approval policies are being prepared.</p></section>
    {!profile ? <section className="mt-6 rounded-2xl border bg-card p-5"><h2 className="font-semibold">Donor access is not linked</h2><p className="mt-1 text-sm text-muted-foreground">A trust administrator must link this existing portal account before donation history can be shown.</p></section> : <section className="mt-6 overflow-hidden rounded-2xl border bg-card"><div className="border-b p-5"><h2 className="font-semibold">My donation history</h2><p className="mt-1 text-sm text-muted-foreground">Pending entries are private and are not receipts or confirmed contributions.</p></div>{profile.donations.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="px-5 py-3">Date</th><th className="px-5 py-3">Project</th><th className="px-5 py-3">Method</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody>{profile.donations.map((d) => <tr key={d.id} className="border-b last:border-0"><td className="px-5 py-3">{d.receivedAt.toISOString().slice(0, 10)}</td><td className="px-5 py-3">{d.project.titleEn}</td><td className="px-5 py-3">{d.method.replaceAll("_", " ")}</td><td className="px-5 py-3 text-right tabular-nums">{formatPaise(d.amountPaise)}</td><td className="px-5 py-3">Pending verification</td></tr>)}</tbody></table></div> : <p className="p-8 text-sm text-muted-foreground">No donation entries are linked to this account.</p>}</section>}
    <p className="mt-5 text-xs text-muted-foreground">Donor records are private. Anonymous display is the default; no donor name or amount is published.</p>
  </main>;
}
