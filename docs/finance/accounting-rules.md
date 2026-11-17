# Trustfolio accounting and posting rules

Status: **proposed control design, not approved accounting policy or implemented ledger**. Updated: 2026-10-25. A qualified accountant for the trust must approve jurisdiction, fiscal year, accounting basis, chart, receipt/tax treatment and reports (`D-01`), plus fund policy (`D-02`), before live collection. This file makes no legal-compliance claim.

Phase 7 implementation scope, proposed services/models/UI and the approval gate are in `phase7-ledger-design.md`. That packet is also design only and selects no accounting policy.

## Decisions and source hierarchy

Phase 5 donation-request targets are **planning amounts only**, stored as exact integer INR paise. A request or campaign draft has no cash, receivable, fund balance, confirmed collection, journal or receipt effect. Do not treat its target as a posted budget or donation. Live fundraising approval/publication and collection remain closed; D-01/D-02 accounting decisions still precede any Phase 6 payment activation.

The Phase 6 intake slice records ADMIN-entered cash/bank/UPI entries as `PENDING_VERIFICATION`, with positive INR paise amounts and private source evidence. These are operational intake claims only: they are excluded from confirmed collections, available/posted balances, receipts, allocations, budgets, and public figures. The schema currently has no other donation status, allocation, payment event, receipt, or journal model. The mock provider is test-only and creates no application donation or financial effect. Verification and live provider activation remain closed until D-01 through D-04 and the Phase 7 posting contract are approved.

`D-01` must specify legal entity/jurisdiction, functional and accepted currencies, fiscal year, cash/accrual recognition, rounding/precision, donor receipt numbering and corrections, chart, report definitions, retention and statutory requirements. `D-02` must specify general/restricted/designated fund rules, unallocated gifts, shared expenses, transfers, surplus and refunds. `D-03` sets authority for posting, payment, period close and reversal. `D-04` sets gateway fees, settlement delays, chargebacks and recurring behavior. Until these are signed off, the examples below are control patterns only.

The hierarchy is: verified source event → authorized business state → fund allocation → balanced posted journal → reconciliation → internal statements → separately approved public aggregate. A payment provider dashboard is evidence, not the general ledger.

## Decision worksheet for the Phase 7 gate

Complete this worksheet with the accountant-approved policy and any required trustee resolution attached. An unanswered field remains unapproved; it must not be filled from the demo dataset or an engineering assumption.

### D-01 — accounting basis and calendar (qualified accountant approval)

- Legal trust/entity name and jurisdiction:
- Functional currency and any accepted transaction currencies:
- Fiscal year start and end dates; treatment of a shortened/transition year:
- Accounting basis and recognition event for donations, pledges, expenses and refunds:
- Currency precision, rounding method and conversion-rate source if multiple currencies are accepted:
- Required internal statements and their definitions:
- Donation receipt numbering, required text, tax/statutory representations, correction and void process:
- Records retention periods and required deletion/hold exceptions:
- Accountant name/qualification, approval date and attached policy/reference:

### D-02 — fund and restriction rules (qualified accountant approval)

- Permitted fund categories and definitions:
- Evidence that creates a donor restriction and who may interpret it:
- Treatment of gifts with no designation or an invalid/unavailable designation:
- Whether and how project/campaign funds can transfer, including required approvals:
- Shared-cost allocation method and supporting evidence:
- Treatment of unspent surplus at project/campaign close:
- Refund, chargeback and disputed-payment allocation rules:
- Treatment of commitments and holds when calculating available funds:
- Approving accountant, approval date and attached policy/reference; any required trustee resolution:

### D-03 — authority assignments (trustee approval)

Draft-engine-only is already approved: policies remain inactive until separately authorized, missing policies fail closed, and the trust-admin role does not bypass financial approval. The proposed role groups are not real grants. Complete the following before activating any financial policy:

| Operation | Authorized account IDs | Maker group(s) | Reviewer/approver group(s) and ANY/ALL/order | Amount bands and currency | Payment executor | Poster | Reconciler | Self-approval/delegation limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Donation request approval |  |  |  |  | N/A |  | N/A |  |
| Campaign/public financial release |  |  |  |  | N/A | N/A | N/A |  |
| Manual donation verification |  |  |  |  | N/A |  |  |  |
| Expense request and payment |  |  |  |  |  |  |  |  |
| Refund/chargeback |  |  |  |  |  |  |  |  |
| Journal reversal |  |  |  |  | N/A |  |  |  |
| Period close/reopen |  |  |  |  | N/A |  |  |  |
| Bank/provider reconciliation |  |  |  |  | N/A | N/A |  |  |

- Delegation scope, expiry, revocation and audit requirements:
- Trustee resolution naming the authorized account holders, approval date and reference:

### Opening state — accountant-approved evidence package

- Effective opening date and reporting book/currency:
- Signed opening trial balance by account and fund dimensions:
- Bank/cash statements and reconciliation as of the opening date:
- Outstanding payables, receivables, restricted balances and commitments included:
- Source documents, reviewer and approval date:
- Any known exceptions, transition items or balances excluded:

The engineering gate remains closed until applicable fields have written approval and evidence. Providing this worksheet does not itself activate policies, seed balances, enable payment collection or authorize a migration.

## Chart and dimensions

