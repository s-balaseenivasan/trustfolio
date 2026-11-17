# Bug analysis — root-cause grouping and fix proposals

**Phase:** 8 (bug investigation)
**Environment:** local, static analysis only. No application was started, no database was
connected. The Postgres on 5432 is the developer's real dev database and was left alone.
**Scope:** the 34 findings in `qa/reports/findings.json` that are not `FIXED`. No new-defect
discovery was attempted. Eight findings already fixed and verified by a passing production build
are cited where they share a root cause, never re-proposed.
**Shard:** `qa/reports/findings.bugs.json` — 10 grouping records (`QA-ROOT-001`…`QA-ROOT-010`) and
14 findings re-issued with a revised severity, status or corrected evidence.
**Nothing in this report has been applied.** Every proposal waits on your approval, individually.

---

## 1. The one-paragraph answer

The 34 open findings are not 34 problems. They are ten, and one of the ten accounts for a third of
them. The dominant root cause is **unenforced convention**: a correct pattern exists in four or five
places and is missing in one or two more, because nothing makes the omission impossible or even
visible. Six of the eight fixes applied in this run were that shape, and each was fixed by hand at
the single site — which closed the finding and left the generator running. The second-largest cause
is **prose that has drifted from the code it describes**, and one of its members (`QA-REQ-006`) was
filed as a privacy defect against correct code, with a proposed remedy that would have broken a
consented workflow. Only two groups are real engineering work with real uncertainty: the absent test
gate, and the notification loop.

---

## 2. Root-cause groups, ranked by findings closed per decision

| Group | Root cause | Open members | Governing severity | One change that closes several |
|---|---|---|---|---|
| **QA-ROOT-001** | Pattern present in N places, missing in one or two | QA-API-003, QA-API-004, QA-UI-001, QA-UI-003, QA-I18N-005, (QA-AUTH-004) | Medium | Three extractions — `sameOrigin()`, `code` in the shared catch, one `ReasonInput` — close five |
| **QA-ROOT-002** | Destructive action with no dependency pre-check, over a wrapper that cannot explain the refusal | QA-DB-002 | Medium | Map `P2003` in `adminMutation` — four lines, covers every present and future instance |
| **QA-ROOT-003** | List query written without the pagination convention | QA-FLOW-006, QA-API-002, QA-DB-006, QA-FLOW-010 | Medium | One `take`/cursor pass over four files, plus a rule that every `findMany` carries a `take` |
| **QA-ROOT-004** | No single definition of an evidence-backed public claim | QA-REQ-004, QA-REQ-002, QA-FLOW-010 | **High** | **One product decision** closes three. Blocked on you, not on effort |
| **QA-ROOT-005** | Documentation describing code that changed under it | QA-REQ-001, QA-REQ-005, QA-REQ-006, QA-UI-002 | Low | One documentation commit closes four, with zero application risk |
| **QA-ROOT-006** | Capability built below the UI with no consumer and no marker | QA-DB-004, QA-REQ-007, QA-UI-004 | Informational | A `RESERVED` register plus one source-scan test closes three and prevents recurrence |
| **QA-ROOT-007** | State machine without an explicit transition table | QA-FLOW-004 | **High** | One line stops the harm; reinstatement semantics are separate feature work |
| **QA-ROOT-008** | Client gate and server rule stated independently | QA-FLOW-007, QA-FLOW-009, QA-UI-005, QA-AUTH-004 | Low | Export one predicate per rule from the owning service and import it in both layers |
| **QA-ROOT-009** | Test effort followed testability, not risk | QA-FLOW-008, QA-TEST-003 | **High** | A twelve-test invariant slice on disposable Postgres in CI |
| **QA-ROOT-010** | One defect filed twice by two concurrent shards | QA-PROCESS-008, QA-FLOW-011 | Informational | Mark one a duplicate — open count drops 34 → 32 with no code change |

Standalone, belonging to no group: `QA-DB-005` (FK indexes), `QA-AUTH-002` (XFF),
`QA-REQ-003` (metric units), `QA-FLOW-003` (submission notifications),
`QA-DATA-006` (already triaged `wontfix`).

### 2.1 Correction to the grouping hypothesis in the brief

The brief proposed that `QA-DB-004`, `QA-REQ-007` and `QA-DATA-006` are all "a column exists that
nothing writes". Two of the three are. **`QA-DATA-006` is not**: `ImpactMetric.value` is written on
every metric that exists — the question there is the numeric type (`Float` where money uses
`Decimal`), which is a different decision with a different owner, and it is already triaged
`wontfix`. The member the brief missed is **`QA-UI-004`**: `campaignId` is accepted by the schema
and fully honoured by the service, and the form hardcodes it to the empty string. Three more
*halves* belong to the group too — the unreachable `DRAFT` status inside `QA-FLOW-004`, the
unreachable `SENT`/`FAILED` statuses inside `QA-NOTIFY-007`, and the hardcoded status cell inside
`QA-FLOW-010`.

