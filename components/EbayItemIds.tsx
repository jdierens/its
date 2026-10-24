"use client";

import { useState } from "react";
import { ebayItemUrl } from "@/lib/ebay/itemUrl";

export function EbayItemIds({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return "—";
  const [first, ...rest] = ids;
  return (
    <span className="ebay-ids">
      <a
        href={ebayItemUrl(first)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {first}
      </a>
      {rest.length > 0 ? (
        <button
          type="button"
          className="ebay-more"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          +{rest.length}
        </button>
      ) : null}
      {open
        ? rest.map((id) => (
            <a
              key={id}
              href={ebayItemUrl(id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {id}
            </a>
          ))
        : null}
    </span>
  );
}