Minimum account classes: asset, liability, fund balance/net asset, income and expense. Proposed control accounts include cash on hand, each bank account, provider clearing/receivable, donor/other receivable if policy requires, payables, donation income, gateway fees, program expenses, and fund balance accounts. Final codes and recognition belong to the approved chart. Journal lines carry account, fund, project, campaign, currency, source and period as applicable; dimensions are not reconstructed from mutable campaign names.

Funds may be general, donor-restricted project, donor-restricted campaign, board-designated or another approved category. Store restriction terms and approval source. **Opening balance is a posted, evidence-backed opening journal**, not an editable `Fund.balance`. Define:

- `posted balance`: signed sum of eligible posted journal lines by fund and period;
- `commitments`: approved outstanding spending reservations, recorded and releasable with history;
- `available balance`: policy-defined spendable posted balance less commitments and holds;
- `public collected`: confirmed eligible donations less policy-defined refunds/chargebacks, not an alias for cash in bank.

The signs and report presentation are fixed by the approved chart, not by a UI formula. Never sum different currencies without an approved conversion and rate source.

## Posting contract

`post(sourceType, sourceId, journalDraft, actor, idempotencyKey)` must run in one database transaction with appropriate isolation/locks:

1. Re-check current authorization, approval evidence, source state, period, fund restriction and unique source key.
2. Validate exact positive amounts, currency consistency, at least two lines, valid posting accounts and equal debit/credit totals.
3. Lock or otherwise serialize availability/commitment checks where concurrent operations could overspend.
4. Insert journal header and lines, transition the source, consume/release commitment as applicable, and append audit/outbox event atomically.
5. Return the same journal for a repeated identical idempotency key; reject a conflicting payload. A timeout requires status lookup, not automatic blind retry.

A database-level strategy must enforce or verify balance at commit, since application-only checks can be bypassed by direct writes. Posted journals are immutable. Correction creates a linked full/partial reversal and a replacement if needed, under authorized policy. Closed periods reject ordinary posting; an approved adjustment period/reopening policy remains `D-01`/`D-03`.

## Event-to-ledger mapping for accountant approval

The following illustrates control-account movement and is **not** a final account/tax policy.

| Source event | Provisional accounting shape | Must not occur until |
| --- | --- | --- |
| Online payment verified | Debit provider clearing or bank; credit applicable donation income/fund dimension. | Authentic event and status, unique provider payment, fund allocation, posting contract approval. |
| Manual cash verified | Debit cash on hand; credit applicable donation income/fund dimension. | Distinct checker, evidence and amount verification. |
| Manual bank/UPI verified | Debit bank or bank-clearing account; credit donation income/fund dimension. | Reference validation and reconciliation rule. |
| Gateway settlement | Debit bank, debit fee expense where applicable; credit provider clearing for gross amount. | Matched settlement and approved fee treatment. |
| Approved expense paid | Debit program/administrative expense with fund/project; credit bank/cash or payable as recognition policy directs. | Approved request, available fund/budget, payment evidence. |
| Refund/chargeback | Reverse or offset original income/cash/clearing and fund allocation according to approved policy. | Provider/bank evidence and authorization. |
| Transfer between funds | Balanced, linked journal preserving both fund dimensions. | `D-02` allows transfer and required approval exists. |

Failed and pending payments produce no confirmed donation or income journal. A disputed transaction is explicitly flagged and held from public totals according to approved policy; its accounting treatment must be set with the accountant. Partial refunds cannot exceed the confirmed net amount across concurrent requests.

## Budget, commitment and expense controls

Budget versions are approved per fiscal period/project/fund/category. Revisions create a new version and preserve the former approved plan. An expense request reserves a commitment only at the policy-defined point; return/rejection/cancellation releases it in an audited transaction. Check both remaining budget and unrestricted/restricted fund availability. A budget does not create cash. A positive budget variance is not permission to spend restricted money. A successful approval does not prove payment; a payment does not prove reconciliation. Duplicate invoices and payment references are flagged and reviewed.

## Reconciliation and statements

Keep original private bank/provider statements, import fingerprint, normalized lines, matches, reviewer and exceptions. Imports are idempotent. Reconcile provider gross payments, fees, refunds and net settlement to bank lines and clearing balances. Bank reconciliation reports opening balance, posted movements, outstanding items, statement closing balance and unresolved difference. Approval freezes a version; corrections are separately audited.

All reports select posted journals within an explicit period and books/currency scope. Trial balance must net to zero; general ledger ties to it; fund statement ties to fund dimensions; donation register ties to confirmed donation source keys and receipts; campaign utilization ties allocation and expense dimensions; budget-vs-actual separates commitments and actual posted expense. Authorized exports include generation timestamp, filters and report version. Public figures use a separately approved disclosure snapshot (`D-06`) and suppress donor, bank and internal-note fields.

## Receipt and period controls

One confirmed donation is eligible for a receipt under `D-01` policy. Receipt sequence, issue date, organization wording, tax representations, reissue/void behavior and guest-donor handling require accountant/legal confirmation. Receipt snapshots are immutable; a correction voids and reissues with links. Period close requires reconciled control accounts and an exception list, followed by approval under `D-03`. Backup and restore are rehearsed before first live posting.

## Required financial tests

The test plan (`../testing/test.md`) covers equal debits/credits, duplicate sources/webhooks, closed periods, concurrent restricted spending, partial refunds, reversals, settlement differences, budget commitments, donor-receipt matching and report tie-outs. No live gateway may be enabled before sandbox and transaction tests pass against approved posting rules.