### 2.2 Why patching each site individually is the wrong shape for QA-ROOT-001

This matters more than any individual fix in this report. Look at what the eight landed fixes have
in common: `QA-AUTH-001` added the per-identifier limiter the contact form already had.
`QA-API-001` added the storage-prefix check its three sibling routes already had. `QA-DB-003` added
the compensating delete its four sibling routes already had. `QA-FLOW-001` adopted the status
predicate the volunteer component already used. Four fixes, four pre-existing correct siblings,
zero shared helpers created. The sixth sibling added next quarter will be wrong again, and the only
thing that caught the first five was a QA pass.

`QA-FLOW-001`'s fix is the clearest illustration: it resolved the mismatch by re-deriving
`canAcceptEvidence = TODO|IN_PROGRESS` in a **third** file. The rule now exists as three
independent literals instead of two. The finding is genuinely closed and the root cause is slightly
worse.

So for every QA-ROOT-001 member below, the proposal is the shared helper plus the check that
forbids the un-shared form — not the patch.

---

## 3. Three kinds of work, kept apart

### 3.1 Code defects with an unambiguous fix (do these)

`QA-DB-002`, `QA-FLOW-006`, `QA-API-002`, `QA-DB-006`, `QA-DB-005`, `QA-API-003`, `QA-API-004`,
`QA-UI-001`, `QA-UI-003`, `QA-UI-005`, `QA-FLOW-007`, `QA-I18N-005`, `QA-AUTH-004`,
`QA-FLOW-004` (the one-line half), `QA-REQ-003` (the missing unit label half).

No decision is needed for any of these. The expected behaviour is set by a sibling in the same
codebase, by the server rule the client is meant to mirror, or by the schema's own delete
declarations.

### 3.2 Product decisions — the code and the documentation disagree and someone must choose

Only **three** findings are genuinely of this kind, and they are all one decision:

