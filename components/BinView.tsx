"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

type BinRow = {
  number: number;
  type: string;
  reference: string;
  created_at: string;
  printed_count: number;
  last_printed_at: string | null;
  notes: string | null;
};

const TYPE_NAME: Record<string, string> = { P: "Pallet", C: "Crate", B: "Box" };

export function BinView({ reference }: { reference: string }) {
  const [row, setRow] = useState<BinRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    supabase
      .from("bins")
      .select("number, type, reference, created_at, printed_count, last_printed_at, notes")
      .eq("reference", reference)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setMessage(errorText(error));
          return;
        }
        if (!data) {
          setMissing(true);
          return;
        }
        setRow(data as BinRow);
      });
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
            <dd>{row.printed_count}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{new Date(row.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Last printed</dt>
            <dd>{row.last_printed_at ? new Date(row.last_printed_at).toLocaleString() : "Not yet"}</dd>
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
