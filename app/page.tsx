"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { fetchItems } from "@/lib/items";
import type { ItemSummary } from "@/lib/types";

export default function HomePage() {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
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

  return (
    <main className="page">
      <div className="page-head">
        <h1>Items</h1>
        <Link className="button" href="/items/new">
          New item
        </Link>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      {loading ? <p className="muted">Loading items…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Quantity</th>
                <th>Taxonomy</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="sku">{item.sku || "—"}</td>
                  <td className="name">
                    <Link href={`/items/${item.id}`}>{item.name || "Untitled"}</Link>
                  </td>
                  <td>{item.quantity ?? "—"}</td>
                  <td>{item.taxonomyName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
