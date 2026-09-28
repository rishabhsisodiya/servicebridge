"use client";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Minus,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/list-controls";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/features/catalog/shared";
import {
  addPhoto,
  addSpare,
  deleteVisit,
  refuseSignature,
  removePhoto,
  removeSpare,
  saveVisit,
  searchSpareItems,
  setSignature,
  submitVisit,
  updateSpare,
  visitPhotoUrl,
  type SpareItemOption,
  type VisitDetail,
} from "./api";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 10;

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const toastOr =
  (toast: { error: (m: string) => void }, fallback: string) => (caught: unknown) =>
    toast.error(caught instanceof ApiError ? caught.message : fallback);

/** A draft visit, editable on a phone in the field. Submitting locks it. */
export function VisitForm({
  visit,
  ticketRef,
  onChanged,
}: {
  visit: VisitDetail;
  /** The ticket's number or id, for the back link after delete. */
  ticketRef: string;
  /** Re-read the visit after a mutation (bumps the version). */
  onChanged: () => Promise<unknown>;
}) {
  const toast = useToast();
  const router = useRouter();
  const fail = toastOr(toast, "Something went wrong. Try again.");

  const [notes, setNotes] = useState(visit.workDone ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const notesDirty = notes !== (visit.workDone ?? "");

  const persistNotes = async (): Promise<boolean> => {
    setSavingNotes(true);
    try {
      await saveVisit(visit.id, { workDone: notes, version: visit.version });
      await onChanged();
      toast.success("Notes saved.");
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        await onChanged();
        toast.error("This visit changed since you opened it. Your notes were kept — save again.");
      } else fail(caught);
      return false;
    } finally {
      setSavingNotes(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteVisit(visit.id);
      toast.success(`Draft visit ${visit.visitNumber} deleted.`);
      router.push(`/tickets/${ticketRef}`);
    } catch (caught) {
      fail(caught);
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const startSubmit = async () => {
    if (!notes.trim()) {
      toast.error("Write up what was done before submitting the visit.");
      document.getElementById("visit-notes")?.focus();
      return;
    }
    if (!visit.hasSignature && !visit.signatureRefused) {
      toast.error("Capture the customer signature, or record a refusal, before submitting.");
      document.getElementById("visit-signature")?.scrollIntoView({ block: "start" });
      return;
    }
    if (notesDirty && !(await persistNotes())) return;
    setConfirmingSubmit(true);
  };

  const confirmSubmit = async () => {
    setSubmitting(true);
    try {
      await submitVisit(visit.id);
      setConfirmingSubmit(false);
      toast.success("Visit submitted.");
      await onChanged();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VISIT_ALREADY_SUBMITTED") {
        // Idempotent retry: a double tap can never submit twice.
        setConfirmingSubmit(false);
        toast.success("This visit is already submitted.");
        await onChanged();
      } else fail(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card aria-labelledby="notes-title">
        <CardHeader
          titleId="notes-title"
          title="Work notes"
          meta="Required to submit"
          actions={
            <Button size="sm" loading={savingNotes} disabled={!notesDirty} onClick={() => void persistNotes()}>
              Save notes
            </Button>
          }
        />
        <CardBody>
          <Field label="What was done" required>
            {(props) => (
              <Textarea
                {...props}
                id="visit-notes"
                rows={6}
                maxLength={20000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe the fault found, the work carried out and the result…"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <SparesCard visit={visit} onChanged={onChanged} />
      <PhotosCard visit={visit} onChanged={onChanged} />
      <SignatureCard visit={visit} onChanged={onChanged} />

      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:-mx-7 lg:px-7">
        <Button variant="danger" onClick={() => setConfirmingDelete(true)} className="max-sm:flex-1">
          Delete draft
        </Button>
        <span className="sm:ml-auto max-sm:w-full" />
        <Button variant="primary" onClick={() => void startSubmit()} className="max-sm:flex-1">
          Submit visit
        </Button>
      </div>

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete draft visit ${visit.visitNumber}?`}
        description="The notes, spares, photos and signature on this draft are removed. This can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete draft
            </Button>
          </>
        }
      />

      <Dialog
        open={confirmingSubmit}
        onClose={() => setConfirmingSubmit(false)}
        title={`Submit visit ${visit.visitNumber}?`}
        description="Submitting locks the visit. The area manager is notified."
        footer={
          <>
            <Button onClick={() => setConfirmingSubmit(false)}>Keep editing</Button>
            <Button variant="primary" loading={submitting} onClick={() => void confirmSubmit()}>
              Submit visit
            </Button>
          </>
        }
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px]">
          <SummaryRow ok={notes.trim().length > 0} label="Work notes written" />
          <SummaryRow
            ok={visit.spares.length > 0}
            optional
            label={`${visit.spares.length} spare ${visit.spares.length === 1 ? "line" : "lines"}`}
          />
          <SummaryRow
            ok={visit.photos.length > 0}
            optional
            label={`${visit.photos.length} ${visit.photos.length === 1 ? "photo" : "photos"}`}
          />
          <SummaryRow
            ok={visit.hasSignature || visit.signatureRefused}
            label={visit.signatureRefused ? "Signature refusal recorded" : "Customer signature captured"}
          />
        </ul>
      </Dialog>
    </div>
  );
}

function SummaryRow({ ok, optional, label }: { ok: boolean; optional?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
      ) : optional ? (
        <span className="size-4 shrink-0 text-muted" aria-hidden>
          –
        </span>
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
      )}
      <span className={ok ? undefined : "text-muted"}>{label}</span>
    </li>
  );
}

/* ── Spares ─────────────────────────────────────────────────────────── */

function SparesCard({ visit, onChanged }: { visit: VisitDetail; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const fail = toastOr(toast, "Something went wrong. Try again.");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SpareItemOption | null>(null);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busyLine, setBusyLine] = useState<string | null>(null);

  const { data: results, isLoading: searching } = useSWR<SpareItemOption[]>(
    query ? ["spare-search", query] : null,
    ([, q]: [string, string]) => searchSpareItems(q),
  );

  const add = async () => {
    if (!picked) return;
    setAdding(true);
    try {
      const line = await addSpare(visit.id, picked.id, qty);
      if (line.stockWarning) {
        setWarnings((w) => [
          ...w,
          `Only ${line.availableStock} × ${line.item.name} on hand — recorded anyway.`,
        ]);
      }
      setPicked(null);
      setQty(1);
      setQuery("");
      await onChanged();
      toast.success(`${qty} × ${line.item.name} added.`);
    } catch (caught) {
      fail(caught);
    } finally {
      setAdding(false);
    }
  };

  const setLineQty = async (spareId: string, next: number) => {
    if (next < 1) return;
    setBusyLine(spareId);
    try {
      await updateSpare(visit.id, spareId, next);
      await onChanged();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusyLine(null);
    }
  };

  const removeLine = async (spareId: string, name: string) => {
    setBusyLine(spareId);
    try {
      await removeSpare(visit.id, spareId);
      await onChanged();
      toast.success(`${name} removed.`);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusyLine(null);
    }
  };

  return (
    <Card aria-labelledby="spares-title">
      <CardHeader
        titleId="spares-title"
        title="Spares used"
        meta={visit.spares.length ? `${visit.spares.length}` : undefined}
      />
      <CardBody className="flex flex-col gap-3">
        {warnings.map((w) => (
          <p
            key={w}
            role="status"
            className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-[13px] text-warn"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {w}
          </p>
        ))}
        {visit.spares.length === 0 ? (
          <p className="text-[13px] text-muted">
            No spares recorded. Add anything fitted during the visit.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {visit.spares.map((line) => (
              <li
                key={line.id}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{line.item.name}</span>
                  <span className="block text-xs text-muted">
                    {line.item.itemCode}
                    {line.item.uom ? ` · ${line.item.uom}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1" role="group" aria-label={`Quantity of ${line.item.name}`}>
                  <IconButton
                    label={`Use one fewer ${line.item.name}`}
                    size="sm"
                    disabled={busyLine === line.id || line.quantity <= 1}
                    onClick={() => void setLineQty(line.id, line.quantity - 1)}
                  >
                    <Minus className="size-4" aria-hidden />
                  </IconButton>
                  <span className="w-8 text-center text-[13.5px] font-semibold tabular-nums" aria-live="polite">
                    {line.quantity}
                  </span>
                  <IconButton
                    label={`Use one more ${line.item.name}`}
                    size="sm"
                    disabled={busyLine === line.id}
                    onClick={() => void setLineQty(line.id, line.quantity + 1)}
                  >
                    <Plus className="size-4" aria-hidden />
                  </IconButton>
                </span>
                <IconButton
                  label={`Remove ${line.item.name}`}
                  size="sm"
                  disabled={busyLine === line.id}
                  onClick={() => void removeLine(line.id, line.item.name)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {!picked ? (
            <>
              <SearchInput label="Find a spare part" placeholder="Search by code or name…" onChange={setQuery} />
              {searching && <p className="text-[13px] text-muted">Searching…</p>}
              {results && results.length > 0 && (
                <ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0" role="listbox" aria-label="Matching spare parts">
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setPicked(item);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{item.name}</span>
                          <span className="block text-xs text-muted">
                            {item.itemCode}
                            {item.uom ? ` · ${item.uom}` : ""}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {results && query && results.length === 0 && (
                <p className="text-[13px] text-muted">No spare parts match “{query}”.</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
              <span className="min-w-0 flex-1 text-[13.5px]">
                <span className="block truncate font-semibold">{picked.name}</span>
                <span className="block text-xs text-muted">{picked.itemCode}</span>
              </span>
              <span className="flex items-center gap-1" role="group" aria-label="Quantity to add">
                <IconButton label="One fewer" size="sm" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
                  <Minus className="size-4" aria-hidden />
                </IconButton>
                <span className="w-8 text-center text-[13.5px] font-semibold tabular-nums">{qty}</span>
                <IconButton label="One more" size="sm" onClick={() => setQty((q) => Math.min(999999, q + 1))}>
                  <Plus className="size-4" aria-hidden />
                </IconButton>
              </span>
              <Button size="sm" loading={adding} onClick={() => void add()}>
                Add
              </Button>
              <IconButton label="Pick a different part" size="sm" onClick={() => setPicked(null)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Photos ─────────────────────────────────────────────────────────── */

function PhotosCard({ visit, onChanged }: { visit: VisitDetail; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const fail = toastOr(toast, "Something went wrong. Try again.");
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const full = visit.photos.length >= MAX_PHOTOS;

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) return toast.error("Photos can be up to 10 MB.");
    setUploading(true);
    try {
      await addPhoto(visit.id, file);
      await onChanged();
      toast.success(`${file.name} added.`);
    } catch (caught) {
      fail(caught);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (photoId: string, name: string) => {
    try {
      await removePhoto(visit.id, photoId);
      await onChanged();
      toast.success(`${name} removed.`);
    } catch (caught) {
      fail(caught);
    }
  };

  return (
    <Card aria-labelledby="photos-title">
      <CardHeader
        titleId="photos-title"
        title="Photos"
        meta={`${visit.photos.length}/${MAX_PHOTOS}`}
        actions={
          !full && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={upload}
              />
              <Button
                size="sm"
                icon={<Camera className="size-4" aria-hidden />}
                loading={uploading}
                onClick={() => input.current?.click()}
              >
                Add photo
              </Button>
            </>
          )
        }
      />
      <CardBody>
        {visit.photos.length === 0 ? (
          <p className="text-[13px] text-muted">
            No photos yet. Add the fault, the repair, or the nameplate (up to {MAX_PHOTOS}, 10 MB
            each).
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
            {visit.photos.map((p) => (
              <li key={p.id} className="group relative overflow-hidden rounded-lg border border-line">
                <a
                  href={visitPhotoUrl(visit.id, p.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-text no-underline"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with auth cookies */}
                  <img
                    src={visitPhotoUrl(visit.id, p.id)}
                    alt={p.fileName}
                    loading="lazy"
                    className="aspect-[4/3] w-full bg-surface-2 object-cover"
                  />
                  <span className="block px-2.5 py-2 text-xs">
                    <span className="block truncate font-semibold">{p.fileName}</span>
                    <span className="text-muted">{size(p.sizeBytes)}</span>
                  </span>
                </a>
                <span className="absolute top-1.5 right-1.5 rounded-md bg-surface/90">
                  <IconButton label={`Remove ${p.fileName}`} size="sm" onClick={() => void remove(p.id, p.fileName)}>
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Signature ──────────────────────────────────────────────────────── */

function SignatureCard({ visit, onChanged }: { visit: VisitDetail; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const fail = toastOr(toast, "Something went wrong. Try again.");
  const pad = useRef<SignaturePadHandle>(null);
  const [signatory, setSignatory] = useState(visit.signatoryName ?? "");
  const [editing, setEditing] = useState(!visit.hasSignature && !visit.signatureRefused);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const signatoryDirty = signatory !== (visit.signatoryName ?? "");

  const persistSignatory = async (): Promise<boolean> => {
    if (!signatoryDirty) return true;
    try {
      await saveVisit(visit.id, {
        signatoryName: signatory.trim() ? signatory.trim() : null,
        version: visit.version,
      });
      await onChanged();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        await onChanged();
        toast.error("This visit changed since you opened it. Try again.");
      } else fail(caught);
      return false;
    }
  };

  const save = async () => {
    const blob = await pad.current?.toBlob();
    if (!blob) return toast.error("Draw the signature first.");
    setBusy(true);
    try {
      if (!(await persistSignatory())) return;
      await setSignature(visit.id, blob);
      pad.current?.clear();
      setEditing(false);
      setRefusing(false);
      await onChanged();
      toast.success("Signature saved.");
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const refuse = async () => {
    const text = reason.trim();
    if (!text) return toast.error("Give a reason for the refusal.");
    setBusy(true);
    try {
      await refuseSignature(visit.id, text);
      setReason("");
      setRefusing(false);
      setEditing(false);
      await onChanged();
      toast.success("Refusal recorded.");
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    setSignatory(visit.signatoryName ?? "");
    setReason("");
    setRefusing(false);
    setEditing(true);
  };

  return (
    <Card aria-labelledby="visit-signature">
      <CardHeader
        titleId="visit-signature"
        title="Customer sign-off"
        meta={
          visit.hasSignature ? (
            <StatusPill tone="ok" plain>
              Signed
            </StatusPill>
          ) : visit.signatureRefused ? (
            <StatusPill tone="warn" plain>
              Refused
            </StatusPill>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-3">
        {!editing && visit.hasSignature && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex flex-1 items-center gap-2 text-[13.5px]">
              <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
              Signature captured{visit.signatoryName ? ` by ${visit.signatoryName}` : ""}. You can
              replace it below.
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={<PenLine className="size-4" aria-hidden />}
              onClick={startEditing}
            >
              Replace
            </Button>
          </div>
        )}
        {!editing && visit.signatureRefused && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-[13.5px]">
              <span className="font-semibold">The customer refused to sign.</span>{" "}
              <span className="text-muted">{visit.refusalReason}</span>
            </p>
            <Button size="sm" variant="secondary" onClick={startEditing}>
              Capture instead
            </Button>
          </div>
        )}

        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="Signed by (name)">
              {(props) => (
                <Input
                  {...props}
                  value={signatory}
                  maxLength={120}
                  onChange={(e) => setSignatory(e.target.value)}
                  placeholder="Name of the person signing"
                  autoComplete="off"
                />
              )}
            </Field>
            {!refusing && <SignaturePad ref={pad} />}
            <div className="flex flex-wrap gap-2">
              {!refusing && (
                <Button loading={busy} onClick={() => void save()} className="max-sm:flex-1">
                  Save signature
                </Button>
              )}
              {(visit.hasSignature || visit.signatureRefused) && (
                <Button
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  className="max-sm:flex-1"
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setRefusing((r) => !r);
                  setReason("");
                }}
                className="max-sm:flex-1"
              >
                {refusing ? "Back to signing" : "Customer refused"}
              </Button>
            </div>
            {refusing && (
              <>
                <Field label="Reason for refusal" required help="Recorded on the visit instead of a signature.">
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={2}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why wouldn't they sign?"
                    />
                  )}
                </Field>
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => void refuse()}
                  className="self-start"
                >
                  Record refusal
                </Button>
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          {visit.hasSignature || visit.signatureRefused
            ? `Last change ${formatDate(visit.updatedAt)}.`
            : "One of the two is required before the visit can be submitted."}
        </p>
      </CardBody>
    </Card>
  );
}
