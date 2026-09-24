"use client";

import { CheckCircle2, Clock, PauseCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

/** Sticky footer with the ticket's next actions. Sample behaviour only until session 8. */
export function TicketActionBar({ dueText }: { dueText: string }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"resolve" | "hold" | null>(null);
  const [summary, setSummary] = useState(
    "Replaced worn mantle liner and reset the setting to 20 mm. Output back within spec.",
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const close = () => {
    setDialog(null);
    setError(undefined);
  };

  const confirmResolve = async (event: FormEvent) => {
    event.preventDefault();
    if (summary.trim().length < 10) {
      setError("Describe what was done in at least 10 characters.");
      return;
    }
    setSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSaving(false);
    close();
    toast.success("Marked resolved. The area manager has been asked to verify.");
  };

  return (
    <>
      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:-mx-7 lg:px-7">
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <Clock className="size-3.5" aria-hidden />
          {dueText}
        </span>
        <div className="flex flex-wrap gap-2 max-sm:w-full sm:ml-auto [&>*]:max-sm:flex-1">
          <Button
            icon={<PauseCircle className="size-4" aria-hidden />}
            onClick={() => setDialog("hold")}
          >
            Put on hold
          </Button>
          <Button
            variant="primary"
            icon={<CheckCircle2 className="size-4" aria-hidden />}
            onClick={() => setDialog("resolve")}
          >
            Mark resolved
          </Button>
        </div>
      </div>

      <Dialog
        open={dialog === "resolve"}
        onClose={close}
        title="Mark this ticket resolved?"
        description="The area manager is asked to verify it. The customer gets a feedback link once it's closed."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" form="resolve-form" loading={saving}>
              Mark resolved
            </Button>
          </>
        }
      >
        <form id="resolve-form" onSubmit={confirmResolve} noValidate>
          <Field
            label="What was done"
            required
            error={error}
            help="Visible to the service team and on the customer's visit report."
          >
            {(props) => (
              <Textarea
                {...props}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "hold"}
        onClose={close}
        title="Put this ticket on hold"
        description="The SLA clock pauses until work resumes."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="strong"
              onClick={() => {
                close();
                toast.success("Ticket put on hold. The SLA clock is paused.");
              }}
            >
              Put on hold
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          {(props) => (
            <Select {...props} defaultValue="spare">
              <option value="spare">Waiting for a spare part</option>
              <option value="po">Waiting for the customer&apos;s PO</option>
              <option value="site">Customer site not ready</option>
            </Select>
          )}
        </Field>
      </Dialog>
    </>
  );
}

export function AddNoteForm() {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) {
      setError("Write a note before adding it.");
      return;
    }
    setError(undefined);
    setNote("");
    toast.success("Note added.");
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <Field
        label="Add a note"
        error={error}
        help="Only your team sees notes. The customer isn't notified."
      >
        {(props) => (
          <Textarea
            {...props}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you find or do?"
          />
        )}
      </Field>
      <div>
        <Button type="submit" size="sm" variant="strong">
          Add note
        </Button>
      </div>
    </form>
  );
}
