"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { usePageMeta } from "@/components/AppShell";
import { createContact, fetchContact, updateContact, type ContactInput } from "@/lib/contacts";
import { errorText } from "@/lib/errors";
import type { ContactKind, PostalAddress, SyncStatus } from "@/lib/qbo/map";

const EMPTY_ADDRESS: PostalAddress = {
  line1: "",
  line2: "",
  city: "",
  countrySubDivisionCode: "",
  postalCode: "",
  country: "",
};

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
        setForm({
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    const displayName = form.displayName.trim();
    if (!displayName) {
      setSaveError("Enter a display name.");
      return;
    }
    if (displayName.length > 500) {
      setSaveError("Display name must be 500 characters or less.");
      return;
    }
    if (form.primaryEmail.trim().length > 100) {
      setSaveError("Email must be 100 characters or less.");
      return;
    }
    if (form.phone.trim().length > 30) {
      setSaveError("Phone must be 30 characters or less.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const id = await createContact(kind, form);
        router.push(`${listHref}/${id}`);
        return;
      }
      if (!contactId) return;
      await updateContact(kind, contactId, form, qboId);
      setSyncStatus(qboId ? "pending" : "local");
      setSaved(true);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
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
            <input
              value={form.displayName}
              onChange={(event) => patch({ displayName: event.target.value })}
              required
              maxLength={500}
            />
          </label>
          <label>
            Company
            <input
              value={form.companyName}
              onChange={(event) => patch({ companyName: event.target.value })}
              maxLength={500}
            />
          </label>
          <label>
            Given name
            <input
              value={form.givenName}
              onChange={(event) => patch({ givenName: event.target.value })}
              maxLength={100}
            />
          </label>
          <label>
            Family name
            <input
              value={form.familyName}
              onChange={(event) => patch({ familyName: event.target.value })}
              maxLength={100}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.primaryEmail}
              onChange={(event) => patch({ primaryEmail: event.target.value })}
              maxLength={100}
            />
          </label>
          <label>
            Phone
            <input
              value={form.phone}
              onChange={(event) => patch({ phone: event.target.value })}
              maxLength={30}
            />
          </label>
          <label>
            {taxLabel}
            <input
              value={form.taxId}
              onChange={(event) => patch({ taxId: event.target.value })}
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
          onChange={(key, value) => patchAddress("billingAddress", key, value)}
        />
        <AddressFields
          legend="Shipping address"
          value={form.shippingAddress}
          onChange={(key, value) => patchAddress("shippingAddress", key, value)}
        />
        {kind === "vendor" ? (
          <p className="hint">
            Vendor notes and the shipping address stay in ITS. QuickBooks vendors do not store them.
          </p>
        ) : null}
        <label>
          Notes
          <textarea value={form.notes} onChange={(event) => patch({ notes: event.target.value })} />
        </label>
        <p className="hint">QuickBooks is updated the next time you sync from Admin &gt; Integrations.</p>
        {saveError ? <p className="banner error">{saveError}</p> : null}
        {saved ? <p className="banner ok">Saved. Sync status is {qboId ? "pending" : "local"}.</p> : null}
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <Link className="button secondary" href={listHref}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}

function AddressFields({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: PostalAddress;
  onChange: (key: keyof PostalAddress, value: string) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="grid">
        <label>
          Line 1
          <input value={value.line1 ?? ""} onChange={(event) => onChange("line1", event.target.value)} />
        </label>
        <label>
          Line 2
          <input value={value.line2 ?? ""} onChange={(event) => onChange("line2", event.target.value)} />
        </label>
        <label>
          City
          <input value={value.city ?? ""} onChange={(event) => onChange("city", event.target.value)} />
        </label>
        <label>
          State
          <input
            value={value.countrySubDivisionCode ?? ""}
            onChange={(event) => onChange("countrySubDivisionCode", event.target.value)}
          />
        </label>
        <label>
          Postal code
          <input
            value={value.postalCode ?? ""}
            onChange={(event) => onChange("postalCode", event.target.value)}
          />
        </label>
        <label>
          Country
          <input value={value.country ?? ""} onChange={(event) => onChange("country", event.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}