| Finding | The code says | The documentation says | Who decides |
|---|---|---|---|
| `QA-REQ-002` | A typed registration number is enough for a "Registered trust" check-badge (`hero.tsx:27`, and the function's own comment at `:21` says so deliberately) | A bare registration number is not inspectable evidence (`APPLICATION_CONTEXT.md:107`) | The trust |
| `QA-REQ-004` | An unconstrained checkbox renders "Relationship confirmed by the trust" (`admin.ts:228` → `view-models.ts:103`) | A public claim is backed by a record (`README.md:71-82`); the demo auditor at `scripts/audit-demo.ts:113` already treats the flag as a verification claim | The trust |
| `QA-FLOW-010` | Nothing reads `anonymousByDefault` | "Anonymous display is the default" (`donor/page.tsx:19`) | The trust |

One rule settles all three: *a public claim carrying verification language is backed by a record
naming what was checked, by whom, and when.* Write that into `APPLICATION_CONTEXT.md`, then the
three code changes are small and obvious. Until it is written, each surface will keep deciding for
itself — which is exactly how three different rules arose.

**The brief also listed `QA-REQ-006` here. It no longer belongs.** See §4.1 — the decision
dissolved on reading the consent text.

`QA-FLOW-009` is a fourth, smaller decision: is `SUBMITTED` inside the evidence window? Answer it
before touching either layer, because the two answers give the reviewer different powers and
`QA-FLOW-001`'s fix has already quietly chosen one of them.

### 3.3 Feature work masquerading as a bug (do not schedule these as bug fixes)

**`QA-NOTIFY-007` — the clearest case, and it should be reclassified.** It was filed Medium
`CONFIRMED` on the grounds that outbox rows are never delivered. Its own `expected` clause allowed
an alternative: *"or a documented decision records that delivery is not yet implemented."* That
decision exists, in four places phase 6 did not search:

- `docs/requirements/trustfolio-frd.md:46` — FR-NTF-01, implementation status recorded as
  "Contact email only."
- `docs/implementation/roadmap.md:44` — "external delivery remains a later notifications phase"
- `docs/implementation/roadmap.md:52` — "external notifications … remain later work"
- `docs/testing/test.md:43` — T-NTF-01, the acceptance test for FR-NTF-01, `NOT_RUN`

Phase 6 read `APPLICATION_CONTEXT.md` and `README.md`, where the deferral is absent, and not
`docs/`, where it is stated four times. **Medium → Informational**, reclassified as scheduled
feature work. Two small things remain worth doing: a retention path for the table, and a pointer to
FR-NTF-01 from `APPLICATION_CONTEXT.md` so the next reviewer finds the deferral where they look.

**`QA-FLOW-003` is not covered by that deferral and stays Medium.** The deferral is about *sending*;
these rows are never *written*. Three of the four submission events write no notification record at
all, so the future FR-NTF-01 worker would close the decision half of the loop and leave the
submission half missing — the gap survives the feature meant to fix it. There is a cheap interim
that removes today's user impact without building anything: four count queries and a tile beside the
existing unread-messages tile on the admin dashboard.

**`QA-FLOW-004` is half and half.** The bug half is one line: the admin UI offers `SUSPENDED` as a
target (`clubs.ts:112`) and no code path leaves it, so a reversible-sounding action is permanent.
The feature half is undefined semantics: reinstatement must decide what it restores — prior task
assignments, attendance history, and whether a stale `consentVersion` blocks it, since approval
re-checks consent at `clubs/service.ts:153`. Remove the status from the enum now; design
reinstatement as scoped work.

---

## 4. Severity challenges

19 Medium out of 42 was flat because Medium is the comfortable answer. Eight changes, four up, four
down. Every one is argued from the rubric and from evidence, and where I think a prior phase called
it wrong I say so.

### 4.1 Down — `QA-REQ-006`: Medium → **Low**, and it is a documentation defect, not a privacy one

This is the most important correction in the pass, and it reverses the direction the brief expected.

The finding says a coordinator sees every active member's name and email "on a basis the trust
cannot point to in writing". **The basis is in writing.** Every member accepts it at the moment they
request membership:

```
src/lib/validations/club.ts:4
CLUB_CONSENT_TEXT = "I agree that Trustfolio staff and the club coordinator may use my
account name and email to review and manage my club membership."
```

And it is enforced, not merely displayed:

- `src/components/club/membership-request.tsx:16` — the checkbox is `required`
- `src/server/clubs/service.ts:138` — the request records `consentAt`, `adultAttestedAt`,
  `consentVersion`
- `src/server/clubs/service.ts:119` — `inviteClubMember` explicitly **nulls** all three, so an
  invited user cannot bypass the attestation
- `src/server/clubs/service.ts:153` — approval **throws `CONSENT_REQUIRED`** unless all three are
  present at the current version
- `src/app/club/[id]/page.tsx:17` — the workspace lists `status: "ACTIVE"` only

Therefore no membership can reach `ACTIVE` without that consent, and the roster shows only `ACTIVE`
memberships. Every email a coordinator sees belongs to someone who agreed, at the current consent
version, to exactly that use, by exactly that role. Phase 5 read the two privacy documents and not
the consent constant.

What remains is real but small: `APPLICATION_CONTEXT.md:58` and
`docs/security/permissions-matrix.md:7` describe the coordinator's view more narrowly than the
consent grants. Fix the documents; **do not touch `src/app/club/[id]/page.tsx`**. The remedy the
finding proposed — restricting the roster to display names — would break the coordinator's
membership-management workflow and contradict the consent the trust obtained. This is the concrete
cost of the QA-ROOT-005 group: stale prose produced a false alarm with a harmful fix attached.

### 4.2 Down — `QA-AUTH-002`: Medium → **Low**, and `SUSPECTED` → `CONFIRMED`

The finding says "every IP-scoped rate limit in the application can be bypassed at will". That is
literally true and materially misleading. I enumerated all eleven limiter call sites:

- **Nine** are keyed on the authenticated actor id (`upload:${user.id}`,
  `club-document-upload:${actor.id}`, `volunteer-write:${user.id}`, …). The header cannot touch them.
- **Two** involve the IP, and both now have an IP-independent companion: login
  (`src/auth.ts:35` IP-keyed, `:39` account-keyed at 20/hour — added by the `QA-AUTH-001` fix
  **during this run**) and the contact form (`contact.ts:59` IP-keyed, `:60` email-keyed).

So a forged header reaches no authentication or authorization decision. Residual exposure: contact
form volume, and only if the attacker also rotates email addresses. The IP component of the login
key is now effectively decorative.

I deliberately did **not** downgrade this on "it's Vercel, the platform overwrites the header" —
that argument fails. `src/lib/env.ts:13` defaults `STORAGE_DRIVER` to `"local"`, and
`src/lib/storage.ts:10` documents a local-filesystem driver, so a self-hosted deployment with no
normalizing proxy is a supported configuration, not a hypothetical. The downgrade rests only on the
limiter inventory.

### 4.3 Down — `QA-UI-001`: Medium → **Low** (prior-phase over-call)

The entry's own `user_impact` reads "minor friction … no data-integrity consequence, since the
server still enforces the rule correctly." That is the definition of Low. Medium is "a feature
misbehaves in a non-blocking way"; here the feature behaves correctly and an inline hint is absent.
One avoidable round trip for an administrator.

### 4.4 Down — `QA-NOTIFY-007`: Medium → **Informational**

See §3.3. Documented, scheduled feature work. Carrying it as a Medium defect displaces real ones in
a remediation plan.

### 4.5 Up — `QA-REQ-004`: Medium → **High**

The product's premise is that a public claim is backed by an inspectable record. This is the only
verification-flavoured public claim in the product with no record of any kind — no document, no
confirming person, no date. Three things make it High rather than Medium: the codebase's own demo
auditor (`scripts/audit-demo.ts:113`) already asserts no demo testimonial may be
relationship-verified, which shows the flag is internally understood as a verification claim; the
adjacent schema in the same file (`admin.ts:212`) enforces exactly this rule for a *weaker* claim;
and the badge renders with a `BadgeCheck` icon in the product's own verification vocabulary. Not
Critical — no data loss, no auth impact, and a trust administrator authors the claim knowingly.

### 4.6 Up — `QA-FLOW-004`: Medium → **High**

An administrator is offered an action whose label implies reversibility and whose effect is
permanent removal, with no in-application remedy. The member loses the club, their future attendance
and hours, and every project task derived from that membership. The rubric's High is "a major
workflow fails or a role boundary is weak, **with a workaround**" — hand-written SQL against
production is barely a workaround. Not Critical: no data is corrupted and the action requires a
deliberate admin decision.

### 4.7 Up — `QA-FLOW-008`: Medium → **High**

Up-called on information the prior phase could not have had. Eight fixes landed during this run, to
the login limiter (`auth.ts`), a private-file authorization route (`club/documents/[id]/file`), and
the media-deletion guard that now blocks across thirteen relations — verified by typecheck, lint and
a production build, and by nothing that executes them. Typecheck cannot see an inverted predicate, a
wrong enum literal in a Prisma filter, or a check placed after the thing it protects. A missing test
is normally Medium; a missing test over authorization and deletion code that was changed yesterday
is the live risk in this repository.

`QA-TEST-003` stays Medium — same root cause, narrower surface, and it is largely subsumed by the
QA-ROOT-009 remedy.

### 4.8 Up in priority, not in severity — `QA-DB-005` stays **Medium**

One of its three priority columns changed status during this run. The `QA-DB-001`/`QA-FLOW-002` fix
added `db.galleryImage.count({ where: { mediaId } })` at `media.ts:64` and a second at `:66`.
`GalleryImage`'s only indexes are `@@unique([albumId, mediaId])` (`schema.prisma:1820`, `mediaId`
non-leading) and `@@index([albumId, sortOrder])` (`:1821`). So **every media deletion now runs two
sequential scans of `GalleryImage`**, on top of the cascade scan Postgres already performs — a
latent index gap promoted to the hot path of a shipped guard. Severity unchanged; it jumps the
queue because the remedy is three lines of migration.

