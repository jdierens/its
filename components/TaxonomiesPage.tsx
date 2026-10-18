"use client";

import Link from "next/link";
import { DragEvent, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errors";
import { fetchTaxonomies, saveTaxonomyOrder, updateTaxonomy } from "@/lib/items";
import type { Taxonomy } from "@/lib/types";

const LONG_CODE = /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/;
const SHORT_CODE = /^[A-Z0-9]{3}$/;

function cleanCode(value: string): string {
  return value.trim().toUpperCase();
}

export function TaxonomiesPage() {
  const [rows, setRows] = useState<Taxonomy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const orderLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchTaxonomies()
      .then((taxonomies) => {
        if (!cancelled) setRows(taxonomies);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateRow(id: string, patch: Partial<Taxonomy>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setStatus(null);
  }

  async function persistOrder(next: Taxonomy[]) {
    const ordered = next.map((row, index) => ({ ...row, sortOrder: index + 1 }));
    setRows(ordered);
    setSavingOrder(true);
    setError(null);
    setStatus(null);
    try {
      await saveTaxonomyOrder(ordered.map((row) => row.id));
      setStatus("Order saved.");
    } catch (err) {
      setError(errorText(err));
      try {
        setRows(await fetchTaxonomies());
      } catch (reloadError) {
        setError(errorText(reloadError));
      }
    } finally {
      setSavingOrder(false);
    }
  }

  function move(fromId: string, toIndex: number) {
    if (orderLock.current || savingOrder) return;
    const fromIndex = rows.findIndex((row) => row.id === fromId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) return;
    const next = rows.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    orderLock.current = true;
    void persistOrder(next).finally(() => {
      orderLock.current = false;
    });
  }

  function onDrop(event: DragEvent<HTMLTableRowElement>, toId: string) {
    event.preventDefault();
    const fromId = event.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    setOverId(null);
    if (!fromId) return;
    const toIndex = rows.findIndex((row) => row.id === toId);
    move(fromId, toIndex);
  }

  async function saveRow(row: Taxonomy) {
    const name = row.name.trim();
    const longCode = row.longCode ? cleanCode(row.longCode) : "";
    const shortCode = row.shortCode ? cleanCode(row.shortCode) : "";
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (longCode && !LONG_CODE.test(longCode)) {
      setError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
      return;
    }
    if (shortCode && !SHORT_CODE.test(shortCode)) {
      setError("Short code must be exactly 3 letters or digits.");
      return;
    }

    setSavingId(row.id);
    setError(null);
    setStatus(null);
    try {
      await updateTaxonomy(row.id, {
        name,
        longCode: longCode || null,
        shortCode: shortCode || null,
      });
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, name, longCode: longCode || null, shortCode: shortCode || null }
            : item,
        ),
      );
      setStatus(`Saved ${name}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Taxonomies</h1>
        <Link className="button secondary" href="/">
          Back
        </Link>
      </div>
      <p className="hint page-note">
        Codes are stored in uppercase. The short code is exactly 3 characters and is printed on the
        label. Drag a row, or use Up and Down, to set the order used in taxonomy lists. A taxonomy
        created from the item form is added at the end.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {status ? <p className="banner ok">{status}</p> : null}
      {loading ? <p className="muted">Loading taxonomies…</p> : null}
      {!loading && rows.length === 0 ? <p className="muted">No taxonomies yet.</p> : null}
      {rows.length > 0 ? (
        <div className="card">
          <table className="taxonomy-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Long code</th>
                <th>Short code</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={overId === row.id ? "drop-target" : undefined}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dragId && dragId !== row.id) setOverId(row.id);
                  }}
                  onDragLeave={() => setOverId((current) => (current === row.id ? null : current))}
                  onDrop={(event) => onDrop(event, row.id)}
                >
                  <td className="order-cell">
                    <button
                      type="button"
                      className="secondary drag-handle"
                      draggable={!savingOrder}
                      aria-label={`Drag to reorder ${row.name}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", row.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragId(row.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                    >
                      Drag
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Move ${row.name} up`}
                      disabled={savingOrder || index === 0}
                      onClick={() => move(row.id, index - 1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Move ${row.name} down`}
                      disabled={savingOrder || index === rows.length - 1}
                      onClick={() => move(row.id, index + 1)}
                    >
                      Down
                    </button>
                  </td>
                  <td>
                    <input
                      aria-label={`Name for ${row.name}`}
                      value={row.name}
                      onChange={(event) => updateRow(row.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="code-input"
                      aria-label={`Long code for ${row.name}`}
                      value={row.longCode ?? ""}
                      placeholder="CRD/NIC"
                      spellCheck={false}
                      onChange={(event) =>
                        updateRow(row.id, { longCode: event.target.value.toUpperCase() })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="code-input code-short"
                      aria-label={`Short code for ${row.name}`}
                      value={row.shortCode ?? ""}
                      placeholder="NIC"
                      maxLength={3}
                      spellCheck={false}
                      onChange={(event) =>
                        updateRow(row.id, {
                          shortCode: event.target.value.toUpperCase().slice(0, 3),
                        })
                      }
                    />
                  </td>
                  <td className="save-cell">
                    <button
                      type="button"
                      disabled={savingId === row.id}
                      onClick={() => void saveRow(row)}
                    >
                      {savingId === row.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
