"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchBin } from "@/lib/binActions";
import type { BinRecord } from "@/lib/bins";
import { errorText } from "@/lib/errors";

const TYPE_NAME: Record<string, string> = { P: "Pallet", C: "Crate", B: "Box" };

export function BinView({ reference }: { reference: string }) {
  const [row, setRow] = useState<BinRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchBin(reference);
        if (cancelled) return;
        if (!loaded) {
          setMissing(true);
          return;
        }
        setRow(loaded);
      } catch (error) {
        if (!cancelled) setMessage(errorText(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const typeName = row ? TYPE_NAME[row.type] ?? row.type : TYPE_NAME[reference.slice(-1)] ?? "";

  return (
    <main className="page bin-view">
      <p className="bin-reference">{reference}</p>
      <p className="hint">{typeName ? `${typeName} label` : "Bin"}</p>
      {message ? <p className="banner error">{message}</p> : null}
      {missing ? <p className="banner error">No bin is numbered {reference}.</p> : null}
      {row ? (
        <dl className="bin-facts">
          <div>
            <dt>Number</dt>
            <dd>{row.number}</dd>
          </div>
          <div>
            <dt>Printed</dt>
            <dd>{row.printedCount}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{new Date(row.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Last printed</dt>
            <dd>{row.lastPrintedAt ? new Date(row.lastPrintedAt).toLocaleString() : "Not yet"}</dd>
          </div>
          {row.notes ? (
            <div>
              <dt>Notes</dt>
              <dd>{row.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <p>
        <Link href="/scan">Scan another</Link>
      </p>
    </main>
  );
}
