# Trustfolio application context for AI contributors

This guide describes the application as implemented in the repository. Read it before making a cross-cutting change. `README.md` explains the product and deployment; the files named below are the source of truth when behavior differs from documentation. Never treat seeded demonstration claims as facts about a real trust.

## What this application does

Trustfolio is a bilingual English/Tamil transparency website for a charitable trust. Visitors can browse the trust's identity, people, projects, activities, impact figures, supporting documents, reports, certificates, news, gallery, stories, and an Evidence Center. They can search published content and send a contact message. Authorized staff edit content at `/admin`; Phase 2 adds private club management and a scoped `/club` portal; Phase 3 adds private volunteer and review workflows; Phase 4 adds private project operations and task workflows on the existing `Project`; Phase 5 adds private fundraising planning drafts.

The product's central rule is that public claims should be traceable to inspectable sources. It has no runtime AI feature, model API, chatbot, embeddings, or automatic translation. English is the reference content. Tamil is entered or reviewed by a person; missing Tamil falls back to English with language/fallback UI.

## Stack and entry points

| Concern | Implementation |
| --- | --- |
| Web | Next.js 16.4.6 App Router, React 19, TypeScript, Tailwind CSS 4 |
| Database | PostgreSQL, Prisma 7 with `@prisma/adapter-pg`; schema in `prisma/schema.prisma`, migrations in `prisma/migrations/` |
| Authentication | Auth.js v5 credentials, bcrypt hashes, JWT session; `src/auth.ts`, `src/auth.config.ts` |
| File storage | Local filesystem or Vercel Blob; `src/lib/storage.ts` |
| Validation | Zod schemas in `src/lib/validations/` |
| Public UI | `src/app/[locale]/`, `src/components/` |
| Admin UI | `src/app/admin/`, `src/components/admin/` |
| Public reads | `src/server/queries/public/` |
| Admin reads and writes | `src/server/queries/admin.ts`, `src/server/actions/admin/` |
| Club operations | `src/server/clubs/service.ts`, `src/server/actions/admin/clubs.ts`, `src/server/actions/club/membership.ts` |
| Configuration | `.env.example`, `src/lib/env.ts`, `next.config.ts`, `prisma.config.ts` |

There is no custom application root page. `src/proxy.ts` negotiates `en` or `ta` from the locale cookie and `Accept-Language`, then redirects unprefixed public paths. `/admin` and `/club` are separate from locale routing. The proxy's admin cookie check is only a fast redirect; server authorization is performed again in page layouts, queries, actions, and API routes.

Before changing Next.js code, follow `AGENTS.md`: read the relevant guide under `node_modules/next/dist/docs/`. This version's APIs and conventions may differ from older Next.js versions.

## Public application map

All public page paths below have `/en` and `/ta` variants under `src/app/[locale]/`.

| Area | Routes | Main data source |
| --- | --- | --- |
| Home and identity | `/`, `/about`, `/trustees`, `/trustees/[slug]` | `public/trust.ts` |
| Work | `/projects`, `/projects/[slug]`, `/activities`, `/activities/[slug]` | `public/work.ts` |
| Outcomes | `/impact` | `public/impact.ts` |
| Evidence | `/verification`, `/verification/registration`, `/documents`, `/documents/[slug]`, `/reports`, `/reports/[slug]`, `/certificates` | `public/evidence.ts` |
| Media and updates | `/gallery`, `/gallery/[slug]`, `/news`, `/news/[slug]`, `/stories`, `/stories/[slug]` | `public/gallery.ts`, `public/news.ts`, `public/work.ts` |
| Interaction and policies | `/search`, `/contact`, `/privacy`, `/terms` | `public/search.ts`, `actions/contact.ts`, static pages |

Public queries normally select database rows, filter by publication and consent/visibility rules, then convert them to DTOs in `src/server/queries/public/types.ts`. Pages should use those DTOs instead of exposing raw Prisma records. `src/server/queries/public/shared.ts` provides the common `PUBLISHED`, public document filter, media conversion, references, and cache wrapper. `src/lib/view-models.ts` prepares data for interactive client components.

`src/lib/i18n/dictionaries/en.ts` and `ta.ts` contain interface strings. Database content uses paired `...En` and `...Ta` columns. `src/lib/i18n/localized.ts` resolves them, and `src/components/i18n/tx.tsx` renders fallback language cues. Locale path helpers live in `src/lib/i18n/paths.ts`.

SEO is built in `src/lib/seo.ts`, with `src/app/sitemap.ts`, `robots.ts`, the OG route, and per-page metadata. Structured data should describe only visible, supported content. The demo flag drives a visible banner and `noindex` behavior.

## Admin application map

The dashboard layout in `src/app/admin/(dashboard)/layout.tsx` calls `requireAdminPage()`. The generic list/new/edit routes under `[resource]` serve the content types enumerated by `src/lib/admin-resources.ts`: trustees, objectives, history, activities, projects, metrics, testimonials, stories, documents, reports, certificates, verification records, albums, news, and FAQs. Dedicated admin pages manage the trust profile, categories, media, contact messages, navigation, social links, settings, users, translations, and account.

