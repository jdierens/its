"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { listItemEntries } from "@/lib/itemStockActions";
import type { ItemEntry } from "@/lib/itemStock";
import { formatMoveWhen } from "@/lib/moveInventory";

export function ItemEntries({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<ItemEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await listItemEntries(itemId);
        if (!cancelled) {
          setRows(loaded);
          setError(null);
        }
      } catch (cause: unknown) {
        if (!cancelled) setError(errorText(cause));
      }
    }
    void load();
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [itemId]);

  return (
    <section className="card item-entries" id="item-entries" aria-label="Recent entries">
      <h2>Recent entries</h2>
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : rows === null ? (
        <p className="hint">Loading entries…</p>
      ) : rows.length === 0 ? (
        <p className="hint">No inventory entries for this SKU yet.</p>
      ) : (
        <>
          <p className="hint" id="item-entries-scope">
            Receives, put-aways, moves, and picks for this SKU, newest first.
            {rows.length === 50 ? " Showing the newest 50." : ""}
          </p>
          <div className="move-recent-scroll" tabIndex={0} aria-label="Recent entries for this SKU">
            <table className="receive-table">
              <thead>
                <tr>
                  <th className="fit">Date/time</th>
                  <th className="fit">Init.</th>
                  <th>What</th>
                  <th>From</th>
                  <th>Bin</th>
                  <th className="num fit">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="fit">{formatMoveWhen(row.occurredAt)}</td>
                    <td className="fit initials">{row.initials}</td>
                    <td>{row.what}</td>
                    <td>{row.fromPlace}</td>
                    <td>{row.bin}</td>
                    <td className="num fit">{row.qty ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
