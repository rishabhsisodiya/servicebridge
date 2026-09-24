"use client";

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PasswordInput } from "./password-input";

interface Pending {
  retry: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Wraps an action that may need a recent password check. If the API answers
 * STEP_UP_REQUIRED, asks for the password, confirms it and retries once.
 * Render `dialog` somewhere in the component.
 */
export function useStepUp(): {
  run: <T>(action: () => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const pending = useRef<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  const run = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    return action().catch((error: unknown) => {
      if (!(error instanceof ApiError) || error.code !== "STEP_UP_REQUIRED") throw error;
      return new Promise<T>((resolve, reject) => {
        pending.current = { retry: action, resolve: resolve as (v: unknown) => void, reject };
        setPassword("");
        setError(undefined);
        setOpen(true);
      });
    });
  }, []);

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new ApiError(0, "STEP_UP_CANCELLED", "Cancelled."));
    pending.current = null;
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setChecking(true);
    try {
      await apiFetch("/auth/confirm-password", { method: "POST", json: { password } });
    } catch (caught) {
      setChecking(false);
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
      return;
    }
    setChecking(false);
    setOpen(false);
    const current = pending.current;
    pending.current = null;
    if (current) current.retry().then(current.resolve, current.reject);
  };

  const dialog = (
    <Dialog
      open={open}
      onClose={cancel}
      title="Confirm it's you"
      description="This action needs your password. You won't be asked again for 10 minutes."
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button type="submit" form="step-up-form" variant="strong" loading={checking}>
            Confirm
          </Button>
        </>
      }
    >
      <form id="step-up-form" onSubmit={confirm} noValidate>
        <Field label="Your password" error={error}>
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );

  return { run, dialog };
}
