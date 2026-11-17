import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border bg-card px-6 py-12 text-center shadow-soft",
        className,
      )}
    >
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="font-display text-xl leading-tight">{title}</p>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