### 4.9 Held, with reasons — declining to inflate

- **`QA-REQ-002` stays Medium.** It is tempting to raise it with `QA-REQ-004`, but a registration
  number is independently checkable in a public register. The claim is not baseless, only
  un-inspectable on this site.
- **`QA-FLOW-007` stays Low.** The server bans hold in all three places. Only the affordance is
  wrong. A control that always fails is annoying, not unsafe.
- **`QA-REQ-003` stays Medium**, re-scoped: the confirmed half is a published figure rendered with
  no unit; the speculative half is the two-units-under-one-key dataset.
- **`QA-FLOW-006` stays Medium** despite being the worst member of QA-ROOT-003. No row counts or
  query plans exist to justify more — no database was authorized.

### 4.10 Resulting distribution (34 open → 32 after the duplicate merge)

| Severity | Before | After |
|---|---|---|
| High | 0 | 3 (QA-REQ-004, QA-FLOW-004, QA-FLOW-008) |
| Medium | 16 | 11 |
| Low | 11 | 13 |
| Informational | 7 | 5 |

Still not a textbook distribution, but it now has a top. Three findings carry the weight, which is
what a real defect set looks like.

---

## 5. The four SUSPECTED findings — is the named experiment the cheapest one?

In three of the four cases, no. The pattern across all four: the experiment was written as a
*runtime reproduction* when the open question was not a runtime question.

### `QA-AUTH-002` — named experiment is both expensive and non-decisive → **replace**

Named: "send a forged header to each deployed environment and check whether the limiter bucket
changes." That needs a deployed environment and a database, no route echoes limiter state so you
would be reading the DB directly, and it answers only for the environments you happen to try.

