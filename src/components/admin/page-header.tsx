import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
  className,
  rowClassName,
  titleClassName,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
  rowClassName?: string;
  titleClassName?: string;
}) {
  return (
    <div className={cn("mb-8", className)}>
      {backHref && (
        <Link
          prefetch={false}
          href={backHref}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" /> {backLabel}
        </Link>
      )}
      <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", rowClassName)}>
        <div className={cn(titleClassName && "min-w-0")}>
          <h1 className={cn("text-2xl font-semibold tracking-tight", titleClassName)}>{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Rounded container for admin tables with a consistent look. */
export function DataCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">{children}</div>;
}
