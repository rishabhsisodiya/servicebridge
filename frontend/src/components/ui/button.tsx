import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "strong";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-strong text-on-accent-strong border-accent-strong hover:brightness-95",
  strong: "bg-primary text-on-primary border-primary hover:brightness-110",
  secondary: "bg-surface text-text border-control-border hover:bg-surface-2",
  ghost: "bg-transparent text-text border-transparent hover:bg-surface-2",
  danger: "bg-surface text-bad border-bad/40 hover:bg-bad-bg",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 text-[13px] gap-1.5",
  md: "min-h-10 px-3.5 text-sm gap-2",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return cn(
    "inline-flex cursor-pointer items-center justify-center rounded-lg border font-semibold whitespace-nowrap",
    "transition-[background-color,filter,transform] duration-150 active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    VARIANTS[variant],
    SIZES[size],
  );
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and marks it busy. */
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant, size, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={cn(buttonClasses(variant, size), "no-underline", className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label"> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  size?: ButtonSize;
}

export function IconButton({
  label,
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-grid cursor-pointer place-items-center rounded-lg text-text transition-colors hover:bg-surface-2",
        size === "md" ? "size-10" : "size-8",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
