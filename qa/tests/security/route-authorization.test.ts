/**
 * TC-API-* — route authorization matrix (QA priority 2, QA-TEST-003) and the club-document
 * storage-prefix check (QA priority 4, QA-API-001).
 *
 * The three IDOR-boundary routes named in the brief —
 *   GET  /api/club/documents/[id]/file        → getAdminUser() + requireClubCoordinator()
 *   GET  /api/task-evidence/[id]/file         → getAdminUser() + requireTaskReader()
 *   POST /api/project-tasks/[id]/evidence     → getAdminUser() + requireVolunteerTask()
 * all layer on top of `getAdminUser()` (src/server/auth-guard.ts), which calls NextAuth's
 * `auth()`. Every route handler file itself (`import "next/server"`, `import { auth } from
 * "@/auth"` transitively) could not be loaded directly in this environment:
 *   - a second `next dev` instance cannot start (it keys its single-instance lock off the project
 *     directory, not the port, and the developer's own `next dev` already holds it for this repo);
 *   - direct `require()` of the route file succeeds (see the harness note in
 *     `qa/tests/_harness/next-request-scope.cjs`) but invoking the handler needs a `NextRequest`
 *     with real `cookies()`/`headers()` wiring plus a signed session JWT cookie — materially more
 *     harness-building than the risk here justifies, given the actual decision logic lives one
 *     layer down.
 * `qa/tests/security/login-lockout.test.ts` already proves `auth()`'s own path (`signIn()` →
 * `authorize()`) executes for real against the QA database, so the gap this suite leaves is narrow
 * and stated plainly in the final report: the route handlers' own 401-when-anonymous branch (a
 * single `if (!actor) return 401` per route — see api-inventory.md) and the exact HTTP envelope
 * were not independently exercised here. What this suite DOES exercise directly, against the real
 * database, is the actual scope-check functions each route calls for the owner/non-owner/admin
 * split — the part of the boundary most likely to actually be wrong:
 *   - src/server/clubs/service.ts    : requireClubCoordinator()
 *   - src/server/projects/service.ts : requireVolunteerTask(), requireTaskReader()
 * plus the storage-key-prefix condition from the club-documents route itself (copied verbatim,
 * since it is three lines of route code, not a separate exported function).
 *
 * Run:
 *   node --require ./node_modules/tsx/dist/cjs/index.cjs \
 *        --require ./qa/tests/_harness/server-only-stub.cjs \
 *        ./qa/tests/security/route-authorization.test.ts
 */
export {};
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://qa:qa_throwaway@127.0.0.1:55432/trustfolio_qa";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "qa-selftest-secret-at-least-32-characters-long";

type Result = { id: string; title: string; pass: boolean; detail: string };

