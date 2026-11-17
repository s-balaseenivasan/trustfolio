# Phase 7 finance and ledger design

Status: **design packet; policy-neutral journal and chart validation helpers exist, but no finance schema or posting code is implemented or approved**. Prepared 2026-10-26 for review. This packet builds on `accounting-rules.md`, the current Prisma schema, and the existing Phase 1 approval/audit foundation. It does not select accounting policy or claim statutory compliance.

## 1. Scope and dependency boundary

Phase 7 is expected to implement the chart of accounts, funds, fiscal periods, budgets, expense authorization, double-entry journals, posting/reversal contracts and internal financial reports. Bank/provider reconciliation and public financial summaries remain Phase 8. Live donation collection remains disabled until a posting contract is approved and tested.

The current Phase 6 donation model stores only private offline intake as `PENDING_VERIFICATION`. It has no allocation, confirmed state, receipt, payment transaction or journal relation. Phase 7 must not infer confirmed money from those pending rows. A later approved migration must connect a separately verified source to an approved posting contract.

Prerequisites before implementation:

- `D-01`: written entity/jurisdiction, accounting basis, fiscal calendar, functional/accepted currencies, recognition, precision, receipt/tax treatment, retention and reporting policy approved by the trust's qualified accountant.
- `D-02`: written fund/restriction rules covering general, donor-restricted, designated and other funds; unallocated gifts; shared costs; transfers; surplus; refunds and chargebacks.
- `D-03`: approved actor/group assignments, approval thresholds, maker/checker separation, payment execution, journal posting, period close/reopen, reversal and delegation policy. Draft policies stay inactive until separately authorized.
- Read-only inventory of the target database, source evidence, opening balances and restoration capability before migration. No historic impact metric or demo donation is an opening balance.

## 2. Technical invariants independent of policy

These are implementation invariants, not a substitute for accountant approval:

1. Money uses integer minor units or an approved exact decimal type; never binary floating point. Every amount carries a currency code and its precision comes from the approved currency policy.
2. Every posted journal has at least two lines and equal debit/credit totals per currency/book. The database commit boundary must enforce or verify balance; the UI cannot be the only check.
3. A post is atomic: source transition, unique journal source, journal lines, audit event and any outbox event commit together or not at all.
4. Posted entries and their lines are immutable. A correction is a linked full/partial reversal plus a replacement where required; never edit or delete a posted journal.
5. Every posting retains stable source identity, actor, time, policy/approval reference, period and relevant project/fund/campaign dimensions.
6. Closed periods reject ordinary posting. Reopen/adjustment behavior requires explicit `D-01`/`D-03` policy.
7. Retry of the same idempotency key and same payload returns the existing result. Reuse with a different payload fails. Do not automatically retry a non-idempotent payment or journal operation.
8. Concurrent commitments and spending serialize against fund/budget availability. A successful approval is not proof of payment or posting.
9. Balances are derived from posted journal lines, never stored as editable authoritative totals.
10. All finance reads are private, permission-scoped and uncached unless a separately approved immutable disclosure snapshot is introduced.

### Policy-neutral prototype

`src/lib/finance/journal-core.ts` implements only pure checks for integer minor-unit lines, one currency per journal, equal debit/credit totals, deterministic payload fingerprints, and full reversal line swapping. Reversal period/date must be supplied explicitly. `src/lib/finance/chart.ts` checks non-empty unique account codes, supported broad account classes, existing parent references and an acyclic hierarchy. It does not assign account codes, normal sides, postability, or trust-specific chart semantics. These helpers have no database writes, authorization, fiscal-calendar behavior or posting action. `npm.cmd run test:finance-core` covers seven unit cases; these tests do not count as full `T-FIN-*` acceptance.

## 3. Proposed logical data model

These logical entities require review against the final accounting policy before a migration is written. Reuse existing `User`, `Project`, `Donation`, `ApprovalInstance`, `AuditEvent` and `NotificationOutbox` relations; do not create another project or approval system.