Cheapest decisive work, in order: (1) enumerate the limiter call sites — eleven, done in §4.2, zero
cost, and it collapsed the severity; (2) a three-line unit test over `getClientIp()` with a mocked
`headers()` returning a multi-value chain, no database; (3) one sentence from the trust naming the
supported deployment topologies — no experiment at all, and it is the only thing that actually
settles the question. **Status → `CONFIRMED` Low.**

### `QA-REQ-002` — named experiment is 50× the cost of the real one → **replace**

Named: "seed a profile with a registration number and no public registration document, then compare
`/` and `/verification`." Database, seed, two page renders.

`statusItems()` at `hero.tsx:26` is a pure function of `(t, trust, coverage)`. Export it and assert
the chip for `{ number: "X", document: null }` — milliseconds, no database, and it doubles as the
permanent regression guard. The divergence with `evidence.ts:222` is already proven by reading two
deterministic paths over one input, which is the same standard `QA-REQ-004` was marked `CONFIRMED`
on. Holding this as `SUSPECTED` was inconsistent with the rest of the set. **Status → `CONFIRMED`**,
with `uncertainty` reworded to name the product decision and its owner — because the residual is not
an experiment at all.

### `QA-REQ-003` — keep `SUSPECTED`, but the fix is cheaper than the experiment → **replace**

Named: "seed two figures with the same `metricKey` and different units, render `/en/impact`."

Two cheaper routes. **(a)** One read-only statement against real data, no seeding, which answers
both whether it happens and how often — something the seeded render cannot do:

```sql
SELECT "metricKey", COUNT(DISTINCT "unitEn")
FROM "ImpactMetric" WHERE status = 'PUBLISHED'
GROUP BY 1 HAVING COUNT(DISTINCT "unitEn") > 1;
```

**(b)** Cheaper still: add the unit-consistency `refine` to `metricSchema` and the question is moot.
*When the preventive fix costs less than the experiment that would justify it, skip the experiment.*
Neither was run — no database was authorized. Also note the confirmed half needs no experiment: the
chart renders no unit at all (`impact/page.tsx:88`, `bar-chart.tsx:29`), on a transparency site.

### `QA-FLOW-007` — named experiment answers a question no experiment can usefully answer → **replace**

Named: "seed an ADMIN account with a consented volunteer profile and an active membership, submit
attendance as that account, then open `/admin/volunteers` as the same account." Four steps, a
database and a browser.

Two file reads already establish the defect: the queue query has no actor exclusion
(`volunteers/page.tsx:24`) and the component receives no actor id, so it *cannot* disable itself
(`volunteer-review.tsx:10`). All the seeded run adds is whether the precondition occurs in
practice — a question about deployment populations, not about code, and for a small charity where
one person administers and volunteers the answer is plainly yes. The fix is smaller than the
experiment. **Status → `CONFIRMED` Low**, `uncertainty` reduced to frequency.

**Summary:** 3 of 4 move to `CONFIRMED` at no cost. An unresolvable `SUSPECTED` finding is worth
less than a cheap definitive test — and three of these four were resolvable by reading, which is
cheaper still.

---

## 6. Fix proposals — top five by risk reduction per unit of effort

Ranked by risk reduction per effort, which is why `QA-ROOT-009` (highest absolute risk reduction)
and `QA-ROOT-004` (highest mission risk) are not in the list: one is large, the other is blocked on
a decision. Both appear in §7.

**None of these has been applied. Each needs your approval separately.**

---

### Proposal 1 — `QA-DB-002` / `QA-ROOT-002`: map `P2003` in the shared admin wrapper

**Files:** `src/server/actions/admin-helpers.ts` (required).
`src/server/actions/admin/settings.ts` (optional second step.)

**The problem.** `deleteUser()` calls `db.user.delete()` with only a self-delete guard
(`settings.ts:127`). Nearly every one of `User`'s ~27 inverse relations is `onDelete: Restrict`, so
deleting anyone who has joined a club, reviewed a record or created anything fails at the database.
`adminMutation` maps `P2002` (`admin-helpers.ts:27`) and `P2025` (`:36`) and nothing else, so the
failure lands on the generic fallthrough at `:38-39`: *"Something went wrong. Please try again."*

**Why this is rank 1.** The three sibling findings fixed this run (`QA-DB-001`, `QA-DB-007`,
`QA-FLOW-002`) each added a bespoke pre-check so the raw error would never be reached. The shared
wrapper behind all of them is unchanged, so the next delete action added reproduces `QA-DB-002`
exactly. Four lines in one file covers `deleteUser`, every action already written, and every action
not yet written — and retro-covers the failure mode of three already-closed findings.

