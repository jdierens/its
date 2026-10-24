"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QueryField } from "@/components/QueryField";
import { usePageMeta } from "@/components/AppShell";
import {
  clearSearchFilters,
  matchBadge,
  parseAttributeSearchParams,
  type AttributeSearchResponse,
  type SearchFieldView,
  type SearchItem,
  type SearchMode,
} from "@/lib/itemAttributeSearch";

export function ItemAttributeSearch() {
  usePageMeta({
    title: "Advanced search",
    crumbs: [
      { label: "Inventory" },
      { label: "Items", href: "/items" },
      { label: "Advanced search" },
    ],
    backHref: "/items",
    backLabel: "Items",
  });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsed = parseAttributeSearchParams(searchParams);
  const [result, setResult] = useState<AttributeSearchResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    setLoading(true);
    const query = searchParams.toString();
    fetch(`/api/items/search${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as AttributeSearchResponse & { message?: string };
        if (!response.ok) throw new Error(body.message || "Search failed.");
        return body;
      })
      .then((body) => {
        if (requestId.current !== id) return;
        setResult(body);
        setError("");
        if (body.suggested) applySuggested(body.suggested);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setError(reason instanceof Error ? reason.message : "Search failed.");
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
    return () => controller.abort();
    // applySuggested closes over the current params. Re-running on searchParams is the refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function replace(params: URLSearchParams) {
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function applySuggested(suggested: Record<string, string | string[]>) {
    if (searchParams.get("seeded") === "1") return;
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(suggested)) {
      params.delete(key);
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (entry) params.append(key, entry);
      }
    }
    params.set("seeded", "1");
    params.delete("page");
    replace(params);
  }

  function setMode(mode: SearchMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", mode);
    params.delete("page");
    replace(params);
  }

  function setTax(shortCode: string) {
    const params = new URLSearchParams(searchParams.toString());
    const part = params.get("part");
    const mode = params.get("mode") === "part" ? "part" : "taxonomy";
    clearSearchFilters(params);
    params.set("mode", mode);
    if (part) {
      params.set("part", part);
      params.set("seeded", "1");
    }
    if (shortCode) params.set("tax", shortCode);
    replace(params);
  }

  function toggleValue(field: SearchFieldView, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const key = `attr.${field.name}`;
    const current = params.getAll(key);
    params.delete(key);
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    for (const entry of next) params.append(key, entry);
    params.delete("page");
    replace(params);
  }

  function setRange(name: string, side: "min" | "max", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const key = `${side}.${name}`;
    if (value.trim()) params.set(key, value.trim());
    else params.delete(key);
    params.delete("page");
    replace(params);
  }

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    clearSearchFilters(params);
    replace(params);
  }

  function setPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    replace(params);
  }

  const fields = result?.fields ?? [];
  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (result?.pageSize || 50)));

  return (
    <main className="page item-search">
      <div className="item-search-tabs" role="tablist" aria-label="Advanced search">
        <button
          type="button"
          role="tab"
          aria-selected={parsed.mode === "taxonomy"}
          className={parsed.mode === "taxonomy" ? "active" : ""}
          onClick={() => setMode("taxonomy")}
        >
          Filter by taxonomy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={parsed.mode === "part"}
          className={parsed.mode === "part" ? "active" : ""}
          onClick={() => setMode("part")}
        >
          Similar part
        </button>
      </div>

      {parsed.mode === "part" ? (
        <label>
          Part number
          <QueryField
            type="search"
            aria-label="Part number"
            placeholder="Part number, OEM part number, or model"
            value={parsed.part}
            onCommit={(next) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("mode", "part");
              clearSearchFilters(params);
              params.set("mode", "part");
              if (parsed.tax) params.set("tax", parsed.tax);
              if (next) params.set("part", next);
              replace(params);
            }}
          />
        </label>
      ) : null}

      <label>
        Taxonomy
        <select aria-label="Taxonomy" value={parsed.tax} onChange={(event) => setTax(event.target.value)}>
          <option value="">Choose a taxonomy</option>
          {(result?.taxonomies ?? []).map((taxonomy) => (
            <option key={taxonomy.id} value={taxonomy.shortCode}>
              {taxonomy.shortCode} — {taxonomy.name}
            </option>
          ))}
        </select>
      </label>

      {fields.length > 0 ? (
        <div className="item-search-fields">
          {fields.map((field) =>
            field.usesList ? (
              <ValuePicker
                key={field.id}
                field={field}
                selected={parsed.lists[field.name] ?? []}
                onToggle={(value) => toggleValue(field, value)}
              />
            ) : (
              <RangeField
                key={field.id}
                field={field}
                min={parsed.ranges[field.name]?.min ?? ""}
                max={parsed.ranges[field.name]?.max ?? ""}
                onCommit={setRange}
              />
            ),
          )}
        </div>
      ) : null}

      <div className="item-search-bar">
        <button type="button" className="button secondary" onClick={clear}>
          Clear
        </button>
        <p className="items-count">{loading && !result ? "Loading…" : `${total} item${total === 1 ? "" : "s"}`}</p>
      </div>

      {error ? <p className="banner error">{error}</p> : null}
      {result?.message ? <p className="banner">{result.message}</p> : null}

      <div className="item-search-scroll">
        <table className="item-search-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Manufacturer</th>
              <th>Part number</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ResultRow key={item.id} item={item} />
            ))}
          </tbody>
        </table>
      </div>
      {parsed.tax && !loading && items.length === 0 && !error ? <p className="muted">No items match these fields.</p> : null}

      {total > (result?.pageSize || 50) ? (
        <div className="item-search-pager">
          <button type="button" className="button secondary" disabled={parsed.page <= 1} onClick={() => setPage(parsed.page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {parsed.page} of {pageCount}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={parsed.page >= pageCount}
            onClick={() => setPage(parsed.page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </main>
  );
}

function ResultRow({ item }: { item: SearchItem }) {
  const badge = matchBadge(item.matchCount, item.seedCount);
  return (
    <tr>
      <td>
        <Link href={`/items/${item.id}`}>{item.sku || "—"}</Link>
      </td>
      <td>
        {item.name || "—"}
        {badge ? <span className="match-badge">{badge}</span> : null}
      </td>
      <td>{item.manufacturer || "—"}</td>
      <td>{item.partNumber || "—"}</td>
      <td className="num">{item.quantity == null ? "—" : item.quantity}</td>
    </tr>
  );
}

function ValuePicker({
  field,
  selected,
  onToggle,
}: {
  field: SearchFieldView;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const summary = selected.length > 0 ? selected.join(", ") : "Any";
  return (
    <div className="item-search-field">
      <span>{field.label}</span>
      <details>
        <summary>{summary}</summary>
        <ul>
          {field.options.map((option) => {
            const checked = selected.some((value) => value.toLowerCase() === option.value.toLowerCase());
            return (
              <li key={option.value} className={option.count === 0 ? "is-empty" : ""}>
                <label>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(option.value)} />
                  <span>{option.value}</span>
                  <span className="option-count">{option.count}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

function RangeField({
  field,
  min,
  max,
  onCommit,
}: {
  field: SearchFieldView;
  min: string;
  max: string;
  onCommit: (name: string, side: "min" | "max", value: string) => void;
}) {
  return (
    <div className="item-search-field">
      <span>{field.label}</span>
      <div className="item-search-range">
        <label>
          Min
          <QueryField
            inputMode={field.dataType === "decimal" ? "decimal" : "numeric"}
            aria-label={`${field.label} minimum`}
            value={min}
            onCommit={(next) => onCommit(field.name, "min", next)}
          />
        </label>
        <label>
          Max
          <QueryField
            inputMode={field.dataType === "decimal" ? "decimal" : "numeric"}
            aria-label={`${field.label} maximum`}
            value={max}
            onCommit={(next) => onCommit(field.name, "max", next)}
          />
        </label>
      </div>
    </div>
  );
}
