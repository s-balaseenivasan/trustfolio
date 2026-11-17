# Trustfolio — Cross-Module Dependency Matrix

Phase 6 output. One row per **directed** dependency that at least one of the six traced workflows
crosses. "Module" means a business capability, not a folder. Every row names the triggering event,
the shared data, the expected behaviour and — the column that matters for regression selection —
**what breaks if the target changes or fails**.

Static analysis only; no dependency below was exercised. Companion artefacts:
`qa/workflows/knowledge-graph.json` (machine-readable, with `consumed_by` edges for reachability)
and `qa/workflows/workflow-diagrams.md` §7 (the same graph, drawn).

---

## 1. Matrix

| # | Source module | Target module | Shared data | Triggering event | Expected behaviour | Failure consequence |
|---|---|---|---|---|---|---|
| 1 | Edge proxy (`src/proxy.ts:13`) | Authentication | session cookie **name only** | any request to `/admin/*` | redirect to `/admin/login?callbackUrl=…` when no cookie is present; never an authorization decision | None security-relevant — the layout guard is the real gate (`(dashboard)/layout.tsx:14`). If the cookie names drift (`proxy.ts:4`) every admin user is redirected to login while already signed in, or the fast path is skipped |
| 2 | Authentication (`src/auth.ts:29`) | Rate limiting (`src/lib/rate-limit.ts:17`) | hashed `ip:email` key in `RateLimit` | every login attempt | 5 attempts per 15 minutes; a tripped limiter returns `null` **before** any DB read | `RateLimit` table or its PK removed → `ON CONFLICT ("key")` fails → every login throws, total outage. Limiter silently no-op'ing → unlimited brute force (QA-AUTH-001 already narrows the budget per source) |
| 3 | Every guarded surface | Authentication (`src/server/auth-guard.ts:22`) | `User.id`, `User.role` | every request to `/admin*`, every server action, every API route, every portal page | the row is re-read per request, so deletion or demotion takes effect immediately (REQ-SEC-026) | A change that caches the role or trusts the JWT claim converts role revocation into an 8-hour window (`src/auth.config.ts:15`). This is the highest-fan-out edge in the application — 12 API routes and 79 action entry points |
| 4 | Club membership (`src/server/clubs/service.ts:129`) | Clubs | `Club.status` | membership request, approval, coordinator appointment | requests and approvals require `Club.status === "ACTIVE"` | Suspending a club blocks new requests and approvals (`:134`, `:151`) and immediately closes `/club/[id]` for its coordinator (`:208`). Archiving is terminal (`:68`) and strands existing memberships |
| 5 | **Volunteering** (`src/server/volunteers/service.ts:64`) | **Club membership** | `ClubMembership.status`, `Club.status` | attendance submit, service-log submit | an `ACTIVE` membership of an `ACTIVE` club is required at submit time (REQ-VOL-037) | Suspending or ending a membership stops **new** submissions but leaves already-approved hours in the confirmed total — intentional (history is immutable) but it means the total is not a current-membership statement |
| 6 | **Project operations** (`src/server/projects/service.ts:154`) | **Club membership** | `ClubMembership.status` | volunteer assigned to a task | the target must be an `ACTIVE` member of the assignment's club | Combined with row 7, membership is the single revocation lever for all portal access. Ending a membership silently removes task access with **no notification and no UI explanation** — the task simply disappears from `/volunteer/tasks` (`volunteer/tasks/page.tsx:15`) |
| 7 | **Project operations** (`src/server/projects/service.ts:199`) | **Volunteering** | `VolunteerProfile.consentVersion` | every task read, write and evidence upload | the assigned volunteer's profile must be at the **current** `VOLUNTEER_CONSENT_VERSION` | **Bumping `VOLUNTEER_CONSENT_VERSION` (`src/lib/validations/volunteer.ts:3`) instantly revokes every volunteer's task access** until each re-consents. Four call sites depend on it (`projects/service.ts:153,199,218`, `volunteers/service.ts:63`). No migration or re-consent prompt flow exists for this; the user sees a 404 on a task they held yesterday |
| 8 | Club portal (`src/server/projects/service.ts:84`) | Club membership | `ClubMembership.status` | coordinator opens a project assignment | assignment coordinator must still be an `ACTIVE` member | Loses project visibility immediately; `/club/[id]`'s assignment list filters on the same conditions (`club/[id]/page.tsx:17`) so the link disappears rather than 404-ing |
| 9 | Club documents (`src/app/api/admin/clubs/[id]/documents/route.ts:35`) | File storage (`src/lib/storage.ts:61`) | `Media.storageKey` under `private/club-documents/` | ADMIN uploads a club document | bytes first, then `Media` + `ClubDocument` in one transaction; `deleteStoredFile` on failure | Storage unavailable → 500 with no DB row, no orphan. The namespace prefix is re-asserted in the service (`clubs/service.ts:86`), so a driver change that alters key shape breaks uploads loudly rather than silently mis-filing |
| 10 | Club document read (`src/app/api/club/documents/[id]/file/route.ts:15`) | Club membership | `ClubMembership`, `Club.coordinatorId` | coordinator clicks "View" | `requireClubCoordinator` or an ADMIN bypass; 404 on failure | This route is one of the three IDOR boundaries. It omits the storage-key-prefix check its three siblings perform (QA-API-001) — unreachable today only because no mutation can repoint `ClubDocument.mediaId` |
| 11 | Task evidence upload (`src/app/api/project-tasks/[id]/evidence/route.ts:40`) | File storage | `Media.storageKey` under `private/project-task-evidence/` | volunteer or ADMIN uploads evidence | bytes first, row second, compensating delete on failure | Correct. **But** the service's status window (`TODO`\|`IN_PROGRESS`, `projects/service.ts:267`) is narrower than the admin UI's gate (`!closed`, `project-operations.tsx:58`) — QA-FLOW-001 |
| 12 | Task evidence read (`src/app/api/task-evidence/[id]/file/route.ts:14`) | Project operations + Club membership | `TaskAssignment`, `ProjectClubAssignment`, `ClubMembership` | anyone opens an evidence link | `requireTaskReader`: ADMIN, else assigned volunteer, else viewing coordinator | The widest authorization surface in the app (three acceptable actor shapes) and it has **zero automated coverage** (QA-TEST-003). A regression here leaks private evidence between clubs |
| 13 | Generic media upload (`src/app/api/admin/upload/route.ts:53`) | File storage | `Media.storageKey` with **no** namespace | ADMIN or EDITOR uploads via the media library | bytes, then `Media`, then `ActivityLog`, then `revalidateTag(media)` | **No compensating delete** (QA-DB-003): a DB failure leaves bytes no UI can reach. The missing namespace is load-bearing in the other direction — it is what makes a PRIVATE generic upload eligible as a document original (`evidence.ts:29` rejects operational-private keys) |
| 14 | Documents & publication (`src/server/actions/admin/evidence.ts:23`) | Media | `Media.visibility`, `Media.storageKey` | admin saves a document | public slot must be `PUBLIC`, original slot `PRIVATE` and non-operational (REQ-DOC-002/003, REQ-MEDIA-007) | A change to `isOperationalPrivateMedia` (`src/lib/storage.ts:32`) or to the four prefix constants (`:27-30`) simultaneously affects this validation, the media list filter (`api/admin/media/route.ts:23`), the file read guard (`media/[id]/file/route.ts:19`), `updateMediaMeta` (`media.ts:35`) and `deleteMedia` (`media.ts:50`) — **five call sites, one constant** |
| 15 | Media deletion (`src/server/actions/admin/media.ts:51`) | Documents & publication | `Document.fileId`, `status`, `visibility` | admin deletes a file | refuse while a `PUBLISHED`+`PUBLIC` document depends on it (REQ-DOC-005) | Guards 1 of 21 inbound `Media` relations. 4 `Restrict` relations surface an unmapped `P2003` (QA-DB-001); `GalleryImage` cascades silently (QA-DB-001); **15 `SetNull` relations break a live published page silently (QA-FLOW-002)** |
| 16 | Every admin mutation (`src/server/actions/admin-helpers.ts:71`) | Activity log | `ActivityLog` rows | any admin write | append an attributed, 300-char summary | `logActivity` swallows its own failures (`:80`), so audit loss is silent by design. `ActivityLog.userId` is `SetNull` and **unindexed** (QA-DB-005): attribution survives user deletion, "activity by this user" is a full scan |
| 17 | Every admin mutation (`admin-helpers.ts:87`) | Public cache | `CACHE_TAGS` | any admin write | `updateTag` per tag + `refresh()` | A missing tag in a module's `expire(...)` list leaves stale public content with no error anywhere. `deleteMedia` expires 15 tags (`media.ts:11-27`), `saveDocument` 6 (`evidence.ts:36`) — the completeness of each list was spot-checked only (`qa/discovery/requirements-inventory.md:153`) |
| 18 | Donations (`src/server/donations/service.ts:20`) | Authentication / Users | `User.role === "PORTAL_USER"` | admin links a donor | only an existing portal account may be linked (REQ-DON-043); re-checked at every intake (`:45`) | Promoting a donor's account to `EDITOR` silently blocks all future intake for them (`:45`) while leaving existing rows intact. No UI surfaces the reason beyond "Choose an existing portal donor profile" |
| 19 | Donations (`src/server/donations/service.ts:46`) | Public content (Projects) | `Project.status`, `Project.isDemo` | manual intake | the project must be `PUBLISHED` and non-demo | Unpublishing a project blocks **new** intake but leaves existing donations pointing at an invisible project; `/donor` still renders `project.titleEn` (`donor/page.tsx:18`) for an unpublished project — a private read of public-content data, consistent with REQ-DON-045 but worth a test |
| 20 | Donations (`src/server/donations/service.ts:49`) | Fundraising | `DonationCampaign.request.projectId` | intake with a `campaignId` | the campaign must belong to the chosen project | Unreachable today: no campaign can leave `DRAFT`, and the UI hardcodes `campaignId=""` (QA-UI-004). The validation is correct and dormant |
| 21 | Fundraising (`src/server/fundraising/service.ts:67`) | Approval foundation | `ApprovalPolicy` | any attempt to submit a request or release a campaign | throw `APPROVAL_POLICY_INACTIVE` / `PUBLIC_RELEASE_INACTIVE` unconditionally (REQ-APPR-046) | Intentionally inert. Making it conditional opens an entire untested workflow — `src/lib/approval/definition.test.ts` is the only coverage and it tests definitions, not the live path |
| 22 | Clubs / Volunteering / Projects / Approvals | Notifications (`NotificationOutbox`) | outbox rows written inside the business transaction | every decision event | a row is recorded transactionally with the business write | **No consumer exists.** Rows accumulate; the only reader is a 10-row display list (`approvals/page.tsx:20`). Adding a sender must not retry the financial mutation (REQ-NOTIF-047, currently UNVERIFIABLE). Separately, the **request** side writes no row at all (`clubs/service.ts:132-143`) — QA-FLOW-003 |
| 23 | Notifications | Email (Resend, `src/lib/email.ts:16`) | — | would fire on delivery | fails soft, returns `false` when `RESEND_API_KEY`/`EMAIL_FROM` are unset | No present effect — nothing calls it for outbox delivery. A future sender inherits a silent-failure default |
| 24 | File storage (`src/lib/storage.ts:67`) | Vercel Blob | `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN` (names only) | every upload and private read when the driver is `vercel-blob` | same contract as the local driver | **REQUIRES_VERIFICATION** — never exercised. `deleteStoredFile` deletes by `url` for PUBLIC and by `storageKey` for PRIVATE (`:105`), an asymmetry that only exists on this driver |
| 25 | All public reads | i18n (`src/lib/i18n/localized.ts:34`) | paired `…En`/`…Ta` columns | every public render | fall back to English with a `lang` attribute and a visible note (REQ-I18N-022) | `text()` drops the `lang`/`isFallback` pair (QA-I18N-005). The three portals (`/club`, `/volunteer`, `/donor`) are English-only hard-coded strings with no document stating the exemption (`qa/discovery/requirements-inventory.md:116`) |
| 26 | All six workflows | Unit test suite (`package.json:11`) | — | `npm run check` | the gate protects the workflows | **Zero coverage.** Three of the six files test modules with no importer anywhere in `src/` (`src/server/payments/provider.ts`, `src/lib/finance/chart.ts`, `src/lib/finance/journal-core.ts`); the other three test pure schemas. QA-FLOW-008, compounding QA-TEST-003 |