**Evidence.** `src/server/actions/admin-helpers.ts:27`, `:36`, `:38`, `:39`;
`src/server/actions/admin/settings.ts:122`, `:127`; `prisma/schema.prisma:269-318`;
`src/server/actions/admin/media.ts:51` (`findDeletionBlocker()`, the template for step 2).

**Proposed change.** In the `PrismaClientKnownRequestError` block, after the `P2025` branch:

> if `error.code` is `P2003` or `P2014`, return
> `{ status: "error", message: "This record is still referenced by other data and cannot be deleted.", values }`

Optional step 2: add a `findDeletionBlocker`-style pre-check to `deleteUser` naming the blocking
relations, so the message says *which* data.

**Risk.** Very low. The branch is reachable only where the generic message is returned today, so no
success path changes and no currently-working message is altered. The one judgement call is wording:
it must not leak which other records exist. The proposed text names no entity.

**Expected result.** Every foreign-key refusal across the admin surface becomes actionable instead
of generic. `QA-DB-002` moves from "silently fails with no path forward" to "tells the admin why",
which is the finding's own first acceptance option.

**Regression tests.** `TC-BUG-001` — delete a user holding one `ClubMembership` through
`adminMutation` and assert a specific, non-generic message. Plus a unit test that a synthetic
`P2003` is mapped and a synthetic unknown code still falls through to the generic message.

---

### Proposal 2 — `QA-ROOT-005`: one documentation commit, four findings

**Files:** `APPLICATION_CONTEXT.md`, `docs/security/permissions-matrix.md`, `README.md`,
`src/components/admin/media-library.tsx` (copy string only). **No application logic.**

**The problem.** Four statements describe superseded behaviour: three closed October gaps still
presented as current (`APPLICATION_CONTEXT.md:111`, contradicted six lines later at `:117`); a
claim that every action calls `requireAdmin()` (`README.md:113`) when three API routes and four
portal action modules deliberately use `getAdminUser()` plus a scope check; a coordinator-visibility
description narrower than the consent the member signs (`APPLICATION_CONTEXT.md:58`,
`permissions-matrix.md:7`); and a delete dialog promising unconditional removal
(`media-library.tsx:220`) over a guard that now refuses in thirteen more cases than when the copy
was written.

**Why this is rank 2.** The cost is an hour and the application risk is zero, it closes four of the
34, and one of the four is actively dangerous as documentation: `QA-REQ-006` was filed as a Medium
privacy defect against correct code because a reviewer trusted `APPLICATION_CONTEXT.md:58` over
`src/lib/validations/club.ts:4`. Leaving it unfixed invites someone to "fix" the club roster and
break a consented workflow.

**Evidence.** `src/lib/validations/club.ts:4`; `src/server/clubs/service.ts:119`, `:138`, `:153`;
`src/app/club/[id]/page.tsx:17`, `:20`; `APPLICATION_CONTEXT.md:58`, `:111`, `:117`;
`docs/security/permissions-matrix.md:7`; `README.md:113`;
`src/app/api/club/documents/[id]/file/route.ts:8`; `src/components/admin/media-library.tsx:220`;
`src/server/actions/admin/media.ts:51`.

**Proposed change.** State that a coordinator sees the active-member roster — account name and
email, per the consent at `src/lib/validations/club.ts:4` — plus opted-in skills for members who
enabled `shareSkillsWithClubs`, and cite the consent constant from both privacy documents. Move the
three closed gaps into a dated "Resolved in the November safeguard update" list, keeping the
"recheck before relying" instruction only for items still open. Rewrite the README bullet to name
both authorization patterns and point at `src/server/auth-guard.ts` and the per-service `require*`
functions. Add the published-document exception to the delete-dialog copy.

**Risk.** Essentially none; one user-visible string changes. The failure mode is writing a *new*
inaccuracy, which is why each statement should cite the `file:line` it describes.

**Expected result.** `QA-REQ-001`, `QA-REQ-005`, `QA-REQ-006` and `QA-UI-002` close. A reviewer can
verify the club privacy boundary against the consent text instead of a narrower summary.

**Regression tests.** A string-containment check that `CLUB_CONSENT_TEXT` and the permissions matrix
name the same fields. For the rest, the convention that a behavioural statement cites its
`file:line`.

---

### Proposal 3 — `QA-FLOW-006` / `QA-ROOT-003`: bound the membership-approval page

**Files:** `src/app/admin/(dashboard)/clubs/[id]/page.tsx`. Then `src/app/club/[id]/page.tsx` for
`QA-API-002`.

**The problem.** `/admin/clubs/<id>` — the mandatory entry point for approving a membership request
— issues an unbounded `findMany` over the **entire** `User` table to populate the invite picker
(`:16`), an unbounded include over the club's memberships with an unbounded nested include over each
membership's full decision history (`:15`), and an unbounded documents include; then serialises all
of it into the client component (`:24`). The audit query on the same page is correctly capped at
`take: 30` (`:17`), so the convention was known while the file was being written. The nested
`memberships × history` shape is a product, not a sum.

