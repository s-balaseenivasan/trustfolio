# Trustfolio — Application Architecture

Phase 1 output. Static analysis only; **not a git repository**, so no history-based evidence exists
anywhere in this report.

Single deployable unit, no monorepo tooling (`package.json`, no `workspaces` /
`pnpm-workspace.yaml` / `turbo.json` / `nx.json`).

## Technology

| Layer | Technology | Version | Evidence |
|---|---|---|---|
| Framework | Next.js, App Router | 16.4.6 | `package.json:57` |
| UI | React / React DOM | 19.2.8 | `package.json:62-63` |
| Language | TypeScript | ^5 | `package.json:85`, `tsconfig.json` |
| Styling | Tailwind CSS | ^4 | `package.json:73,82` |
| ORM | Prisma + `@prisma/adapter-pg` | ^7.10.0 | `package.json:47-48`, `src/lib/db.ts:2-17` |
| Database | PostgreSQL via `pg` | ^8.23.0 | `package.json:60`, `.github/workflows/check.yml:11` (postgres:18) |
| Auth | Auth.js (NextAuth) v5 beta, Credentials + bcrypt + JWT | ^5.0.0-beta.32 | `package.json:58`, `src/auth.ts:1-40` |
| File storage | Local filesystem **or** Vercel Blob | ^2.9.0 | `src/lib/storage.ts:1-114` |
| Email | Resend HTTP API (raw `fetch`, no SDK) | — | `src/lib/email.ts:1-31` |
| Validation | Zod | ^4.6.7 | `package.json:69`, `src/lib/validations/*` |
| Tests | `node:test` via `tsx --test`; Playwright used programmatically | — | `package.json:11,16-31` |
| CI | GitHub Actions | — | `.github/workflows/check.yml` |

No OpenAPI / Swagger / `.proto` / GraphQL SDL / Postman artifacts. The only declared API surface is
the code itself, so "declared vs implemented" drift analysis is moot here.

## Structure

```
src/app/              route tree (public [locale], admin, club, volunteer, donor, api, uploads)
src/server/           business logic — module seams below
src/lib/              validation, i18n, storage, env, helpers
src/components/       React UI (162 .tsx)
src/generated/prisma  generated client — not hand-written
prisma/               schema.prisma (63 models), 7 migrations
scripts/              tsx-run DB/UI verification harnesses
```

## Data stores

| Store | Confidence | Evidence |
|---|---|---|
| PostgreSQL via Prisma 7 | **Confirmed by reading** | `src/lib/db.ts:2-17`, `prisma/schema.prisma` (63 models), 7 migrations |
| Postgres-backed rate limiter (`RateLimit` table, raw SQL upsert) | Confirmed | `src/lib/rate-limit.ts:17-30` |
| Local filesystem (`./uploads`, `./private-uploads`) | Confirmed, default driver | `src/lib/storage.ts:34-35,61-84` |
| Vercel Blob | Coded path; **REQUIRES_VERIFICATION** — selected by `STORAGE_DRIVER` at runtime | `src/lib/storage.ts:5,67-76,89-91` |
| Redis / queue / search index / broker | Not present | grep returned nothing outside `rate-limit.ts` |

## External integrations

- **Resend** — transactional email over HTTP. Fails soft, returns `false` when
  `RESEND_API_KEY`/`EMAIL_FROM` are unset (`src/lib/email.ts:16-21`).
- **Vercel Blob** — see above.
- **No payment provider is live.** `getLiveDonationProvider()` always throws
  `PaymentUnavailableError` (`src/server/payments/provider.ts:17-19`); only `MockSandboxProvider`
  exists and is explicitly rejected when `NODE_ENV === "production"` (`provider.ts:22-24`).
  Confirmed inert **by design**, not an oversight.

## Entry points

**12 API routes**, all guarded (see `qa/architecture/role-permission-matrix.md`).
**19 server-action modules** (`"use server"`) — these are mutation entry points with no URL, and
must be audited as entry points even though they do not appear in any route table:

```
src/server/actions/admin/{approvals,bulk,cache,clubs,donations,evidence,fundraising,media,
  messages,project-operations,settings,trust,volunteers,work}.ts
src/server/actions/{auth,contact}.ts
src/server/actions/club/membership.ts
src/server/actions/projects/tasks.ts
src/server/actions/volunteer/records.ts
```

**Web guards.** `src/proxy.ts:13-37` does locale negotiation and an *optimistic* admin-login
redirect based on cookie presence only — documented as UX-only (`proxy.ts:6-9`). Notably
`/club`, `/volunteer` and `/donor` are **excluded from the proxy's session check entirely**
(`proxy.ts:27`), relying wholly on a per-page `getAdminUser()` call with no shared layout guard
(`src/app/club/[id]/page.tsx:12-13`, `src/app/volunteer/tasks/page.tsx:9-10`,
`src/app/donor/page.tsx:12-13`). `/admin` by contrast has a layout guard
(`src/app/admin/(dashboard)/layout.tsx:14`).

## Caching

Public reads wrap `unstable_cache` keyed by `CACHE_TAGS`; admin mutations call `expire()` →
`updateTag()` + `refresh()` (`src/server/actions/admin-helpers.ts:87-90`). Direct DB and seed
writes bypass invalidation — a documented gap (`APPLICATION_CONTEXT.md:97`).

## Background work — gap

`NotificationOutbox` rows are **created** by `clubs/service.ts`, `volunteers/service.ts`,
`projects/service.ts` and `approval/foundation.ts`, but the only reader is a display list on
`src/app/admin/(dashboard)/approvals/page.tsx:20` (`findMany`, `take: 10`). No cron, consumer or
sender transitions a row from `PENDING` to `SENT`/`FAILED`. **The outbox is write-and-display only;
no notification delivery exists.** Raised as finding QA-NOTIFY-007.

## Unknowns and limitations

1. No git history — all evidence is current-state only.
2. Vercel Blob runtime use is environment-dependent and was not verified (env values not read).
3. Public-query evidence-coverage gaps listed in `APPLICATION_CONTEXT.md:109-117` were **not**
   independently re-verified this pass; the document itself says to recheck before relying on them.
4. Admin publication guards (consent, redacted-document rule, impact-metric evidence) were not
   line-traced in `src/lib/validations/admin.ts` — deferred to later phases.
5. No tests were executed by this phase; see `qa/reports/mechanical-analysis.json` for the run that
   did execute them.
6. `discover.mjs` reported Playwright but missed the 19 `scripts/verify-*.ts` harnesses, because
   they call `@playwright/test`'s `chromium` API directly rather than the `playwright test` runner.
   Treated as a scanner limitation, recorded in the test inventory.
