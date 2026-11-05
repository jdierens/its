"use client";

import { useEffect, useState } from "react";
import { QuoteFitInput } from "@/components/QuoteFitInput";
import { QuotePartyPicker } from "@/components/QuotePartyPicker";
import { errorText } from "@/lib/errors";
import { createQuoteProspect, searchQuoteCustomers, searchQuoteVendors } from "@/lib/quoteReviewsServer";
import { originatorPicker, type OriginatorIds, type QuotePartyOption } from "@/lib/quoteReviews";

export function QuoteOriginatorFields({
  side,
  direction,
  originatorKind,
  vendorId,
  customerId,
  prospectId,
  contact,
  disabled,
  vendors,
  customers,
  prospects,
  onOriginator,
  onContact,
  onProspect,
  onCustomer,
  onVendor,
}: {
  side: string;
  direction: string;
  originatorKind: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
  contact: string;
  disabled: boolean;
  vendors: QuotePartyOption[];
  customers: QuotePartyOption[];
  prospects: QuotePartyOption[];
  onOriginator: (next: OriginatorIds) => void;
  onContact: (contact: string) => void;
  onProspect: (prospect: QuotePartyOption) => void;
  onCustomer?: (party: QuotePartyOption) => void;
  onVendor?: (party: QuotePartyOption) => void;
}) {
  const picker = originatorPicker(side, direction);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState("");
  const [person, setPerson] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [partyQuery, setPartyQuery] = useState("");
  const [hits, setHits] = useState<QuotePartyOption[] | null>(null);
  const [remembered, setRemembered] = useState<QuotePartyOption[]>([]);
  const [pending, setPending] = useState(false);
  const customersAndProspects = picker.party === "customer";

  useEffect(() => {
    setHits(null);
  }, [customersAndProspects]);

  useEffect(() => {
    const trimmed = partyQuery.trim();
    if (!trimmed) {
      setHits(null);
      setPending(false);
      return;
    }
    setPending(true);
    let cancel = false;
    const handle = window.setTimeout(() => {
      const run = customersAndProspects ? searchQuoteCustomers(trimmed) : searchQuoteVendors(trimmed);
      void run
        .then((rows) => {
          if (!cancel) setHits(rows);
        })
        .catch(() => {
          if (!cancel) setHits([]);
        })
        .finally(() => {
          if (!cancel) setPending(false);
        });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [customersAndProspects, partyQuery]);
  const partyValue = customersAndProspects
    ? prospectId
      ? `prospect:${prospectId}`
      : customerId
        ? `customer:${customerId}`
        : ""
    : vendorId
      ? `vendor:${vendorId}`
      : "";

  const pinned = mergeParties(remembered, customersAndProspects ? customers : vendors);
  const foundParties = mergeParties(hits ?? [], pinned);

  function choose(value: string) {
    const dds = picker.kind === "dds";
    if (!value) {
      onOriginator({
        originatorKind: dds ? "dds" : picker.party === "vendor" ? "vendor" : "customer",
        vendorId: "",
        customerId: "",
        prospectId: "",
      });
      return;
    }
    const [kind, id] = value.split(":");
    const picked = foundParties.find((party) => party.id === id) ?? prospects.find((party) => party.id === id);
    if (picked && kind !== "prospect") setRemembered((current) => mergeParties(current, [picked]));
    if (kind === "vendor") {
      if (picked) onVendor?.(picked);
      onOriginator({ originatorKind: dds ? "dds" : "vendor", vendorId: id ?? "", customerId: "", prospectId: "" });
      return;
    }
    if (kind === "prospect") {
      onOriginator({ originatorKind: dds ? "dds" : "prospect", vendorId: "", customerId: "", prospectId: id ?? "" });
      return;
    }
    if (picked) onCustomer?.(picked);
    onOriginator({ originatorKind: dds ? "dds" : "customer", vendorId: "", customerId: id ?? "", prospectId: "" });
  }

  async function saveProspect() {
    setSaving(true);
    setProblem("");
    try {
      const created = await createQuoteProspect({ displayName: company, contactName: person });
      onProspect(created);
      onOriginator({
        originatorKind: picker.kind === "dds" ? "dds" : "prospect",
        vendorId: "",
        customerId: "",
        prospectId: created.id,
      });
      if (!contact.trim() && person.trim()) onContact(person.trim());
      setCompany("");
      setPerson("");
      setAdding(false);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const partyLabel = customersAndProspects ? (picker.kind === "dds" ? "Counterparty" : "Customer or prospect") : picker.kind === "dds" ? "Counterparty" : "Vendor";

  return (
    <>
      {picker.kind === "dds" ? (
        <label>
          Originator
          <QuoteFitInput floor={3} cap={4} value="DDS" readOnly disabled={disabled} aria-label="Originator DDS" />
        </label>
      ) : null}
      <label>
        {partyLabel}
        <QuotePartyPicker
          label={partyLabel}
          value={partyValue}
          placeholder={customersAndProspects ? "Type a customer or prospect" : "Type a vendor"}
          disabled={disabled}
          pending={pending}
          onQuery={setPartyQuery}
          groups={
            customersAndProspects
              ? [
                  { label: "Customers", options: foundParties.map((party) => ({ value: `customer:${party.id}`, name: party.name })) },
                  { label: "Prospects", options: prospects.map((party) => ({ value: `prospect:${party.id}`, name: party.name })) },
                ]
              : [{ label: "Vendors", options: foundParties.map((party) => ({ value: `vendor:${party.id}`, name: party.name })) }]
          }
          onChange={choose}
        />
      </label>
      <label>
        Contact
        <QuoteFitInput floor={8} cap={28} value={contact} disabled={disabled} aria-label="Contact" onChange={(event) => onContact(event.target.value)} />
      </label>
      {customersAndProspects && !disabled ? (
        <div className="qr-prospect">
          {adding ? (
            <>
              <QuoteFitInput floor={16} cap={32} aria-label="Prospect company" placeholder="Prospect company" value={company} onChange={(event) => setCompany(event.target.value)} />
              <QuoteFitInput floor={8} cap={24} aria-label="Prospect contact" placeholder="Contact" value={person} onChange={(event) => setPerson(event.target.value)} />
              <button type="button" className="button" disabled={saving} onClick={() => void saveProspect()}>
                {saving ? "Saving…" : "Save prospect"}
              </button>
              <button type="button" className="button secondary" disabled={saving} onClick={() => setAdding(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="button secondary" onClick={() => setAdding(true)}>
              New prospect
            </button>
          )}
          {problem ? (
            <p className="hint" role="alert">
              {problem}
            </p>
          ) : null}
          {originatorKind === "prospect" || prospectId ? <p className="hint">Prospects are not customers yet. Pick the customer once the company exists.</p> : null}
        </div>
      ) : null}
    </>
  );
}

function mergeParties(hits: QuotePartyOption[], pinned: QuotePartyOption[]): QuotePartyOption[] {
  const seen = new Set(hits.map((party) => party.id));
  return [...hits, ...pinned.filter((party) => !seen.has(party.id))];
}