---

## 2. Fan-out ranking — change-impact order

Ordered by the number of distinct call sites a change would reach, counted from the rows above and
from `qa/workflows/knowledge-graph.json` `consumed_by` edges.

| Rank | Node | Reached by | Why it ranks here |
|---|---|---|---|
| 1 | `getAdminUser()` (`auth-guard.ts:22`) | 12 API routes + 79 action entry points + every portal page | every authorization decision in the application |
| 2 | `ClubMembership.status` | WF2, WF3, WF4 — 8 distinct guard sites (`volunteers/service.ts:64,77`; `projects/service.ts:49,84,154,200,219`; `clubs/service.ts:208`) | the single portal-access revocation lever |
| 3 | `VOLUNTEER_CONSENT_VERSION` (`validations/volunteer.ts:3`) | 4 guard sites | one constant edit revokes every volunteer's task access |
| 4 | `rateLimit()` (`rate-limit.ts:17`) | login, 4 upload routes, 3 portal action modules, contact form | a failure mode here is an outage, not a weakening |
| 5 | `isOperationalPrivateMedia` + the 4 prefix constants (`storage.ts:27-32`) | 5 call sites across validation, listing, reading, metadata and deletion | the whole private-namespace boundary |
| 6 | `Media.storageKey` ↔ file bytes | every upload and private-read route | the only cross-store invariant in the app |
| 7 | `expire()` / `CACHE_TAGS` (`admin-helpers.ts:87`) | every admin mutation | failures are silent and public-facing |
| 8 | `adminMutation()` error mapping (`admin-helpers.ts:26-39`) | every `adminMutation`-wrapped action | maps only `P2002`/`P2025`; `P2003` falls through to a generic message (QA-DB-001, QA-DB-002) |

