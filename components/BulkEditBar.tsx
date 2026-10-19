"use client";

import { useState } from "react";
import type { Country } from "@/lib/countries";
import { countryLabel } from "@/lib/itemFields";

export type BulkField = "condition" | "coo" | "eccn";

export function BulkEditBar({
  count,
  countries,
  onApply,
  onClear,
}: {
  count: number;
  countries: Country[];
  onApply: (field: BulkField, value: string, label: string) => void;
  onClear: () => void;
}) {
  const [field, setField] = useState<BulkField>("condition");
  const [condition, setCondition] = useState("Used");
  const [coo, setCoo] = useState("");
  const [eccn, setEccn] = useState("5A992.C");

  function apply() {
    if (field === "condition") onApply(field, condition, condition);
    else if (field === "coo") {
      const country = countries.find((row) => row.alpha3 === coo);
      onApply(field, coo, country ? countryLabel(country.alpha3, country.name) : "empty");
    } else onApply(field, eccn.trim(), eccn.trim() || "5A992.C");
  }

  return (
    <div className="bulk-bar">
      <span>
        {count} selected
      </span>
      <label>
        Field
        <select aria-label="Bulk field" value={field} onChange={(event) => setField(event.target.value as BulkField)}>
          <option value="condition">Condition</option>
          <option value="coo">COO</option>
          <option value="eccn">ECCN</option>
        </select>
      </label>
      {field === "condition" ? (
        <select aria-label="Bulk condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
          <option value="Used">Used</option>
          <option value="New">New</option>
        </select>
      ) : null}
      {field === "coo" ? (
        <select aria-label="Bulk country" value={coo} onChange={(event) => setCoo(event.target.value)}>
          <option value="">No country</option>
          {countries.map((country) => (
            <option key={country.alpha3} value={country.alpha3}>
              {countryLabel(country.alpha3, country.name)}
            </option>
          ))}
        </select>
      ) : null}
      {field === "eccn" ? (
        <input aria-label="Bulk ECCN" value={eccn} onChange={(event) => setEccn(event.target.value)} />
      ) : null}
      <button type="button" onClick={apply}>
        Apply
      </button>
      <button type="button" className="secondary" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
