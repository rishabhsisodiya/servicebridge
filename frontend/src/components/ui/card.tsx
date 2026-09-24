import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={cn("min-w-0 rounded-xl border border-line bg-surface shadow-sm", className)}
      {...rest}
    />
  );
}

interface CardHeaderProps {
  title: ReactNode;
  /** Heading id, so the card can be labelled by its title. */
  titleId?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, titleId, meta, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3",
        className,
      )}
    >
      <h2 id={titleId} className="text-[15px] font-semibold">
        {title}
      </h2>
      {meta && <span className="text-xs text-muted">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-3.5", className)} {...rest} />;
}