**Why this is rank 3.** The expected values are not a judgement call — they are copied from a
sibling page: `take: 500` for the user picker and `take: 200` for clubs at
`project-operations/[id]/page.tsx:20-21`. One file, mechanical change, and it is the one page the
approval workflow cannot avoid. `QA-API-002` is the same edit on the coordinator workspace.

**Evidence.** `src/app/admin/(dashboard)/clubs/[id]/page.tsx:15`, `:16`, `:17`, `:24`;
`src/app/admin/(dashboard)/project-operations/[id]/page.tsx:20`, `:21`;
`src/app/admin/(dashboard)/volunteers/page.tsx:22`; `src/app/club/[id]/page.tsx:17`.

**Proposed change.** Cap the memberships and documents includes with a `take` and a page parameter;
cap the nested `history` at `take: 5`, which is all the summary displays; replace the unbounded user
query with a capped, searchable picker at `take: 500` minimum. Same `take`/`skip` treatment on
`/club/[id]`.

**Risk.** Low but not nil, and higher than proposals 1 and 2 — this is the only proposal that can
*hide data an admin currently sees*. A club with more members than the cap would show a truncated
roster, and if the invite picker is capped without a search, an administrator may be unable to find
a user who exists. Ship the search affordance with the cap, not after it. This is also the proposal
most exposed to the absence of tests (`QA-ROOT-009`) — there is no gate that would catch a truncated
roster.

**Expected result.** The approval page's payload stops scaling with the account table.
`QA-FLOW-006` and `QA-API-002` close; `QA-DB-006` and `QA-FLOW-010` follow with the same pattern.

**Regression tests.** Seed 1000 users and a club with 200 members, assert the page payload is
bounded and that the 201st member is reachable by paging. Assert the invite picker can find a user
outside the first page.

---

### Proposal 4 — `QA-DB-005`: three indexes, one of them now on a shipped hot path

**Files:** `prisma/schema.prisma` plus one generated migration.

**The problem.** `GalleryImage.mediaId`, `ActivityLog.userId` and `Media.uploadedById` have no
usable index. `GalleryImage`'s only indexes are `@@unique([albumId, mediaId])` (`:1820`, with
`mediaId` non-leading) and `@@index([albumId, sortOrder])` (`:1821`). The `QA-DB-001`/`QA-FLOW-002`
fix landed during this run added `db.galleryImage.count({ where: { mediaId } })` at `media.ts:64`
and a second filtered count at `:66`, so **every media deletion now performs two sequential scans
of `GalleryImage`** — in addition to the cascade scan Postgres already performs because
`GalleryImage.media` is the schema's one `onDelete: Cascade` relation (`:1818`).

**Why this is rank 4.** Three `@@index` lines, near-zero regression risk, and it repairs a cost
introduced by a fix shipped yesterday. It also surfaces a process point worth more than the indexes:
the fix added a new query pattern without checking the model's indexes.

**Evidence.** `src/server/actions/admin/media.ts:64`, `:66`; `prisma/schema.prisma:1818`, `:1820`,
`:1821`, `:706`, `:798`, `:1203`.

**Proposed change.** Add `@@index([mediaId])` to `GalleryImage`, `@@index([userId])` to
`ActivityLog`, `@@index([uploadedById])` to `Media`. Leave the ~20 lower-impact FK columns on
editor-bounded content tables for opportunistic work.

**Risk.** Low. Three indexes add write cost on three tables and index-creation time on the
migration; on `ActivityLog` and `Media`, which are the write-heavy ones, that trade is favourable
for the read patterns involved. Should be applied with `CREATE INDEX CONCURRENTLY` if the tables are
already large — which cannot be checked from here, since no database was authorized.

**Expected result.** Media deletion stops scanning `GalleryImage`; per-user activity-log queries
stop scanning. `QA-DB-005`'s priority three close.

**Regression tests.** A schema test asserting every scalar named in a `@relation(fields: [...])`
clause either leads an index or appears on an explicit deliberately-unindexed list. Index presence
is verifiable by `check:db` without any application behaviour.

---

### Proposal 5 — `QA-FLOW-003`: pending-review counts on the admin dashboard

**Files:** the admin dashboard page and its query module. **No schema change, no notification
system.**

