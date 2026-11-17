import { ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityForm, FormSection } from "@/components/admin/entity-form";
import { BilingualHeader, TranslationProvider, TranslationSummary } from "@/components/admin/bilingual";
import { PageHeader } from "@/components/admin/page-header";
import { DeleteButton } from "@/components/admin/row-actions";
import { StatusBadge } from "@/components/admin/resource-table";
import { DemoBadge } from "@/components/admin/demo-badge";
import { RESOURCES, type ResourceKey } from "@/lib/admin-resources";
import type { ActionState } from "@/lib/action-state";
import { bulkAction } from "@/server/actions/admin/bulk";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Shared create/edit page frame: header, delete, live translation status,
 * a main column of content sections and an aside for publishing options.
 */
export function EditorFrame({
  resource,
  id,
  name,
  status,
  isDemo = false,
  publicHref,
  action,
  children,
  aside,
}: {
  resource: ResourceKey;
  id: string | null;
  name?: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  /** Fictional seed record (shows a DEMO DATA badge and notice). */
  isDemo?: boolean;
  publicHref?: string | null;
  action: Action;
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  const config = RESOURCES[resource];
  const isFaq = resource === "faqs";
  const content = (
    <>
      <PageHeader
        title={id ? (name ?? `Edit ${config.singular.toLowerCase()}`) : `New ${config.singular.toLowerCase()}`}
        description={id ? `Editing ${config.singular.toLowerCase()}` : undefined}
        backHref={config.href}
        backLabel={config.label}
        className={isFaq ? "mb-6" : undefined}
        rowClassName={isFaq ? "sm:items-center sm:gap-6" : undefined}
        titleClassName={isFaq ? "max-w-2xl break-words text-[1.75rem] leading-tight sm:text-3xl" : undefined}
        actions={
          id && (
            <>
              {isDemo && <DemoBadge />}
              {status && <StatusBadge status={status} />}
              {publicHref && status === "PUBLISHED" && (
                <Button asChild variant="outline" size="sm">
                  <a href={`/en${publicHref}`} target="_blank" rel="noreferrer">
                    View on site <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              )}
              <DeleteButton
                variant="button"
                itemName={`this ${config.singular.toLowerCase()}`}
                description="The record is removed permanently. Uploaded files remain in the Media library. Archive it instead to keep it on record."
                action={bulkAction.bind(null, resource, [id], "delete")}
                redirectTo={config.href}
              />
            </>
          )
        }
      />
      {isDemo && (
        isFaq ? (
          <div role="note" className="mb-6 flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/5 px-4 py-3.5 text-sm leading-relaxed">
            <Info className="mt-0.5 size-4 shrink-0 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]" aria-hidden="true" />
            <p><strong>Demo data.</strong> This is a fictional record created by the seed. Editing it does not make it official information, and{" "}
              <code className="text-xs">npm run db:demo:clear</code> removes it. Add official content as new records.</p>
          </div>
        ) : (
          <p role="note" className="mb-6 rounded-xl border border-dashed border-warning/60 bg-warning/10 p-3 text-sm">
            <strong>Demo data.</strong> This is a fictional record created by the seed. Editing it does not make it official information, and{" "}
            <code className="text-xs">npm run db:demo:clear</code> removes it. Add official content as new records.
          </p>
        )
      )}
      <TranslationProvider>
        <EntityForm
          action={action}
          submitLabel={id ? "Save changes" : `Create ${config.singular.toLowerCase()}`}
          cancelHref={config.href}
          successHref={id ? undefined : `${config.href}/{id}`}
          className={isFaq ? "space-y-5 pb-6" : undefined}
          inline={isFaq}
          footerClassName={isFaq ? "mx-0 rounded-2xl border border-border bg-card p-3 shadow-soft sm:p-4" : undefined}
          footerLeading={isFaq ? <p className="hidden text-sm text-muted-foreground sm:block">Review both languages before saving.</p> : undefined}
        >
          {isFaq && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/80 bg-card/80 px-4 py-3">
              <TranslationSummary />
              <p className="min-w-0 text-sm text-muted-foreground">English is the reference text. Tamil is entered by a person — it is never generated automatically.</p>
            </div>
          )}
          <div className={cn("grid gap-6", isFaq ? "items-start xl:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]" : "xl:grid-cols-[minmax(0,1fr)_19rem]")}>
            <div className="min-w-0 space-y-6">
              {!isFaq && (
                <div className="flex flex-wrap items-center gap-3">
                  <TranslationSummary />
                  <p className="text-xs text-muted-foreground">English is the reference text. Tamil is entered by a person — it is never generated automatically.</p>
                </div>
              )}
              {children}
            </div>
            <aside className={cn("space-y-6", isFaq && "min-w-0")}>{aside}</aside>
          </div>
        </EntityForm>
      </TranslationProvider>
    </>
  );
  return isFaq ? <div className="mx-auto w-full min-w-0 max-w-[72rem] pb-4 font-sans [&_h1]:font-sans [&_h2]:font-sans">{content}</div> : content;
}

/** A content section with the "English | தமிழ்" column header. */
export function BilingualSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <FormSection title={title} description={description} className={className}>
      <BilingualHeader />
      {children}
    </FormSection>
  );
}

export const PRIVACY_NOTE =
  "Never enter Aadhaar numbers, personal ID numbers, private phone numbers or home addresses. Only information the person has agreed to publish.";
