# Trustfolio software requirements specification (SRS)

Status: **target specification; Phase 1 draft approval and Phase 2–6 gated operational subsets implemented locally**. Updated: 2026-10-26. Functional requirement IDs refer to `trustfolio-frd.md`; decision IDs refer to `../architecture/trustfolio-expansion.md`. Full contracts remain unimplemented unless the phase record in `../implementation/roadmap.md` says otherwise.

## Existing platform constraints

Phase 5 implemented subset: only legacy trust `ADMIN` creates/edits private request and linked campaign planning drafts. A request target is positive integer INR paise, with no floating-point conversion. Several requests may belong to one existing Project; a request has at most one campaign draft. Optimistic versions and append-only history protect edits. Dedicated private evidence requires trust-admin authentication on upload and read; its Media link restricts deletion. SQL constraints hold request and campaign states at DRAFT, keep approval/release references null and prevent public publication. The public DTOs do not select fundraising drafts. Submission eligibility, approval snapshots, mandatory due date/evidence checks, public release and collection remain specifications pending active authority and disclosure decisions.

Phase 6 implemented subset: ADMIN can link an existing `PORTAL_USER` account and record cash/bank/UPI intake for a published non-demo project. Values are exact positive INR paise; donation state is database-constrained to `PENDING_VERIFICATION`. Immutable intake history and private evidence are retained. `/donor` requires a current account and its own linked donor profile; the DTO omits references and private notes. No guest/self-registration, online order/webhook endpoint, provider persistence, verification, allocation, receipt, refund, recurring charge, public amount or journal is implemented. The provider-neutral interface includes a test-only mock; the production resolver fails closed. These are restricted implementation defaults, not approvals of D-01/D-04/D-05.

Extend the current Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL and Auth.js credentials application. Keep `/en` and `/ta` public routes, `/admin` content management, existing Prisma primary keys/slugs and relations, manually reviewed Tamil fallback, public DTOs, cache tags, local/Blob storage behavior and `ContentStatus`. Follow installed Next.js guidance before framework changes. The existing project display phase must not be overloaded as a financial or publication state.

## System interfaces

| Interface | Proposed contract | Related requirements |
| --- | --- | --- |
| Server actions | Validated form command → current identity and scope → domain transition → typed result with safe error code; no direct client-provided authority. | FR-IDN, FR-CLB, FR-VOL, FR-PRJ, FR-TSK, FR-FND, FR-APR |
| Read queries | Separate public DTO, portal-scoped DTO and finance private read modules. Pagination, filtering, and field allowlists are mandatory. | FR-PUB, FR-FIN-07 |
| Payment adapter | Target: create order, verify signed callback/event, fetch status, refund if supported, parse settlement; provider IDs and request keys persisted. Current: typed contract and non-production test HMAC mock only; live resolver throws. | FR-DON-02/04/05 |
| Webhook route | Target: verify raw-body signature/authenticity before interpretation; store event ID and payload digest; idempotent transition; bounded response. Current: no webhook route or persistent payment event. | FR-DON-02 |
| File service | MIME/signature/size validation; private storage by default for operational documents; access check on read; approved public derivative separate. | FR-PUB-02/03 |
| Notification outbox | Template + locale + recipient + payload reference + dedupe key + retry state; delivery after business commit. | FR-NTF-01 |
| Reporting/export | Permission-filtered snapshot with period, source version and generated-at timestamp. | FR-FIN-07, FR-PUB-01 |

No service or route named here exists merely because it is specified. Exact API paths are a phase design decision; `/api/payments/webhook/{provider}` is a proposed shape.

## Functional service contracts

### Identity and authorization

- `authorize(user, permission, scope)` must query current active grants. Resolve inherited authority only through an explicit assignment or policy; reject missing, suspended or expired scope. A multi-role user may pass one permission without gaining permissions from unrelated roles (`FR-IDN-01`, `FR-CLB-03`).
- Account creation, invitation acceptance, email/contact verification and consent updates must be audited. Login/session claims are identifiers and navigation hints, not the final scope decision (`FR-IDN-02`).
- Existing `ADMIN`/`EDITOR` access must be mapped during migration and regression-tested. Do not remove the enum or existing guards until an approved compatibility path exists.

### Operations

- Club code is unique and immutable once referenced. Membership has requested/invited/active/rejected/suspended/ended states, actor and decision history. Enforce one active membership per volunteer and club. Historic rows are retained (`FR-CLB-*`).
- Project club assignment is a first-class row with coordinator, responsibilities, effective dates, status and a permission grant set. Assignment status controls current access but does not erase contribution history (`FR-CLB-03`).
- Project operational state is independent of `ContentStatus`. Completion requires reviewed milestones/tasks and explicit report/publication checks; do not infer completion from a date (`FR-PRJ-*`).
- Task changes require project/club scope, allowed transition and optimistic version. A volunteer may update only assigned work and fields granted by task policy. Dependency cycles and assignment to an unauthorized volunteer are rejected (`FR-TSK-*`).
- Attendance/service hours require event, person, interval/duration, source and reviewer. Duplicate attendance/service claims are rejected; corrected hours retain previous values in history (`FR-VOL-02`).

### Money and approvals

