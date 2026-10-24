"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { loadUsedInKits, type UsedInKit } from "@/lib/kits";

export function UsedInKits({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<UsedInKit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadUsedInKits(itemId)
      .then((loaded) => {
        if (!cancelled) setRows(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (error) return <p className="hint">{error}</p>;
  if (!rows || rows.length === 0) return null;

  return (
    <section className="kit-panel" aria-label="Used in kits">
      <h2>Used in kits</h2>
      <ul className="kit-used">
        {rows.map((row) => (
          <li key={row.kitItemId}>
            <Link href={`/items/${row.kitItemId}`}>{row.sku}</Link> {row.name} · {row.qtyPerKit} per kit
          </li>
        ))}
      </ul>
    </section>
  );
}
