"use client";

import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 4_000;

/**
 * Toasts announce politely (they never steal focus) and dismiss after 4 s.
 * Errors stay until closed, because they usually need action.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { id, kind, message }]);
      if (kind === "success") setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[90] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex animate-pop items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg",
              toast.kind === "error"
                ? "bg-bad-bg text-bad ring-1 ring-bad/30"
                : "bg-primary text-on-primary",
            )}
          >
            {toast.kind === "error" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-m-1 cursor-pointer rounded p-1 opacity-80 hover:opacity-100"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
