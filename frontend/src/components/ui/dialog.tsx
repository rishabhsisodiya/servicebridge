"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "./button";

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /**
   * When true, closing via Escape, the backdrop or the close button first asks
   * "Discard changes?" instead of dropping the edits. Parent-initiated closes
   * (open flipping to false, e.g. after a save) are never intercepted.
   */
  dirty?: boolean;
}

/**
 * Opens a native <dialog> as a modal. The browser provides the focus trap,
 * Escape to close, the inert background and focus return to the trigger.
 */
function useModalDialog(open: boolean, onClose: () => void, dirty: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);

  // A saved (or reset) form is no longer dirty, and a closed dialog starts
  // clean next time: drop a stale confirmation. Render-phase adjustment, not
  // an effect, so no cascading render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open || (!dirty && confirming)) {
    setPrevOpen(open);
    setConfirming(false);
  }

  // Remember where focus was before the confirmation opened, so "Keep
  // editing" (or a second Escape) returns focus there instead of <body>.
  const prevFocus = useRef<HTMLElement | null>(null);

  // Move focus into the confirmation when it appears; restore it when it
  // goes away.
  useEffect(() => {
    if (confirming) {
      prevFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      keepButton.current?.focus();
    } else {
      prevFocus.current?.focus?.();
      prevFocus.current = null;
    }
  }, [confirming]);

  const requestClose = useCallback(() => {
    // A dirty form toggles the discard confirmation: first Escape/backdrop/X
    // shows it, a second one returns to editing. Edits are only lost via the
    // explicit "Discard" button.
    if (dirty) {
      setConfirming((c) => !c);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open ]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape fires "cancel"; route it through requestClose so a dirty form
    // gets the discard confirmation instead of losing edits.
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [requestClose]);

  // Clicking the backdrop (the dialog element itself, outside its content) asks
  // to close; a dirty form gets the discard confirmation first.
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) requestClose();
  };

  return { ref, onBackdropClick, confirming, requestClose, keepButton, setConfirming };
}

/** Inline "Discard changes?" confirmation rendered inside the overlay. */
function DiscardConfirm({
  onKeep,
  onDiscard,
  keepButton,
  labelledBy,
}: {
  onKeep: () => void;
  onDiscard: () => void;
  keepButton: RefObject<HTMLButtonElement | null>;
  labelledBy: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-scrim p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={`${labelledBy}-desc`}
        className="w-full max-w-xs rounded-xl border border-line bg-surface p-5 shadow-lg"
      >
        <h3 id={labelledBy} className="text-[15px] font-semibold">
          Discard changes?
        </h3>
        <p id={`${labelledBy}-desc`} className="mt-1 text-[13px] text-muted">
          Your edits will be lost.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={keepButton} size="sm" variant="secondary" onClick={onKeep}>
            Keep editing
          </Button>
          <Button size="sm" variant="danger" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  dirty = false,
}: OverlayProps) {
  const { ref, onBackdropClick, confirming, requestClose, keepButton, setConfirming } =
    useModalDialog(open, onClose, dirty);
  const titleId = useId();
  const descriptionId = useId();
  const confirmId = useId();

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
        <div className="relative flex max-h-[85dvh] flex-col">
          <div className="flex items-start gap-3 px-5 pt-5 pb-2">
            <div className="flex-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="mt-1 text-[13px] text-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton label="Close" size="sm" onClick={requestClose}>
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
          {confirming && (
            <DiscardConfirm
              labelledBy={confirmId}
              keepButton={keepButton}
              onKeep={() => setConfirming(false)}
              onDiscard={onClose}
            />
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
  dirty = false,
}: OverlayProps) {
  const { ref, onBackdropClick, confirming, requestClose, keepButton, setConfirming } =
    useModalDialog(open, onClose, dirty);
  const titleId = useId();
  const confirmId = useId();

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
        <div className="relative flex h-full flex-col pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <div className="flex-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
            </div>
            <IconButton label="Close" size="sm" onClick={requestClose}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-5 pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
          {confirming && (
            <DiscardConfirm
              labelledBy={confirmId}
              keepButton={keepButton}
              onKeep={() => setConfirming(false)}
              onDiscard={onClose}
            />
          )}
        </div>
      )}
    </dialog>
  );
}
