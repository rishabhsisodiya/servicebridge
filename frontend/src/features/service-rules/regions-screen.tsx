"use client";

import { AlertTriangle, Lock, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { SourceTag } from "@/features/catalog/shared";
import type { RegionRow } from "./api";
import { errorsFrom, FormAlert, type FormErrors } from "./shared";

interface RegionsData {
  data: RegionRow[];
  unmatchedSites: number;
}
interface Manager {
  id: string;
  name: string;
  role: string;
}
interface Resolved {
  pincode: string;
  matchedPrefix: string | null;
  region: { id: string; name: string; areaManager: { name: string } | null } | null;
}

const KEY = "/regions/manage";
const PREVIEW = 6;

/** Splits on commas, spaces and new lines. */
const parsePrefixes = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

export function RegionsScreen() {
  const { can, me } = useSession();
  const allowed = can("rules.read");
  const regions = useSWR<RegionsData>(allowed ? KEY : null, (k: string) =>
    apiFetch<RegionsData>(k),
  );
  const toast = useToast();
  const [editing, setEditing] = useState<RegionRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RegionRow | null>(null);
  const [deleteError, setDeleteError] = useState<string>();

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Regions" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiFetch(`/regions/${deleting.id}`, { method: "DELETE" });
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
      await regions.mutate();
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Regions"
        description="A site's pincode decides its region, and the region's area manager receives its new tickets."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setEditing("new")}
          >
            Add region
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <PincodeChecker />
        <Card>
          {regions.error && (
            <ErrorState title="Couldn't load regions" onRetry={() => void regions.mutate()} />
          )}
          {!regions.data && !regions.error && <TableSkeleton label="Loading regions" />}
          {regions.data && regions.data.unmatchedSites > 0 && (
            <p className="flex items-center gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-[13px] text-warn">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {regions.data.unmatchedSites} customer{" "}
              {regions.data.unmatchedSites === 1 ? "site doesn't" : "sites don't"} match any region.
              Their tickets go to the service manager.
            </p>
          )}
          {regions.data?.data.length === 0 && (
            <EmptyState
              icon={<MapPin className="size-6" />}
              title="No regions yet"
              description="Add a region, then list the pincode prefixes it covers."
            />
          )}
          {regions.data && regions.data.data.length > 0 && (
            <Table caption="Regions">
              <thead>
                <tr>
                  <Th>Region</Th>
                  <Th>Area manager</Th>
                  <Th>Pincodes starting with</Th>
                  <Th align="right">Sites</Th>
                  <Th align="right">People</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {regions.data.data.map((r) => (
                  <Tr key={r.id}>
                    <Td className="min-w-36">
                      <span className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                        >
                          {r.name}
                        </button>
                        {r.isDemo && <SourceTag source="DEMO" />}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.areaManager?.name ?? <span className="text-muted">Not set</span>}
                    </Td>
                    <Td className="min-w-56 font-mono text-[13px]">
                      {r.pincodePrefixes.length ? (
                        <>
                          {r.pincodePrefixes.slice(0, PREVIEW).join(", ")}
                          {r.pincodePrefixes.length > PREVIEW && (
                            <span className="font-sans text-muted">
                              {" "}
                              +{r.pincodePrefixes.length - PREVIEW} more
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="font-sans text-muted">
                          None — no sites are routed here
                        </span>
                      )}
                    </Td>
                    <Td align="right">{r.siteCount}</Td>
                    <Td align="right">{r.userCount}</Td>
                    <Td align="right">
                      <IconButton
                        label={`Delete ${r.name}`}
                        size="sm"
                        onClick={() => {
                          setDeleteError(undefined);
                          setDeleting(r);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      <RegionDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        region={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast.success(message);
          setEditing(null);
          await regions.mutate();
        }}
      />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "region"}?`}
        description="Its pincode prefixes are removed too, so those sites will no longer match a region."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <FormAlert message={deleteError} />
      </Dialog>
    </>
  );
}

function PincodeChecker() {
  const [pincode, setPincode] = useState("");
  const [result, setResult] = useState<Resolved>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(pincode)) {
      setError("Enter a 6-digit pincode.");
      setResult(undefined);
      return;
    }
    setChecking(true);
    setError(undefined);
    try {
      setResult(await apiFetch<Resolved>(`/regions/resolve?pincode=${pincode}`));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Check a pincode"
        meta="See where a site with this pincode would be routed."
      />
      <CardBody>
        <form onSubmit={check} noValidate className="flex flex-wrap items-start gap-2">
          <Field label="Pincode" error={error} className="w-44">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                maxLength={6}
                placeholder="560001"
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <Button
            type="submit"
            className="mt-6.5"
            loading={checking}
            icon={<Search className="size-4" aria-hidden />}
          >
            Check
          </Button>
        </form>
        {result && (
          <p role="status" className="mt-3 text-[13px]">
            {result.region ? (
              <>
                <b>{result.pincode}</b> → <b>{result.region.name}</b> (matches prefix{" "}
                <span className="font-mono">{result.matchedPrefix}</span>).{" "}
                {result.region.areaManager
                  ? `New tickets go to ${result.region.areaManager.name}.`
                  : "This region has no area manager yet."}
              </>
            ) : (
              <>
                <b>{result.pincode}</b> doesn&apos;t match any region. Its tickets go to the service
                manager.
              </>
            )}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function RegionDrawer({
  region,
  onClose,
  onSaved,
}: {
  region: RegionRow | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const existing = region && region !== "new" ? region : null;
  const managers = useSWR<Manager[]>(region ? "/regions/managers" : null, (k: string) =>
    apiFetch<Manager[]>(k),
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [areaManagerId, setAreaManagerId] = useState(existing?.areaManager?.id ?? "");
  const [prefixes, setPrefixes] = useState(existing?.pincodePrefixes.join(", ") ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const list = parsePrefixes(prefixes);
    const bad = list.filter((p) => !/^\d{1,6}$/.test(p));
    const next: FormErrors = {};
    if (name.trim().length < 2) next.name = "Enter a name.";
    if (bad.length)
      next.pincodePrefixes = `Not a pincode prefix (1–6 digits): ${bad.slice(0, 5).join(", ")}`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    const json = { name, areaManagerId: areaManagerId || null, pincodePrefixes: list };
    try {
      if (existing) {
        await apiFetch(`/regions/${existing.id}`, {
          method: "PATCH",
          json: { ...json, version: existing.version },
        });
      } else {
        await apiFetch("/regions", { method: "POST", json });
      }
      await onSaved(existing ? `${name.trim()} saved.` : `${name.trim()} added.`);
    } catch (caught) {
      setErrors(errorsFrom(caught, ["name", "areaManagerId", "pincodePrefixes"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!region}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a region"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="region-form" variant="primary" loading={saving}>
            {existing ? "Save" : "Add region"}
          </Button>
        </>
      }
    >
      <form id="region-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormAlert message={errors.form} />
        <Field label="Name" required error={errors.name}>
          {(p) => (
            <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field
          label="Area manager"
          error={errors.areaManagerId}
          help="Receives new tickets for sites in this region."
        >
          {(p) => (
            <Select
              {...p}
              value={areaManagerId}
              onChange={(e) => setAreaManagerId(e.target.value)}
              disabled={managers.isLoading}
            >
              <option value="">{managers.isLoading ? "Loading…" : "Not set"}</option>
              {managers.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Pincodes starting with"
          error={errors.pincodePrefixes}
          help={
            <>
              Separate with commas or spaces, e.g. <span className="font-mono">560, 562, 5631</span>
              . A longer prefix wins over a shorter one in another region.
            </>
          }
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              className="font-mono"
              value={prefixes}
              onChange={(e) => setPrefixes(e.target.value)}
            />
          )}
        </Field>
        {existing && existing.userCount > 0 && (
          <Sub>
            {existing.userCount} {existing.userCount === 1 ? "person is" : "people are"} in this
            region. Change people&apos;s region under Users &amp; roles.
          </Sub>
        )}
      </form>
    </Drawer>
  );
}
