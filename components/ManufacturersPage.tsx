"use client";

import { FormEvent, useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import {
  addManufacturerAlias,
  createManufacturer,
  fetchManufacturers,
  mergeManufacturers,
  removeManufacturerAlias,
  renameManufacturer,
  type ManufacturerRecord,
} from "@/lib/manufacturers";

export function ManufacturersPage() {
  const [rows, setRows] = useState<ManufacturerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    setRows(await fetchManufacturers());
  }

  useEffect(() => {
    let cancelled = false;
    fetchManufacturers()
      .then((next) => {
        if (!cancelled) setRows(next);
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

  async function run(key: string, action: () => Promise<void>, ok: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setNotice(ok);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await run("create", async () => {
      await createManufacturer(trimmed);
      setName("");
    }, "Manufacturer saved.");
  }

  return (
    <main className="page">
      <p className="hint">
        Names match without regard to case or extra spaces. An alias such as Hynix resolves to the
        same manufacturer as SK hynix. Merge keeps the other name as an alias and moves its items.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      <form className="actions" onSubmit={(event) => void onCreate(event)}>
        <label>
          New manufacturer
          <input value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={busy !== null || name.trim() === ""}>
          {busy === "create" ? "Adding…" : "Add"}
        </button>
      </form>
      {loading ? <p className="muted">Loading manufacturers…</p> : null}
      {!loading && rows.length === 0 ? <p className="muted">No manufacturers yet.</p> : null}
      {rows.map((row) => (
        <ManufacturerCard
          key={row.id}
          row={row}
          others={rows.filter((other) => other.id !== row.id)}
          busy={busy}
          onRun={run}
        />
      ))}
    </main>
  );
}

function ManufacturerCard({
  row,
  others,
  busy,
  onRun,
}: {
  row: ManufacturerRecord;
  others: ManufacturerRecord[];
  busy: string | null;
  onRun: (key: string, action: () => Promise<void>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState(row.name);
  const [alias, setAlias] = useState("");
  const [mergeId, setMergeId] = useState("");

  useEffect(() => {
    setName(row.name);
  }, [row.name]);

  return (
    <section className="card integration-card maker-card">
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(row.id, () => renameManufacturer(row.id, name), "Name saved.");
        }}
      >
        <label>
          Name
          <input value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="secondary" disabled={busy !== null || name.trim() === row.name}>
          Rename
        </button>
        <span className="muted">{row.itemCount} items</span>
      </form>
      <p className="hint">Aliases</p>
      <ul className="alias-list">
        {row.aliases.length === 0 ? <li className="muted">None</li> : null}
        {row.aliases.map((entry) => (
          <li key={entry.id}>
            {entry.alias}
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => void onRun(entry.id, () => removeManufacturerAlias(entry.id), "Alias removed.")}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = alias.trim();
          if (!trimmed) return;
          void onRun(row.id + "-alias", async () => {
            await addManufacturerAlias(row.id, trimmed);
            setAlias("");
          }, "Alias added.");
        }}
      >
        <label>
          Add alias
          <input value={alias} autoComplete="off" onChange={(event) => setAlias(event.target.value)} />
        </label>
        <button type="submit" className="secondary" disabled={busy !== null || alias.trim() === ""}>
          Add alias
        </button>
      </form>
      {others.length > 0 ? (
        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mergeId) return;
            const other = others.find((entry) => entry.id === mergeId);
            if (!other) return;
            const ok = window.confirm(
              `Merge ${other.name} into ${row.name}? Items move here, and ${other.name} is kept as an alias.`,
            );
            if (!ok) return;
            void onRun(row.id + "-merge", async () => {
              await mergeManufacturers(row.id, mergeId);
              setMergeId("");
            }, `Merged ${other.name} into ${row.name}.`);
          }}
        >
          <label>
            Merge into this one
            <select value={mergeId} onChange={(event) => setMergeId(event.target.value)}>
              <option value="">Choose a manufacturer</option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary" disabled={busy !== null || mergeId === ""}>
            Merge
          </button>
        </form>
      ) : null}
    </section>
  );
}
