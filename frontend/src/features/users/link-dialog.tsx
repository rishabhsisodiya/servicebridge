"use client";

import { Copy, MailCheck, MailX, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import type { IssuedLink } from "./api";

interface LinkDialogProps {
  link: (IssuedLink & { kind: "invite" | "reset"; name: string }) | null;
  onClose: () => void;
}

const formatExpiry = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Shows a one-time invite or reset link. When email is configured the link is
 * emailed to the user; otherwise the admin copies it and sends it themselves.
 */
export function LinkDialog({ link, onClose }: LinkDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; select the text so Ctrl/Cmd+C works.
      inputRef.current?.select();
    }
  };

  const close = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog
      open={link !== null}
      onClose={close}
      title={
        link?.kind === "invite"
          ? `Invite link for ${link.name}`
          : `Password reset link for ${link?.name ?? ""}`
      }
      description={
        link
          ? link.emailed
            ? `This link was emailed to ${link.name}. It works once and expires ${formatExpiry(link.expiresAt)}.`
            : `Email isn't configured, so ${link.name} never got this link. It works once and expires ${formatExpiry(link.expiresAt)}.`
          : undefined
      }
      footer={
        <Button variant="strong" onClick={close}>
          Done
        </Button>
      }
    >
      {link && (
        <>
          <p
            role="status"
            className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold ${
              link.emailed ? "bg-ok-bg text-ok" : "bg-surface-2 text-muted"
            }`}
          >
            {link.emailed ? (
              <MailCheck className="size-4 shrink-0" aria-hidden />
            ) : (
              <MailX className="size-4 shrink-0" aria-hidden />
            )}
            {link.emailed
              ? `Invite emailed to ${link.name}.`
              : "Email not configured — copy this link and send it yourself."}
          </p>
          <Field label="Link">
            {(props) => (
              <div className="flex gap-2">
                <Input
                  {...props}
                  ref={inputRef}
                  readOnly
                  value={link.url}
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  onClick={copy}
                  icon={<Copy className="size-4" aria-hidden />}
                  aria-live="polite"
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </Field>
          <p className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2.5 text-[13px] text-warn">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-text">
              Anyone with this link can set the password for this account. Send it only to{" "}
              {link.name}, and this link isn&apos;t shown again.
            </span>
          </p>
        </>
      )}
    </Dialog>
  );
}