| Entity | Proposed fields/relationships | Constraints to implement after policy approval |
| --- | --- | --- |
| `LedgerAccount` | Account code, name, class (asset/liability/net assets/income/expense), normal side, optional parent, active/postable flags, effective dates. | Unique code per book; no parent cycles; inactive/non-postable accounts reject new lines; referenced posted lines restrict deletion. |
| `Fund` | Code, approved fund type, restriction text/source, active dates, optional project/campaign scope, status. | Unique code; restriction/scope combinations validated; no editable balance; posted lines retain fund reference. |
| `FiscalPeriod` | Fiscal-year/book/currency identifier, start/end, open/closed state, close actor/time/version. | Non-overlapping ranges per book/currency; journal date must belong to period; closed period blocks ordinary post. |
| `Budget` / `BudgetLine` | Fiscal scope, project/fund/account or category dimensions, version, requested/approved state, exact amount and revision history. | One approved current version per approved scope; revisions preserve prior versions; currency and period match. |
| `ExpenseRequest` / `ExpenseLine` | Maker, vendor/payee, purpose, project/fund, invoice evidence, lines, amount, approval snapshot and state/version. | Exact totals; duplicate invoice/reference detection; fund/budget checks; no self-approval where policy prohibits. |
| `ExpensePayment` | Authorized payment source/reference, executor, date, amount, evidence and posting relation. | Unique execution reference; payment is distinct from approval and journal posting; no payment without required authorization. |
| `JournalEntry` | Source type/id, currency/book, fiscal period, effective date, state, idempotency key/payload fingerprint, maker/poster, approval reference, reversal link, private memo. | Unique source posting key and idempotency key; `POSTED` immutable; period/source/approval must be eligible. |
| `JournalLine` | Entry, sequence, account, debit/credit minor units, fund, project/campaign dimensions, optional counterparty/reference. | Exactly one of debit/credit positive; consistent currency; account/fund eligibility; balanced entry enforced at commit. |
| Opening balance source | Evidence-backed opening journal only; do not add mutable `Fund.openingBalance`. | Each opening journal has explicit source/date/approver and reconciles to accountant-approved schedule. |

Receipt numbering/content, donation allocations, payment transaction links and bank/provider settlement lines remain separate policy-dependent models. Do not add speculative tax fields or statutory representations before written review.

## 4. Service contracts

Proposed server-only operations:

- `createJournalDraft(source, lines, actor)` validates shape and creates an unposted versioned draft only.
- `validateJournalDraft(id, actor)` rechecks account/fund/project/period permissions, exact line totals, dimensions, source state and active policy.
- `postJournal(id, expectedVersion, actor, idempotencyKey)` executes the transaction/locking contract above, rechecks approval and source, writes journal plus audit/outbox atomically, and returns the existing result for an identical replay.
- `reverseJournal(id, amountOrLines, reason, actor, approval)` creates an immutable linked reversal and never changes the original.
- `closeFiscalPeriod(id, expectedVersion, actor, approval)` checks outstanding drafts, unreconciled control accounts and exceptions, then freezes ordinary posting.
- `reviseBudget(id, expectedVersion, lines, actor)` creates a new version with an approval requirement; it never overwrites an approved version.
- `submitExpense`, `approveExpense`, `authorizePayment`, `recordPayment`, and `postExpense` remain separate transitions. Their exact order and authority must follow `D-02`/`D-03`.

All commands must use current identity from the database, server-side scope checks, Zod validation, optimistic versions and structured safe errors. Financial policy absence or an inactive policy fails closed.

## 5. Workflows and interfaces

### Donation posting integration (future, after Phase 6 provider and Phase 7 accounting gates)

Provider/manual source verified → approved allocation policy → balanced journal draft → independent authorization if required → atomic post → receipt eligibility only under approved receipt policy → Phase 8 reconciliation. Pending or failed payment/intake remains outside posting and reports.