**Regression rule.** When a change touches any node above, take the transitive closure of
`consumed_by` in `qa/workflows/knowledge-graph.json`. For rank 1 and rank 2 that closure is
essentially the whole application, and **no existing test is inside it** — the `test.none.*` nodes in
the graph record exactly that.

---

## 3. Couplings that are absent, and that matters

| Expected coupling | Present? | Consequence |
|---|---|---|
| Submitted record → reviewer notification | **No** — `requestClubMembership` writes no outbox row (`clubs/service.ts:132-143`) | every review workflow is pull-only; QA-FLOW-003 |
| Outbox row → delivery worker | **No** — no cron, queue or consumer (`qa/architecture/application-architecture.md:90`) | decisions are recorded, never announced |
| Public content → media-deletion guard | **Partial** — 1 of 21 `Media` relations guarded (`media.ts:51`) | QA-FLOW-002, QA-DB-001 |
| User deletion → dependent-row check | **No** (`settings.ts:122-134`) | QA-DB-002 |
| Category deletion → usage count | **No** (`trust.ts:114-121`) | QA-DB-007 |
| Evidence archiving → a writer for 3 of 4 evidence tables | **No** | QA-DB-004 |
| `anonymousByDefault` → any reader | **No** | QA-REQ-007, and `/donor:19` advertises the behaviour anyway (QA-FLOW-010) |
| Approval engine → any live workflow | **No, by design** (`fundraising/service.ts:67`) | REQ-APPR-046 satisfied; an entire untested surface waits behind one condition |
| API routes → tests | **No** | QA-TEST-003 |
| Unit tests → live code | **Partial** — 3 of 6 files point at modules with no importers | QA-FLOW-008 |

---

## 4. Unknowns and limitations

1. Counted from source only; no dependency was exercised and no call graph was generated by a tool.
2. Fan-out counts in §2 derive from the call sites read during phases 4–6 and the inventories in
   `qa/architecture/api-inventory.md`. They are lower bounds: files read only incidentally may add
   call sites, and §3 of the API inventory records the same caveat for admin list queries.
3. The Vercel Blob row (24) and the Resend row (23) are code paths, not observed behaviour.
4. Modules outside the six traced workflows — public content for seven other models, fundraising,
   the approval foundation, search, i18n negotiation, the contact form — appear here only where a
   traced workflow touched them. A full module-by-module matrix would need
   `qa/architecture/module-inventory.md`, which this run did not produce.
5. No git history exists in this repository, so no dependency row is supported by change-coupling
   evidence (which files historically change together) — only by current-state reads.