`ADMIN` can manage identity, site settings, navigation, social links, and users. `EDITOR` can manage content. Page guards and mutation guards must both enforce this distinction; do not rely on hiding a UI control. `src/server/auth-guard.ts` checks the session's user ID against the current database row so deleting an account revokes access. `src/server/actions/admin-helpers.ts` wraps mutations, handles expected errors, records activity, and invalidates public cache tags.

Phase 2 adds `PORTAL_USER` accounts for the club portal. They are denied `/admin` pages and actions. `/admin/clubs` supports trust-admin club and membership operations; `/club` shows authenticated users their own memberships and active-club request forms. `/club/[id]` requires an active approved coordinator membership, matching club assignment, and an active club. Club membership never grants project access. Requests use an adult self-attestation and versioned data-use consent; trust admins make independent membership decisions. The Phase 1 financial/public-release approval engine remains draft-only and inactive.

Phase 3 adds `/volunteer` for signed-in existing accounts and `/admin/volunteers` for legacy `ADMIN` review. A volunteer profile needs adult self-attestation and versioned data-use consent. Owner-only actions manage profile, skill-sharing preference and availability. Attendance needs active approved club membership; hours need approved attendance. Trust-admin review cannot be self-review. An admin may void approved records with a reason; approved minute totals exclude voided/unreviewed logs and any attendance no longer approved. Club coordinators see only an active member's opted-in skills/interests in their own club. Private volunteer data has no public query or file route. Financial/public-release policies remain inactive.

Phase 4 adds `/admin/project-operations` for legacy `ADMIN` to plan work on the existing `Project`, appoint club assignment coordinators, create milestones/tasks and review submitted work. `Project.operationalStatus` and planning dates are private and separate from its public `status`, `phase` and dates. `/club/projects` lists only active assignments coordinated by the signed-in approved club member; each assignment grants task view and contribution reporting separately. `/volunteer/tasks` requires a current consented volunteer profile, active club membership and explicit active task assignment. Private task files use `private/project-task-evidence/` and a scoped read route; legacy editor media routes exclude that prefix. The public project query remains an allowlist of existing publication fields. No monetary budget, public operational report or payment flow was introduced.

Phase 5 adds `/admin/fundraising` for legacy `ADMIN` only. Multiple `DonationRequest` drafts may link the existing Project; each target is positive integer INR paise. One `DonationCampaign` planning draft may link each request, with separate private operational and publication states. Dedicated `private/donation-request-evidence/` uploads are excluded from editor media routes and read only by trust admins. Database checks keep requests and campaigns at DRAFT, approval/release FKs null and campaign publication DRAFT. No public campaign query, collection, finance posting or policy activation was introduced.

Phase 6 adds `/admin/donations` for legacy `ADMIN` only and `/donor` for signed-in accounts with a linked private donor profile. Donor profiles link existing `PORTAL_USER` accounts only and default to anonymous public display. ADMIN can record cash, bank transfer or UPI intake against a published non-demo project in exact INR paise; SQL constrains all entries to `PENDING_VERIFICATION`. Private evidence uses `private/donation-evidence/`, is excluded from editor media, and is read through an ADMIN-only route. Donors see only their own pending history; references, internal notes, evidence, and all donation amounts remain absent from public queries. The provider contract has a test-only HMAC mock, while live resolution throws. No online order/webhook endpoint, verification, receipt, refund, recurring payment, allocation, finance posting, or public fundraising totals exist yet. These require D-01/D-03/D-04 and Phase 7 approval.

Forms parse `FormData` using `src/lib/validations/admin.ts`; `src/server/actions/admin/{trust,work,evidence,media,settings,messages,bulk}.ts` perform the writes. The generic bulk action changes publication state for up to 200 IDs and has extra publication guards for consent, public documents, metrics, and verification records. When adding a new content type, update the schema, validation, action, admin resource/form, public DTO/query/page, cache tags, translation reporting, and demo tooling as applicable.

## Data model and relationships

`prisma/schema.prisma` is the canonical model. Important groups:

- Identity and access: `User`, `ActivityLog`, `RateLimit`, `ContactMessage`, Phase 1 approval and audit tables.
- Clubs: `Club`, `ClubMembership`, append-only `ClubMembershipHistory`, `ClubDocument`.
- Volunteers: `VolunteerProfile`, `VolunteerAvailability`, `VolunteerAttendance`, `VolunteerServiceLog` and append-only review histories.
- Trust identity: singleton `TrustProfile` and `SiteSetting` rows with ID `default`, plus `SocialLink`, `Trustee`, `TrustObjective`, `HistoryEvent`, `Faq`.
- Work and claims: `Category`, `Project`, `Activity`, `ImpactMetric`, `Testimonial`, `Story`, `NewsPost`.
- Evidence and media: `Media`, `Document`, `AnnualReport`, `Certificate`, `VerificationRecord`, `GalleryAlbum`, `GalleryImage`.

