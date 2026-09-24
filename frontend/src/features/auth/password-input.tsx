"use client";

import { Check, Circle } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Password field with a show/hide toggle. Paste and password managers work normally. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-16", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute top-1/2 right-1.5 min-h-8 -translate-y-1/2 cursor-pointer rounded-md px-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

/** Same rules the API enforces (backend/src/core/security/password.ts). */
export function passwordChecks(password: string) {
  return [
    { label: "At least 10 characters", met: password.length >= 10 },
    {
      label: "At least one letter and one number",
      met: /[A-Za-z]/.test(password) && /\d/.test(password),
    },
  ];
}

export function PasswordRules({ password, id }: { password: string; id: string }) {
  return (
    <ul
      id={id}
      className="m-0 flex list-none flex-col gap-1 p-0 text-xs"
      aria-label="Password rules"
    >
      {passwordChecks(password).map((check) => (
        <li
          key={check.label}
          className={cn("flex items-center gap-1.5", check.met ? "text-ok" : "text-muted")}
        >
          {check.met ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Circle className="size-3" aria-hidden />
          )}
          {check.label}
          <span className="sr-only">{check.met ? " (done)" : " (not yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
