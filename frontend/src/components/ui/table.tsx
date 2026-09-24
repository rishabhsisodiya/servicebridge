import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Wide tables scroll inside their own container; the page never scrolls sideways. */
export function Table({
  className,
  caption,
  children,
}: {
  className?: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, align, ...rest }: ComponentProps<"th"> & { align?: "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line bg-surface px-3.5 py-2.5 text-left text-[11.5px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase",
        align === "right" && "text-right",
        className,
      )}
      {...rest}
    />
  );
}

export type SortDirection = "ascending" | "descending";

interface SortableThProps {
  children: ReactNode;
  direction?: SortDirection;
  onSort: () => void;
  align?: "right";
}

export function SortableTh({ children, direction, onSort, align }: SortableThProps) {
  const Icon =
    direction === "ascending" ? ArrowUp : direction === "descending" ? ArrowDown : ArrowUpDown;
  return (
    <Th align={align} aria-sort={direction ?? "none"}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-text"
      >
        {children}
        <Icon className={cn("size-3", !direction && "opacity-50")} aria-hidden />
      </button>
    </Th>
  );
}

export function Td({ className, align, ...rest }: ComponentProps<"td"> & { align?: "right" }) {
  return (
    <td
      className={cn(
        "border-b border-line px-3.5 py-2.5 align-middle",
        align === "right" && "text-right",
        className,
      )}
      {...rest}
    />
  );
}

export function Tr({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("[&:last-child>td]:border-b-0", className)} {...rest} />;
}

/** Secondary line under a cell's main value. */
export function Sub({ children }: { children: ReactNode }) {
  return <span className="block text-xs text-muted">{children}</span>;
}