- Money values use a single exact representation selected with `D-01`; API payloads are decimal strings, never JavaScript floating-point values. Amount must be positive unless a defined reversal/refund operation. Currency and rounding are explicit (`FR-DON-*`, `FR-FIN-*`).
- Campaign publication checks an approved request, target/source documents, dates, privacy, public wording and policy. Approved and published are separate states (`FR-FND-02`).
- `confirmDonation(source)` is idempotent on a unique provider payment ID or manual verified source ID. In one transaction it locks/validates status, writes donation confirmation, allocation, balanced journal, receipt eligibility and immutable audit/outbox event. If posting fails, no confirmed balance or receipt is exposed (`FR-DON-02/03`, `FR-FIN-03`).
- Expense authorization checks policy, closed period, budget commitments, fund restriction and current available balance under concurrency control. Payment execution and ledger posting have independent evidence and states (`FR-FIN-04/05`).
- Approval decisions compare current instance version/status, eligible actor/scope, policy snapshot, separation rule and prior decision in one transaction. Decision history is append-only. `ANY` and `ALL` are evaluated per step; sequential steps cannot be skipped (`FR-APR-*`).
- Bank/provider reconciliation imports retain raw private source, normalized lines and import fingerprint. Match is reversible only through an audited correction; approval freezes the reconciliation result (`FR-FIN-06`).

## Data integrity requirements

| ID | Invariant and enforcement target |
| --- | --- |
| SRS-DI-01 | Primary/foreign keys and explicit deletion rules preserve history. Financial records use `Restrict`/soft closure, not cascading deletion. |
| SRS-DI-02 | Unique active membership, provider event ID, payment ID, journal source, receipt number and reconciliation import fingerprint prevent duplication. Use database constraints plus service checks. |
| SRS-DI-02a | Phase 6 offline-intake actions carry a unique submission key and request fingerprint. Replaying the same request returns its existing pending row; reusing its key with changed details is rejected. Provider event/payment idempotency remains future work because no webhook endpoint or event table exists. |
| SRS-DI-03 | Every posted journal has at least two lines and exactly equal debit/credit totals per currency. Post atomically; protect with database-level transaction/constraint strategy detailed before implementation. |
| SRS-DI-04 | A closed fiscal period rejects normal posting or edit. Reopening requires separate authority and audit (`D-01`, `D-03`). |
| SRS-DI-05 | Posted journals and decisions are immutable. Correction creates linked reversal/new rows; no hard deletion. |
| SRS-DI-06 | Fund/project/campaign dimensions persist on journal and allocation lines so reports can reconcile. |
| SRS-DI-07 | Confirmed/public totals derive from eligible confirmed donations and posted accounting, with explicit refund/dispute treatment. Never sum `PaymentIntent` or unverified manual entries. |
| SRS-DI-08 | Public document/verification eligibility requires a reachable approved public source. Media deletion is blocked while that source is required, or a separate approved unpublication transaction occurs. |

## Security and privacy requirements

Use least privilege at page, query, action and file boundaries. Existing origin checks and Auth.js protections must be verified for each new route; webhooks use provider authentication, not browser CSRF. Rate-limit registration, login, invitation, donation order, upload and exports appropriately. Validate URLs, file type and signature; scan or quarantine files if the selected deployment process requires it. Never place secrets, raw bank numbers, private donor details or unredacted files in public DTOs, shared cache, notification templates or client logs. Define retention and erasure exceptions for accounting records with counsel (`D-01`, `D-05`).

Structured errors use stable codes, safe localized user messages, request correlation IDs and server-side logs. Suggested code families: `VALIDATION_*`, `AUTH_*`, `SCOPE_*`, `STATE_*`, `CONFLICT_*`, `PAYMENT_*`, `LEDGER_*`, `PERIOD_*`, `RECON_*`, `FILE_*`, `UNAVAILABLE_*`. A duplicate idempotent request returns its original outcome; a conflicting request returns a conflict; an unknown provider state remains pending for investigation. Never blindly retry a non-idempotent payment or posting operation.

## Quality and operations

- Accessibility: keyboard operation, semantic labels, visible focus, understandable validation, contrast and reduced motion in every portal. Both English and Tamil UI paths must be checked at narrow and wide viewports.
- Performance: paginate private lists and audit logs; index scope/status/date/source fields; keep public read models cacheable while financial balances use fresh transactional reads. Set measurable latency and volume targets before performance sign-off, based on actual trust usage.
- Availability/recovery: define PostgreSQL and file backup frequency, retention, encryption, restore ownership, recovery point/time objectives and restore rehearsal before production finance use. These targets are not yet approved.
- Observability: structured error codes, provider delivery metrics, posting/reconciliation exceptions, outbox failures and audit access. Alert on unmatched payments, journal imbalance attempts and repeated webhook failures.
- Compatibility: migration must not change existing public route meanings, Project IDs/slugs, editor permissions or published data visibility without a separately approved change.

## Verification and release gates

Phase 3 implemented subset: existing-account self-onboarding requires versioned volunteer consent and adult self-attestation; no new account registration is created. Owner-only profile/availability/attendance/hour mutations check the live account. Attendance submission checks an active approved membership and active club. Approved attendance is required before hour submission; trust-admin review is independent of the maker, optimistic-version guarded and transactional. Only approved logs linked to approved attendance enter integer-minute totals. Correction voids reviewed records with immutable history; attendance void also voids its linked log. The partial unique database index prevents duplicate open attendance claims. Project attribution, certificate signing/issuance, external notification delivery and full Tamil portal copy remain outside this subset.

Test cases in `../testing/test.md` cover every `FR-*` family and `SRS-DI-*` invariant. Each phase records its actual test command, environment, result and evidence. Live checkout and verification remain disabled until accounting treatment, posting contract, provider selection/integration and sandbox cases are approved. No design text is evidence that a feature has shipped.