Content rows commonly have `DRAFT`, `PUBLISHED`, or `ARCHIVED` status, `publishedAt`, and `isDemo`. Projects can link activities, metrics, documents, testimonials, stories, albums, and verification records. Impact metrics can cite a document or report and include a counting method and period. Verification records can cite a document or external source. `Document` has separate public-file and private-original relationships. Foreign keys often use `onDelete: SetNull`, so deletion may preserve a published row while removing its source.

## Publication, privacy, and evidence invariants

Keep these rules aligned across form validation, bulk publication, public queries, and media deletion:

1. Trustees, testimonials, and stories need recorded consent before appearing publicly.
2. A public document containing personal data must be marked redacted, with the redacted copy in its public file slot. Unredacted originals are private media.
3. Public media conversion (`toMedia`) excludes private files. Private originals are served by `src/app/api/admin/media/[id]/file/route.ts` after admin authorization. Dedicated private club documents are uploaded under `private/club-documents/` and served by `src/app/api/club/documents/[id]/file/route.ts` after a fresh club-scope check; archived document links are unavailable. Legacy editor media lists and file reads exclude club-only files, and content editors cannot attach them as trust-document originals.
4. Published impact figures need a method, source document, or report. Their public UI must show the period and available evidence without implying unsupported verification.
5. Verification entries need a document or external source. A source is useful to visitors only if its linked document is itself public, published, and accessible.
6. Placeholder text containing `[Content pending official information]` is treated as missing by `real()` in `public/trust.ts`.
7. Demo data is fictional. Do not convert demo claims into official claims or infer that `isDemo` means verified. Make the demo banner and indexing behavior reflect every publicly visible demo record.

Uploads enter through authenticated `src/app/api/admin/upload/route.ts`, which checks origin, size, MIME type and file signature. `src/lib/storage.ts` writes public and private files to separate local directories or Blob access levels. `src/app/uploads/[...path]/route.ts` serves local public files. `src/app/api/admin/media/route.ts` lists media for admin pickers. Contact messages go through `src/server/actions/contact.ts` with validation, a honeypot, a fill-time check, Postgres-backed rate limits, persistence, and optional Resend notification.

## Caching and change propagation

Public reads use the `cached()` wrapper in `public/shared.ts` (`unstable_cache` plus request memoization), keyed by `CACHE_TAGS` in `src/lib/constants.ts`; the safety revalidation is one day. Admin actions call `expire()` in `admin-helpers.ts` to run `updateTag()` and refresh the current view. Changes made directly in the database or through seed scripts do not trigger that path; use the admin dashboard's **Refresh public website** action (`admin/cache.ts`) or wait for revalidation. When modifying a query's dependencies, check that every mutation affecting it invalidates its tags.

## Seed, configuration, and checks

`prisma/seed.ts` creates an admin account from environment variables, placeholder identity/settings rows, and categories. Outside production it also seeds a clearly fictional dataset unless `SEED_DEMO=false`; production skips demo by default. `prisma/demo/seed-demo.ts`, `scripts/seed-demo.ts`, `scripts/clear-demo.ts`, and `scripts/audit-demo.ts` manage and inspect demo content. Read `.env.example` for variable names; never copy actual `.env` values into documentation or AI output.

Useful commands: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run db:deploy`, `npm run test:approval`, `npm run test:approval:db`, `npm run test:approval:headed`, `npm run test:club:db`, `npm run test:club:headed`, `npm run test:volunteer:db`, `npm run test:volunteer:headed`, `npm run test:project:db`, `npm run test:project:headed`, `npm run test:fundraising`, `npm run test:fundraising:db`, `npm run test:fundraising:headed`, and `npm run db:audit-demo` after seeding demo data. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`. Headed scripts use system Chrome and disposable local PostgreSQL schemas. The build fetches Newsreader and Noto Tamil fonts through `next/font/google`; an offline build may fail at font fetching before application compilation completes.

## November 2026 safeguard update

Published public documents now require a public media file. Media deletion rejects a file used by a published public document. Verification publication and public coverage require an inspectable public document or an external URL; registration coverage does not treat a bare registration number as inspectable evidence. Demo status includes all public content models and suppresses Organization structured data when any demo content is visible. These checks do not prove that external URLs or storage provider objects remain reachable.

## Known gaps verified in the October 2026 audit (historical)

These are current behavior, not intended product rules. Recheck the implementation before relying on this list.

1. `deleteMedia()` in `src/server/actions/admin/media.ts` can delete a public file used by a published document. The relation becomes null, yet `PUBLIC_DOCUMENT_WHERE` and evidence coverage still count the document because they do not require an accessible file.
2. A verification record can be published with a private or draft document as its only source. `toVerification()` suppresses the unusable public link, while `getEvidenceCoverage()` still counts the record. Registration coverage also counts a registration number without requiring an inspectable source.
3. `getDemoStatus()` in `public/trust.ts` checks only some demo content models. If only an omitted published model remains, the banner and `noindex` state can turn off. `organizationJsonLd()` checks only the trust profile's demo flag.

These were the Phase 1 audit findings and were addressed in the November safeguard update above. Phase-specific checks in `docs/testing/test.md` do not constitute full production readiness.
