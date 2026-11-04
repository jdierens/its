"use client";

import { useState } from "react";
import { errorText } from "@/lib/errors";
import { createQuoteProspect } from "@/lib/quoteReviewsServer";
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
}) {
  const picker = originatorPicker(side, direction);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState("");
  const [person, setPerson] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const customersAndProspects = picker.party === "customer";
  const partyValue = customersAndProspects
    ? prospectId
      ? `prospect:${prospectId}`
      : customerId
        ? `customer:${customerId}`
        : ""
    : vendorId
      ? `vendor:${vendorId}`
      : "";

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
    if (kind === "vendor") {
      onOriginator({ originatorKind: dds ? "dds" : "vendor", vendorId: id ?? "", customerId: "", prospectId: "" });
      return;
    }
    if (kind === "prospect") {
      onOriginator({ originatorKind: dds ? "dds" : "prospect", vendorId: "", customerId: "", prospectId: id ?? "" });
      return;
    }
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
          <input value="DDS" readOnly disabled={disabled} aria-label="Originator DDS" />
        </label>
      ) : null}
      <label>
        {partyLabel}
        <select value={partyValue} disabled={disabled} aria-label={partyLabel} onChange={(event) => choose(event.target.value)}>
          <option value="">{customersAndProspects ? "Choose a customer or prospect" : "Choose a vendor"}</option>
          {customersAndProspects ? (
            <>
              <optgroup label="Customers">
                {customers.map((party) => (
                  <option key={party.id} value={`customer:${party.id}`}>
                    {party.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Prospects">
                {prospects.map((party) => (
                  <option key={party.id} value={`prospect:${party.id}`}>
                    {party.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            vendors.map((party) => (
              <option key={party.id} value={`vendor:${party.id}`}>
                {party.name}
              </option>
            ))
          )}
        </select>
      </label>
      <label>
        Contact
        <input value={contact} disabled={disabled} aria-label="Contact" onChange={(event) => onContact(event.target.value)} />
      </label>
      {customersAndProspects && !disabled ? (
        <div className="qr-prospect">
          {adding ? (
            <>
              <input aria-label="Prospect company" placeholder="Prospect company" value={company} onChange={(event) => setCompany(event.target.value)} />
              <input aria-label="Prospect contact" placeholder="Contact" value={person} onChange={(event) => setPerson(event.target.value)} />
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
