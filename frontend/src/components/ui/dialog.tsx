"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Opens a native <dialog> as a modal. The browser provides the focus trap,
 * Escape to close, the inert background and focus return to the trigger.
 */
function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape fires "cancel"; route it through onClose so parent state stays in sync.
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  // Clicking the backdrop (the dialog element itself, outside its content) closes it.
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return { ref, onBackdropClick };
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: OverlayProps) {
  const { ref, onBackdropClick } = useModalDialog(open, onClose);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={onBackdropClick}
      className={cn(
        "m-auto w-[min(560px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-text shadow-lg open:animate-pop",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start gap-3 px-5 pt-5 pb-2">
            <div className="flex-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-[13px] text-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          {children && (
            <div className="flex flex-col gap-3 overflow-y-auto px-5 pt-2 pb-4">{children}</div>
          )}
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: OverlayProps) {
  const { ref, onBackdropClick } = useModalDialog(open, onClose);
  const titleId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      className={cn(
        "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(440px,100vw)] border-l border-line bg-surface p-0 text-text shadow-lg open:animate-slide-in",
        className,
      )}
    >
      {open && (
        <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <div className="flex-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-5 pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