async function main() {
  const { db } = require("../../../src/lib/db.ts");
  const { requireClubCoordinator, ClubError } = require("../../../src/server/clubs/service.ts");
  const { requireVolunteerTask, requireTaskReader, ProjectOperationError } = require("../../../src/server/projects/service.ts");
  const { CLUB_DOCUMENT_STORAGE_PREFIX } = require("../../../src/lib/storage.ts");
  const { VOLUNTEER_CONSENT_VERSION } = require("../../../src/lib/validations/volunteer.ts");

  const results: Result[] = [];
  function record(id: string, title: string, pass: boolean, detail: string) {
    results.push({ id, title, pass, detail });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${id} — ${title} :: ${detail}`);
  }
  async function expectThrow(fn: () => Promise<unknown>, ErrorClass: any) {
    try {
      await fn();
      return { threw: false, error: null as any };
    } catch (e) {
      return { threw: true, error: e, isExpectedType: e instanceof ErrorClass };
    }
  }

  const suffix = randomUUID().slice(0, 8);
  const cleanup: Array<() => Promise<void>> = [];
  const mkUser = async (tag: string, role: "ADMIN" | "EDITOR" | "PORTAL_USER" = "PORTAL_USER") => {
    const row = await db.user.create({ data: { email: `qa-route-${tag}-${suffix}@example.test`, passwordHash: "test-only", role, name: `QA fixture ${tag}` } });
    cleanup.push(async () => db.user.delete({ where: { id: row.id } }).catch(() => undefined));
    return row;
  };
  // ClubMembership.user and .club are both onDelete: Restrict — a membership row left behind
  // silently blocks (not errors loudly; `cleanup` swallows failures) the user/club delete that
  // runs later in the same reversed teardown pass. Every membership MUST be pushed here.
  const mkMembership = async (data: Record<string, unknown>) => {
    const row = await db.clubMembership.create({ data });
    cleanup.push(async () => db.clubMembership.delete({ where: { id: row.id } }).catch(() => undefined));
    return row;
  };

  try {
    // ================================================================
    // Club-document coordinator scope: requireClubCoordinator()
    // ================================================================
    const club = await db.club.create({ data: { code: `QA-RT-${suffix}`, nameEn: "QA route fixture club", createdById: (await mkUser("club-creator")).id, status: "ACTIVE" } });
    cleanup.push(async () => db.club.delete({ where: { id: club.id } }).catch(() => undefined));

    const coordinator = await mkUser("coordinator");
    await db.club.update({ where: { id: club.id }, data: { coordinatorId: coordinator.id } });
    // Club.coordinator is onDelete: Restrict. This update ran after `coordinator`'s delete-cleanup
    // was already pushed, so without this, LIFO teardown would try to delete the coordinator user
    // while the club still points at them. Pushed here (after the coordinator push), it unsets the
    // reference first in the reversed teardown order.
    cleanup.push(async () => db.club.update({ where: { id: club.id }, data: { coordinatorId: null } }).catch(() => undefined));
    await mkMembership({ clubId: club.id, userId: coordinator.id, role: "COORDINATOR", status: "ACTIVE", consentAt: new Date(), consentVersion: "club-membership-v1", adultAttestedAt: new Date(), joinedAt: new Date() });

    const regularMember = await mkUser("regular-member");
    await mkMembership({ clubId: club.id, userId: regularMember.id, role: "MEMBER", status: "ACTIVE", consentAt: new Date(), consentVersion: "club-membership-v1", adultAttestedAt: new Date(), joinedAt: new Date() });

    const unrelatedUser = await mkUser("unrelated");

    {
      const membership = await requireClubCoordinator(coordinator.id, club.id);
      record("TC-API-CLUBDOC-001", "requireClubCoordinator() succeeds for the actual coordinator of an ACTIVE club", membership?.role === "COORDINATOR", JSON.stringify(membership));
    }
    {
      const r = await expectThrow(() => requireClubCoordinator(regularMember.id, club.id), ClubError);
      record("TC-API-CLUBDOC-002", "requireClubCoordinator() throws (404-equivalent) for a regular ACTIVE member of the same club who is not its coordinator", Boolean(r.threw && r.isExpectedType), JSON.stringify({ threw: r.threw, code: r.error?.code }));
    }
    {
      const r = await expectThrow(() => requireClubCoordinator(unrelatedUser.id, club.id), ClubError);
      record("TC-API-CLUBDOC-003", "requireClubCoordinator() throws (404-equivalent) for a user with no membership in the club at all", Boolean(r.threw && r.isExpectedType), JSON.stringify({ threw: r.threw, code: r.error?.code }));
    }

    // ================================================================
    // Club-document storage-prefix check — the exact three-line condition from
    // src/app/api/club/documents/[id]/file/route.ts:16, copied verbatim (QA-API-001's fix).
    // ================================================================
    function routeWouldServe(document: { archivedAt: Date | null; media: { visibility: string; storageKey: string } } | null): boolean {
      if (!document || document.archivedAt || document.media.visibility !== "PRIVATE" || !document.media.storageKey.startsWith(CLUB_DOCUMENT_STORAGE_PREFIX)) return false;
      return true;
    }

    const mediaGoodPrefix = await db.media.create({ data: { url: "internal", storageKey: `${CLUB_DOCUMENT_STORAGE_PREFIX}qa-${suffix}-good.pdf`, filename: "good.pdf", mimeType: "application/pdf", size: 10, visibility: "PRIVATE" } });
    cleanup.push(async () => db.media.delete({ where: { id: mediaGoodPrefix.id } }).catch(() => undefined));
    const docGood = await db.clubDocument.create({ data: { clubId: club.id, mediaId: mediaGoodPrefix.id, titleEn: "Good prefix doc", createdById: coordinator.id } });
    cleanup.push(async () => db.clubDocument.delete({ where: { id: docGood.id } }).catch(() => undefined));

    // Seeded directly (not through any app write path — QA-API-001 notes no action can repoint
    // ClubDocument.mediaId today) to prove the defensive check itself works if that ever changes.
    const mediaBadPrefix = await db.media.create({ data: { url: "internal", storageKey: `private/donation-evidence/qa-${suffix}-smuggled.pdf`, filename: "smuggled.pdf", mimeType: "application/pdf", size: 10, visibility: "PRIVATE" } });
    cleanup.push(async () => db.media.delete({ where: { id: mediaBadPrefix.id } }).catch(() => undefined));
    const docBadPrefix = await db.clubDocument.create({ data: { clubId: club.id, mediaId: mediaBadPrefix.id, titleEn: "Bad prefix doc", createdById: coordinator.id } });
    cleanup.push(async () => db.clubDocument.delete({ where: { id: docBadPrefix.id } }).catch(() => undefined));

    {
      const row = await db.clubDocument.findUnique({ where: { id: docBadPrefix.id }, include: { media: { select: { visibility: true, storageKey: true } } } });
      record(
        "TC-API-CLUBDOC-004",
        "a PRIVATE club-document media row whose storageKey lacks CLUB_DOCUMENT_STORAGE_PREFIX is refused (404-equivalent) by the route's own condition, even for an authorized coordinator",
        routeWouldServe(row as any) === false,
        `storageKey=${row?.media.storageKey}`,
      );
    }
    {
      const row = await db.clubDocument.findUnique({ where: { id: docGood.id }, include: { media: { select: { visibility: true, storageKey: true } } } });
      record(
        "TC-API-CLUBDOC-005",
        "control case: a PRIVATE club-document media row WITH the correct storage-key prefix passes the route's condition",
        routeWouldServe(row as any) === true,
        `storageKey=${row?.media.storageKey}`,
      );
    }

    // ================================================================
    // Task evidence scope: requireVolunteerTask() / requireTaskReader()
    // ================================================================
    const taskCoordinator = await mkUser("task-coordinator");
    const projectOwner = await mkUser("project-owner");
    const club2 = await db.club.create({ data: { code: `QA-RT2-${suffix}`, nameEn: "QA route fixture club 2", createdById: projectOwner.id, status: "ACTIVE" } });
    cleanup.push(async () => db.club.delete({ where: { id: club2.id } }).catch(() => undefined));

    const project = await db.project.create({ data: { slug: `qa-route-project-${suffix}`, titleEn: "QA route fixture project", summaryEn: "fixture", operationalStatus: "ACTIVE" } });
    cleanup.push(async () => db.project.delete({ where: { id: project.id } }).catch(() => undefined));

    const assignment = await db.projectClubAssignment.create({
      data: { projectId: project.id, clubId: club2.id, coordinatorId: taskCoordinator.id, responsibilities: "QA fixture", createdById: projectOwner.id, status: "ACTIVE", canViewTasks: true },
    });
    cleanup.push(async () => db.projectClubAssignment.delete({ where: { id: assignment.id } }).catch(() => undefined));
    await mkMembership({ clubId: club2.id, userId: taskCoordinator.id, role: "COORDINATOR", status: "ACTIVE", consentAt: new Date(), consentVersion: "club-membership-v1", adultAttestedAt: new Date(), joinedAt: new Date() });

    const task = await db.projectTask.create({ data: { projectId: project.id, clubAssignmentId: assignment.id, titleEn: "QA fixture task", createdById: projectOwner.id } });
    cleanup.push(async () => db.projectTask.delete({ where: { id: task.id } }).catch(() => undefined));

    const assignedVolunteer = await mkUser("assigned-volunteer");
    await mkMembership({ clubId: club2.id, userId: assignedVolunteer.id, role: "MEMBER", status: "ACTIVE", consentAt: new Date(), consentVersion: "club-membership-v1", adultAttestedAt: new Date(), joinedAt: new Date() });
    const assignedProfile = await db.volunteerProfile.create({ data: { userId: assignedVolunteer.id, consentVersion: VOLUNTEER_CONSENT_VERSION, consentAt: new Date(), adultAttestedAt: new Date() } });
    cleanup.push(async () => db.volunteerProfile.delete({ where: { id: assignedProfile.id } }).catch(() => undefined));
    const taskAssignment = await db.taskAssignment.create({ data: { taskId: task.id, profileId: assignedProfile.id, active: true } });
    cleanup.push(async () => db.taskAssignment.delete({ where: { id: taskAssignment.id } }).catch(() => undefined));

    const unassignedVolunteer = await mkUser("unassigned-volunteer");
    await mkMembership({ clubId: club2.id, userId: unassignedVolunteer.id, role: "MEMBER", status: "ACTIVE", consentAt: new Date(), consentVersion: "club-membership-v1", adultAttestedAt: new Date(), joinedAt: new Date() });
    const unassignedProfile = await db.volunteerProfile.create({ data: { userId: unassignedVolunteer.id, consentVersion: VOLUNTEER_CONSENT_VERSION, consentAt: new Date(), adultAttestedAt: new Date() } });
    cleanup.push(async () => db.volunteerProfile.delete({ where: { id: unassignedProfile.id } }).catch(() => undefined));

    {
      const row = await requireVolunteerTask(assignedVolunteer.id, task.id);
      record("TC-API-TASK-001", "requireVolunteerTask() succeeds for the actually assigned, consented, active-member volunteer", row?.id === task.id, JSON.stringify({ id: row?.id }));
    }
    {
      const r = await expectThrow(() => requireVolunteerTask(unassignedVolunteer.id, task.id), ProjectOperationError);
      record("TC-API-TASK-002", "requireVolunteerTask() throws (404-equivalent) for an active club member who is not assigned to the task", Boolean(r.threw && r.isExpectedType), JSON.stringify({ threw: r.threw, code: r.error?.code }));
    }
    {
      const row = await requireTaskReader({ id: "nonexistent-admin-id", role: "ADMIN" }, task.id);
      record("TC-API-TASK-003", "requireTaskReader() returns the task for an ADMIN actor regardless of assignment (ADMIN bypass)", row?.id === task.id, JSON.stringify({ id: row?.id }));
    }
    {
      const row = await requireTaskReader({ id: assignedVolunteer.id, role: "PORTAL_USER" }, task.id);
      record("TC-API-TASK-004", "requireTaskReader() succeeds for the assigned volunteer (non-admin) via the inner requireVolunteerTask() call", row?.id === task.id, JSON.stringify({ id: row?.id }));
    }
    {
      const r = await expectThrow(() => requireTaskReader({ id: unrelatedUser.id, role: "PORTAL_USER" }, task.id), ProjectOperationError);
      record("TC-API-TASK-005", "requireTaskReader() throws (404-equivalent) for an unrelated actor who is neither assigned nor the assignment's coordinator", r.threw, JSON.stringify({ threw: r.threw, code: r.error?.code }));
    }
    {
      const r = await expectThrow(() => requireTaskReader({ id: assignedVolunteer.id, role: "PORTAL_USER" }, "nonexistent-task-id"), ProjectOperationError);
      record("TC-API-TASK-006", "requireTaskReader() throws TASK_NOT_FOUND for a nonexistent task id", r.threw && r.error?.code === "TASK_NOT_FOUND", JSON.stringify({ threw: r.threw, code: r.error?.code }));
    }
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} passed`);
  return results;
}

main()
  .then((results) => {
    if (results.some((r) => !r.pass)) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  });
