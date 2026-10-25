"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Hit = {
  id: string;
  sku: string;
  name: string;
};

export function EbayListingMatch({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/ebay/listing-items?q=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
      const body = (await response.json()) as { ok?: boolean; message?: string; items?: Hit[] };
      if (!response.ok || !body.ok) {
        setHits([]);
        setMessage(body.message || "Item search failed.");
        return;
      }
      const items = body.items ?? [];
      setHits(items);
      if (items.length === 0) setMessage("No items matched that SKU or name.");
    } catch {
      setHits([]);
      setMessage("Item search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function match(itemId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ebay/listing-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, itemId }),
      });
      const body = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.message || "That listing could not be matched.");
        return;
      }
      setHits([]);
      router.refresh();
    } catch {
      setMessage("That listing could not be matched.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ebay-match" onSubmit={(event) => void search(event)}>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Item SKU or name"
        aria-label="Item SKU or name"
        maxLength={80}
      />
      <button type="submit" className="secondary" disabled={busy || query.trim().length === 0}>
        Find
      </button>
      {message ? <p className="hint">{message}</p> : null}
      {hits.length > 0 ? (
        <ul className="ebay-match-hits">
          {hits.map((hit) => (
            <li key={hit.id}>
              <span>
                <span className="sku">{hit.sku}</span> {hit.name}
              </span>
              <button type="button" disabled={busy} onClick={() => void match(hit.id)}>
                Match
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
