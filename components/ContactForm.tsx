"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { usePageMeta } from "@/components/AppShell";
import { FastArea, FastInput } from "@/components/FastField";
import { PageToolbar } from "@/components/PageToolbar";
import { createContact, fetchContact, updateContact, type ContactInput } from "@/lib/contacts";
import { errorText } from "@/lib/errors";
import { isDirty } from "@/lib/formDirty";
import type { ContactKind, PostalAddress, SyncStatus } from "@/lib/qbo/map";

const EMPTY_ADDRESS: PostalAddress = {
  line1: "",
  line2: "",
  city: "",
  countrySubDivisionCode: "",
  postalCode: "",
  country: "",
};

function cloneContact(input: ContactInput): ContactInput {
  return {
    ...input,
    billingAddress: { ...input.billingAddress },
    shippingAddress: { ...input.shippingAddress },
  };
}

const EMPTY: ContactInput = {
  displayName: "",
  companyName: "",
  givenName: "",
  familyName: "",
  primaryEmail: "",
  phone: "",
  billingAddress: EMPTY_ADDRESS,
  shippingAddress: EMPTY_ADDRESS,
  taxId: "",
  notes: "",
  active: true,
};

export function ContactForm({
  kind,
  mode,
  contactId,
}: {
  kind: ContactKind;
  mode: "create" | "edit";
  contactId?: string;
}) {
  const router = useRouter();
  const noun = kind === "customer" ? "customer" : "vendor";
  const listHref = kind === "customer" ? "/customers" : "/vendors";
  const listLabel = kind === "customer" ? "Customers" : "Vendors";
  const [form, setForm] = useState<ContactInput>(EMPTY);
  const [qboId, setQboId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [loading, setLoading] = useState(mode === "edit");
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState<ContactInput>(EMPTY);
  const savingRef = useRef(false);
  const live = useRef(new Map<string, string>());
  function read(key: string, fallback: string) {
    return live.current.has(key) ? (live.current.get(key) as string) : fallback;
  }
  function currentContact(): ContactInput {
    const billing = { ...form.billingAddress };
    const shipping = { ...form.shippingAddress };
    for (const [key, value] of live.current) {
      if (key.startsWith("billing.")) billing[key.slice("billing.".length) as keyof PostalAddress] = value;
      if (key.startsWith("shipping.")) shipping[key.slice("shipping.".length) as keyof PostalAddress] = value;
    }
    return {
      ...form,
      displayName: read("displayName", form.displayName),
      companyName: read("companyName", form.companyName),
      givenName: read("givenName", form.givenName),
      familyName: read("familyName", form.familyName),
      primaryEmail: read("primaryEmail", form.primaryEmail),
      phone: read("phone", form.phone),
      taxId: read("taxId", form.taxId),
      notes: read("notes", form.notes),
      billingAddress: billing,
      shippingAddress: shipping,
    };
  }
  const dirty = isDirty(currentContact(), baseline);

  const title =
    mode === "create" ? `New ${noun}` : form.displayName.trim() || `Edit ${noun}`;

  usePageMeta({
    title,
    crumbs: [{ label: "Contacts" }, { label: listLabel, href: listHref }, { label: title }],
  });

  useEffect(() => {
    if (mode !== "edit" || !contactId) return;
    let cancelled = false;
    fetchContact(kind, contactId)
      .then((contact) => {
        if (cancelled) return;
        if (!contact) {
          setMissing(true);
          return;
        }
        const loaded = cloneContact({
          displayName: contact.displayName,
          companyName: contact.companyName,
          givenName: contact.givenName,
          familyName: contact.familyName,
          primaryEmail: contact.primaryEmail,
          phone: contact.phone,
          billingAddress: contact.billingAddress,
          shippingAddress: contact.shippingAddress,
          taxId: contact.taxId,
          notes: contact.notes,
          active: contact.active,
        });
        live.current.clear();
        setForm(loaded);
        setBaseline(cloneContact(loaded));
        setQboId(contact.qboId);
        setSyncStatus(contact.syncStatus);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, mode, contactId]);

  function patch(partial: Partial<ContactInput>) {
    setForm((current) => ({ ...current, ...partial }));
    setSaved(false);
  }

  function patchAddress(which: "billingAddress" | "shippingAddress", key: keyof PostalAddress, value: string) {
    setForm((current) => ({
      ...current,
      [which]: { ...current[which], [key]: value },
    }));
    setSaved(false);
  }

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    const current = currentContact();
    if (!isDirty(current, baseline)) return false;
    savingRef.current = true;
    setSaveError(null);
    setSaved(false);
    const displayName = current.displayName.trim();
    if (!displayName) {
      setSaveError("Enter a display name.");
      savingRef.current = false;
      return false;
    }
    if (displayName.length > 500) {
      setSaveError("Display name must be 500 characters or less.");
      savingRef.current = false;
      return false;
    }
    if (current.primaryEmail.trim().length > 100) {
      setSaveError("Email must be 100 characters or less.");
      savingRef.current = false;
      return false;
    }
    if (current.phone.trim().length > 30) {
      setSaveError("Phone must be 30 characters or less.");
      savingRef.current = false;
      return false;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const id = await createContact(kind, current);
        router.push(`${listHref}/${id}`);
        return true;
      }
      if (!contactId) return false;
      await updateContact(kind, contactId, current, qboId);
      live.current.clear();
      setSyncStatus(qboId ? "pending" : "local");
      setBaseline(cloneContact(current));
      setSaved(true);
      return true;
    } catch (error) {
      setSaveError(errorText(error));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    await save();
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading {noun}…</p>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="page">
        <p className="banner error">That {noun} was not found.</p>
        <Link href={listHref}>Back to {listLabel.toLowerCase()}</Link>
      </main>
    );
  }

  const taxLabel = kind === "customer" ? "Tax ID (resale number)" : "Tax ID";

  return (
    <main className="page">
      <PageToolbar dirty={dirty} saving={saving} saved={saved} attemptSave onSave={() => void save()} />
      {loadError ? <p className="banner error">{loadError}</p> : null}
      {syncStatus === "conflict" ? (
        <p className="banner error">
          QuickBooks had a newer version of this {noun}. The local edit was discarded and the
          QuickBooks record was kept.
        </p>
      ) : null}
      {syncStatus === "error" ? (
        <p className="banner error">
          The last sync reported an error for this {noun}. Check Admin &gt; Integrations.
        </p>
      ) : null}
      <form onSubmit={onSubmit}>
        <div className="grid">
          <label>
            Display name
            <FastInput
              {...bindContact(live.current, "displayName", form.displayName, (next) => patch({ displayName: next }))}
              required
              maxLength={500}
            />
          </label>
          <label>
            Company
            <FastInput
              {...bindContact(live.current, "companyName", form.companyName, (next) => patch({ companyName: next }))}
              maxLength={500}
            />
          </label>
          <label>
            Given name
            <FastInput
              {...bindContact(live.current, "givenName", form.givenName, (next) => patch({ givenName: next }))}
              maxLength={100}
            />
          </label>
          <label>
            Family name
            <FastInput
              {...bindContact(live.current, "familyName", form.familyName, (next) => patch({ familyName: next }))}
              maxLength={100}
            />
          </label>
          <label>
            Email
            <FastInput
              type="email"
              {...bindContact(live.current, "primaryEmail", form.primaryEmail, (next) => patch({ primaryEmail: next }))}
              maxLength={100}
            />
          </label>
          <label>
            Phone
            <FastInput
              {...bindContact(live.current, "phone", form.phone, (next) => patch({ phone: next }))}
              maxLength={30}
            />
          </label>
          <label>
            {taxLabel}
            <FastInput
              {...bindContact(live.current, "taxId", form.taxId, (next) => patch({ taxId: next }))}
              maxLength={30}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => patch({ active: event.target.checked })}
            />
            Active
          </label>
        </div>
        <AddressFields
          legend="Billing address"
          value={form.billingAddress}
          onDraft={(key, value) => live.current.set(`billing.${key}`, value)}
          onChange={(key, value) => patchAddress("billingAddress", key, value)}
        />
        <AddressFields
          legend="Shipping address"
          value={form.shippingAddress}
          onDraft={(key, value) => live.current.set(`shipping.${key}`, value)}
          onChange={(key, value) => patchAddress("shippingAddress", key, value)}
        />
        {kind === "vendor" ? (
          <p className="hint">
            Vendor notes and the shipping address stay in ITS. QuickBooks vendors do not store them.
          </p>
        ) : null}
        <label>
          Notes
          <FastArea {...bindContact(live.current, "notes", form.notes, (next) => patch({ notes: next }))} />
        </label>
        <p className="hint">QuickBooks is updated the next time you sync from Admin &gt; Integrations.</p>
        {saveError ? <p className="banner error">{saveError}</p> : null}
        <div className="actions">
          <Link className="button secondary" href={listHref}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}

function bindContact(live: Map<string, string>, key: string, value: string, commit: (next: string) => void) {
  return {
    value,
    onDraft: (next: string) => {
      live.set(key, next);
    },
    onValue: commit,
  };
}

function AddressFields({
  legend,
  value,
  onChange,
  onDraft,
}: {
  legend: string;
  value: PostalAddress;
  onChange: (key: keyof PostalAddress, value: string) => void;
  onDraft: (key: keyof PostalAddress, value: string) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="grid">
        <label>
          Line 1
          <FastInput value={value.line1 ?? ""} onDraft={(next) => onDraft("line1", next)} onValue={(next) => onChange("line1", next)} />
        </label>
        <label>
          Line 2
          <FastInput value={value.line2 ?? ""} onDraft={(next) => onDraft("line2", next)} onValue={(next) => onChange("line2", next)} />
        </label>
        <label>
          City
          <FastInput value={value.city ?? ""} onDraft={(next) => onDraft("city", next)} onValue={(next) => onChange("city", next)} />
        </label>
        <label>
          State
          <FastInput
            value={value.countrySubDivisionCode ?? ""}
            onDraft={(next) => onDraft("countrySubDivisionCode", next)}
            onValue={(next) => onChange("countrySubDivisionCode", next)}
          />
        </label>
        <label>
          Postal code
          <FastInput
            value={value.postalCode ?? ""}
            onDraft={(next) => onDraft("postalCode", next)}
            onValue={(next) => onChange("postalCode", next)}
          />
        </label>
        <label>
          Country
          <FastInput value={value.country ?? ""} onDraft={(next) => onDraft("country", next)} onValue={(next) => onChange("country", next)} />
        </label>
      </div>
    </fieldset>
  );
}