**The problem.** Three of the four submission events write no notification record at all —
`requestClubMembership` (`clubs/service.ts:141`), `submitAttendance`
(`volunteers/service.ts:66`), `submitServiceLog` (`:79`) and the submit transition in `updateMyTask`
(`projects/service.ts:226`) all write history and audit rows and stop. The decision side does write
outbox rows (`clubs/service.ts:161`, `volunteers/service.ts:101`, `projects/service.ts:244`). So
submitted work is invisible until an administrator happens to open the right page, and because the
rows are never written, the future FR-NTF-01 delivery worker would fix the decision half and leave
this half broken.

**Why this is rank 5.** It is the cheapest real reduction in *present* user harm in the whole set:
four count queries and a tile, beside the unread-messages tile that already exists. It needs no
decision, no schema change and nothing from the deferred notification feature — which is exactly the
right interim given that FR-NTF-01 delivery is documented as later work
(`docs/requirements/trustfolio-frd.md:46`, `docs/implementation/roadmap.md:44`).

**Evidence.** `src/server/clubs/service.ts:141`, `:161`; `src/server/volunteers/service.ts:66`,
`:79`, `:101`; `src/server/projects/service.ts:226`, `:244`;
`src/app/admin/(dashboard)/approvals/page.tsx:20`; `docs/requirements/trustfolio-frd.md:46`;
`docs/architecture/trustfolio-expansion.md:97`.

**Proposed change.** Add four counts — membership requests in `REQUESTED`, attendance awaiting
review, service logs awaiting review, tasks in `SUBMITTED` — to the admin dashboard as linked
tiles. Separately and later, as part of FR-NTF-01: add a role-targeted recipient to the outbox and
write a row on each of the four submission events.

**Risk.** Low. Four read-only counts on an existing page. Two things to get right: the counts must
be scoped exactly as the queues are, or a tile will claim work that the queue does not show; and
they add four queries to a page load, so they want the same bounding discipline as proposal 3.

**Expected result.** No submission can sit unseen because nobody thought to look. `QA-FLOW-003`'s
present-day user impact closes; its durable half stays open against FR-NTF-01.

**Regression tests.** Assert each tile count equals its queue's row count for a seeded fixture.
Later: assert each of the four submission services writes exactly one `PENDING` record.

---

## 7. Deliberately not in the top five

**`QA-ROOT-009` (the test gate) — highest absolute risk reduction, largest effort.** It is the
enabling condition for most of the other groups and the reason eight fixes are in the tree with no
behavioural evidence. It is excluded only because the ratio puts it below five smaller items, not
because it can wait. The minimal slice is about a dozen tests on a disposable Postgres schema in CI:
the three `SELF_APPROVAL` bans, the consent-version gate at `clubs/service.ts:153`,
`findDeletionBlocker` across its four branches, both login limiters, and the three-actor matrix on
the four private-file routes. `npm run check:db` already exists and is not in CI. **If you do one
thing from this report beyond proposal 1, do this.**

**`QA-ROOT-004` (the claims rule) — highest mission risk, cannot be ranked by effort.** It is
blocked on a product decision, not on engineering. Once the rule is written, the three code changes
are small. Until then, any code change is a guess at what you want.

**`QA-ROOT-010` — free.** `QA-PROCESS-008` and `QA-FLOW-011` are one defect filed twice by two
concurrent shards, and both are already remediated by the dangling-reference check in
`validate-reports.mjs`. Mark `QA-FLOW-011` a duplicate and both `FIXED`: the open count goes
34 → 32 with no code change.

---

## 8. Scope and limits of this analysis

- **No source was modified.** The only files written are `qa/reports/bug-analysis.md` and
  `qa/reports/findings.bugs.json`.
- **No application and no database ran.** Every claim here is from code reading. Severity for
  `QA-ROOT-003`, `QA-DB-005` and `QA-REQ-003` is reasoned from query shape and write frequency, not
  measured — the orderings are defensible, the absolute costs are not.
- **The eight landed fixes were not re-verified behaviourally.** They typecheck, lint and build. I
  read `findDeletionBlocker` closely enough to confirm it introduces the `GalleryImage.mediaId`
  query pattern in proposal 4; I did not execute it. That is the substance of §4.7.
- **No new defects were sought**, per the brief. One consequence of a landed fix was found while
  tracing root causes (proposal 4) and is recorded against the existing `QA-DB-005`.
- **Severity and status revisions in `findings.bugs.json` are proposals.** They are re-issued under
  their original ids so `findings-merge.mjs` can pick them up, and each carries a
  `severity_revision` field stating what changed and why. If the merge keeps the earlier entries,
  the same arguments are preserved in the `QA-ROOT-*` records and in §4 above.
- **No secrets, tokens or personal data appear in this report.** The consent string quoted in §4.1
  is a product constant from `src/lib/validations/club.ts`, not user data.

This report states what was examined and what was not. It is not a statement that the application is
defect-free, fully covered, or production-ready.
