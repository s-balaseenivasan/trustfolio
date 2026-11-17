import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VolunteerWorkspace } from "@/components/volunteer/workspace";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";
import { logout } from "@/server/actions/auth";

export const metadata: Metadata = { title: "My volunteering" };
export default async function VolunteerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login?callbackUrl=/volunteer");
  const query = await searchParams;
  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const [profile, memberships, approvedTotal] = await Promise.all([
    db.volunteerProfile.findUnique({ where: { userId: user.id }, include: { availability: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }, attendances: { include: { club: { select: { nameEn: true } }, history: { orderBy: { createdAt: "asc" } }, serviceLog: { include: { history: { orderBy: { createdAt: "asc" } } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }, _count: { select: { attendances: true } } } }),
    db.clubMembership.findMany({ where: { userId: user.id, status: "ACTIVE", club: { status: "ACTIVE" } }, select: { clubId: true, club: { select: { nameEn: true } } }, orderBy: { createdAt: "asc" } }),
    db.volunteerServiceLog.aggregate({ where: { profile: { userId: user.id }, status: "APPROVED", attendance: { status: "APPROVED" } }, _sum: { minutes: true } }),
  ]);
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Trustfolio</p><h1 className="text-2xl font-semibold">Volunteer portal</h1><p className="mt-1 text-sm text-muted-foreground">{user.name ?? user.email}</p></div><div className="flex gap-4 text-sm"><Link href="/club" className="text-brand underline">My clubs</Link><Link href="/en" className="text-brand underline">Public site</Link><form action={logout}><button className="text-muted-foreground underline">Sign out</button></form></div></header><nav aria-label="Volunteer sections" className="my-5 flex flex-wrap gap-4 text-sm"><a href="#profile" className="text-brand underline">Profile</a><a href="#availability" className="text-brand underline">Availability</a><a href="#attendance" className="text-brand underline">Attendance</a><a href="#hours" className="text-brand underline">Service hours</a></nav><VolunteerWorkspace profile={profile ? { about: profile.about, skills: profile.skills, interests: profile.interests, shareSkillsWithClubs: profile.shareSkillsWithClubs, consentVersion: profile.consentVersion, version: profile.version } : null} availability={profile?.availability ?? []} memberships={memberships.map((member) => ({ clubId: member.clubId, clubName: member.club.nameEn }))} attendances={profile?.attendances.map((row) => ({ id: row.id, clubName: row.club.nameEn, serviceDate: row.serviceDate.toISOString().slice(0, 10), activityTitle: row.activityTitle, status: row.status, serviceLog: row.serviceLog && { id: row.serviceLog.id, minutes: row.serviceLog.minutes, description: row.serviceLog.description, status: row.serviceLog.status, history: row.serviceLog.history.map((event) => ({ id: event.id, toStatus: event.toStatus, reason: event.reason, createdAt: event.createdAt.toISOString() })) }, history: row.history.map((event) => ({ id: event.id, toStatus: event.toStatus, reason: event.reason, createdAt: event.createdAt.toISOString() })) })) ?? []} approvedMinutes={approvedTotal._sum.minutes ?? 0} />{profile && <div className="mt-5 flex justify-between text-sm"><span>{profile._count.attendances} attendance records · page {page}</span><span className="flex gap-4">{page > 1 && <Link href={`/volunteer?page=${page - 1}#hours`} className="text-brand underline">Previous</Link>}{page * 30 < profile._count.attendances && <Link href={`/volunteer?page=${page + 1}#hours`} className="text-brand underline">Next</Link>}</span></div>}</main>;
}
