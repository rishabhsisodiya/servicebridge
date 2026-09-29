"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { API_BASE, apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import type { TicketDetail } from "./api";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Photos and PDFs on the ticket. Files are served by the API behind the same sign-in. */
export function TicketFiles({
  ticket,
  onUploaded,
}: {
  ticket: TicketDetail;
  onUploaded: () => Promise<unknown>;
}) {
  const toast = useToast();
  const { me, can } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const finished = ticket.stage === "CLOSED" || ticket.stage === "CANCELLED";
  const fileUrl = (id: string) => `${API_BASE}/tickets/${ticket.id}/attachments/${id}`;

  // Remove is undoable: the file hides at once, the real delete runs 5 s
  // later. Navigating away cancels the pending delete (safe direction).
  const UNDO_MS = 5_000;
  const pending = useRef<{ id: string; name: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const commitDelete = useCallback(
    async (id: string) => {
      clearTimer();
      pending.current = null;
      setPendingId(null);
      try {
        await apiFetch(`/tickets/${ticket.id}/attachments/${id}`, { method: "DELETE" });
        await onUploaded();
      } catch (caught) {
        toast.error(
          caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
        );
        await onUploaded();
      }
    },
    [ticket.id, onUploaded, toast],
  );

  const remove = (id: string, name: string) => {
    // One undo window at a time: removing another file commits the pending one.
    if (pending.current && pending.current.id !== id) void commitDelete(pending.current.id);
    clearTimer();
    pending.current = { id, name };
    setPendingId(id);
    timer.current = setTimeout(() => void commitDelete(id), UNDO_MS);
    toast.success(`${name} removed.`, {
      action: {
        label: "Undo",
        onClick: () => {
          clearTimer();
          pending.current = null;
          setPendingId(null);
        },
      },
    });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) return toast.error("Files can be up to 10 MB.");
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      await apiFetch(`/tickets/${ticket.id}/attachments`, { method: "POST", form });
      await onUploaded();
      toast.success(`${file.name} added.`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card aria-labelledby="files-title">
      <CardHeader
        titleId="files-title"
        title="Photos and files"
        meta={ticket.attachments.length ? `${ticket.attachments.length}` : undefined}
        actions={
          !finished && (
            <>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={upload}
              />
              <Button
                size="sm"
                icon={<Paperclip className="size-4" aria-hidden />}
                loading={uploading}
                onClick={() => input.current?.click()}
              >
                Add file
              </Button>
            </>
          )
        }
      />
      <CardBody>
        {ticket.attachments.length === 0 ? (
          <p className="text-[13px] text-muted">
            No files yet. Add photos of the fault or the repair, or a PDF report (up to 10 MB).
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
            {ticket.attachments
              .filter((a) => a.id !== pendingId)
              .map((a) => {
              const canRemove =
                !finished && (a.uploadedBy?.id === me?.user.id || can("tickets.assign"));
              return (
                <li
                  key={a.id}
                  className="group relative overflow-hidden rounded-lg border border-line"
                >
                  <a
                    href={fileUrl(a.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-text no-underline"
                  >
                    {a.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- served by the API with auth cookies
                      <img
                        src={fileUrl(a.id)}
                        alt={a.fileName}
                        loading="lazy"
                        className="aspect-[4/3] w-full bg-surface-2 object-cover"
                      />
                    ) : (
                      <span className="grid aspect-[4/3] w-full place-items-center bg-surface-2">
                        <FileText className="size-8 text-muted" aria-hidden />
                      </span>
                    )}
                    <span className="block px-2.5 py-2 text-xs">
                      <span className="block truncate font-semibold">{a.fileName}</span>
                      <span className="text-muted">
                        {size(a.sizeBytes)}
                        {a.uploadedBy ? ` · ${a.uploadedBy.name}` : ""}
                      </span>
                    </span>
                  </a>
                  {canRemove && (
                    <span className="absolute top-1.5 right-1.5 rounded-md bg-surface/90">
                      <IconButton
                        label={`Remove ${a.fileName}`}
                        size="sm"
                        onClick={() => void remove(a.id, a.fileName)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