### Expense lifecycle

Expense draft with invoice/vendor/project/fund → budget and restriction check → approval steps → payment authorization → separately recorded payment evidence → balanced journal post → Phase 8 reconciliation. A returned/rejected/cancelled request releases any policy-defined commitment with history.

### Period lifecycle

Open period accepts only authorized dates/sources → finance close checklist and reconciliation exceptions → independent close authorization → period becomes immutable for ordinary posts. Adjustment/reopen rules require explicit policy.

### Proposed UI

- `/admin/finance/accounts`: chart tree, code/class/status and usage; no deletion of referenced accounts.
- `/admin/finance/funds`: fund restrictions, scope, available/committed values derived from posted entries, and source evidence.
- `/admin/finance/periods`: dates, open/closed state, close checklist and exception links.
- `/admin/finance/budgets`: versioned project/fund budgets, commitments, actual posted expense and variance.
- `/admin/finance/expenses`: maker queue, approval state, invoice/evidence, authorized payment and posting states shown separately.
- `/admin/finance/journals`: draft review, balanced totals, source/approval/period, post and reversal history.
- `/admin/finance/reports`: general ledger, trial balance, cashbook/bankbook, receipts/payments, income/expenditure, balance sheet, fund balances, project statement and budget-vs-actual after definitions are approved.

Every page is ADMIN/explicit-finance-grant only. Existing content roles do not inherit finance grants. Auditor access is read-only. No client receives bank secrets or private donor fields.

## 6. Acceptance and test plan

Required before any live posting: unit tests for exact amounts and line validation; isolated PostgreSQL tests for transactional balancing, source uniqueness, rollback, immutability, reversals and period constraints; permission and self-approval tests; concurrency tests for idempotent posts and restricted-fund/budget overspend; expense maker/checker/payment separation; report tie-outs; headed Chrome tests for each authorized portal; and accountant-reviewed sample statements. Full cases are tracked in `../testing/test.md` (`T-FIN-*`).

Migration must be additive and tested against a disposable schema first. No opening journals, chart seed, funds, budgets or expenses are populated until an approved accountant schedule exists. Rollback disables new finance writes and keeps history; posted records are corrected only by approved reversals. Destructive migration, database reset and schema rollback by dropping financial tables are excluded.

## 7. Decisions required before implementation

| Decision | Information needed | Why it changes schema/behavior | If deferred |
| --- | --- | --- | --- |
| D-01 accounting basis and calendar | Legal entity/jurisdiction; qualified accountant; functional and accepted currencies; fiscal-year dates; cash/accrual recognition; rounding; report definitions; retention; receipt numbering/content/correction; statutory wording. | Period model, currency precision, recognition event, reports, receipt and retention rules. | Keep finance schema/posting code and live donations disabled. |
| D-02 fund rules | Allowed fund types; restriction source and text; unallocated/mismatched gifts; transfers; shared costs; project/campaign scope; surplus and refund/chargeback allocation. | Fund dimensions, availability formulas, eligible expense rules and refund postings. | No fund allocation, fund balance, expense payment or utilization claim. |
| D-03 authority | Named current account IDs for each group; per-operation amount bands and currency; separation of maker/checker/payment executor/poster/reconciler; self-approval exclusions; delegation duration; close/reopen/reversal authority. | Approval configuration and server permission checks for every money-moving transition. | All finance transitions fail closed; no real approval assignments are created. |
| Opening state | Accountant-signed opening trial balance, bank/cash statements, date, evidence and approver. | Determines opening journal rows; none may be inferred from existing impact/project metrics. | New ledger starts without opening balances and cannot be treated as complete books. |

Recommended process: have the trust's qualified accountant provide or approve the written D-01/D-02 policy and opening schedule, then the trustees authorize D-03 assignments and thresholds. Technical implementation should start only after those concrete decisions are attached to this packet. No legal or accounting conclusion is inferred by this design.
