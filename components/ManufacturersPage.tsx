"use client";

import { FormEvent, useEffect, useState } from "react";
import { GitMerge, Plus, Trash2 } from "lucide-react";
import { PageToolbar, ToolbarButton } from "@/components/PageToolbar";
import { errorText } from "@/lib/errors";
import { isDirty } from "@/lib/formDirty";
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
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function applyRows(next: ManufacturerRecord[]) {
    setRows(next);
    setDraftNames((current) => {
      const drafts: Record<string, string> = {};
      for (const row of next) {
        const draft = current[row.id];
        drafts[row.id] = draft !== undefined && draft !== row.name ? draft : row.name;
      }
      return drafts;
    });
  }

  async function reload() {
    applyRows(await fetchManufacturers());
  }

  useEffect(() => {
    let cancelled = false;
    fetchManufacturers()
      .then((next) => {
        if (!cancelled) applyRows(next);
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

  const loadedNames = Object.fromEntries(rows.map((row) => [row.id, row.name]));
  const dirty = isDirty({ name, names: draftNames }, { name: "", names: loadedNames });

  async function onSave() {
    const trimmed = name.trim();
    const renames = rows.flatMap((row) => {
      const next = (draftNames[row.id] ?? row.name).trim();
      if (!next || next === row.name) return [];
      return [{ id: row.id, name: next }];
    });
    if (!trimmed && renames.length === 0) {
      const blankRename = rows.some((row) => (draftNames[row.id] ?? row.name).trim() === "");
      setError(blankRename ? "Name is required." : "Enter a manufacturer name.");
      return;
    }
    setBusy("save");
    setError(null);
    setNotice(null);
    setSaved(false);
    try {
      if (trimmed) {
        await createManufacturer(trimmed);
        setName("");
      }
      for (const rename of renames) await renameManufacturer(rename.id, rename.name);
      const next = await fetchManufacturers();
      setRows(next);
      setDraftNames(Object.fromEntries(next.map((row) => [row.id, row.name])));
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page">
      <PageToolbar
        dirty={dirty}
        saving={busy === "save"}
        saved={saved}
        disabled={busy !== null && busy !== "save"}
        onSave={() => void onSave()}
      />
      <p className="hint">
        Names match without regard to case or extra spaces. An alias such as Hynix resolves to the
        same manufacturer as SK hynix. Merge keeps the other name as an alias and moves its items.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <label>
          New manufacturer
          <input
            value={name}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </label>
      </form>
      {loading ? <p className="muted">Loading manufacturers…</p> : null}
      {!loading && rows.length === 0 ? <p className="muted">No manufacturers yet.</p> : null}
      {rows.map((row) => (
        <ManufacturerCard
          key={row.id}
          row={row}
          name={draftNames[row.id] ?? row.name}
          others={rows.filter((other) => other.id !== row.id)}
          busy={busy}
          onRun={run}
          onName={(value) => {
            setDraftNames((current) => ({ ...current, [row.id]: value }));
            setSaved(false);
          }}
          onSave={() => void onSave()}
        />
      ))}
    </main>
  );
}

function ManufacturerCard({
  row,
  name,
  others,
  busy,
  onRun,
  onName,
  onSave,
}: {
  row: ManufacturerRecord;
  name: string;
  others: ManufacturerRecord[];
  busy: string | null;
  onRun: (key: string, action: () => Promise<void>, ok: string) => Promise<void>;
  onName: (value: string) => void;
  onSave: () => void;
}) {
  const [alias, setAlias] = useState("");
  const [mergeId, setMergeId] = useState("");

  return (
    <section className="card integration-card maker-card">
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label>
          Name
          <input value={name} autoComplete="off" onChange={(event) => onName(event.target.value)} />
        </label>
        <span className="muted">{row.itemCount} items</span>
      </form>
      <p className="hint">Aliases</p>
      <ul className="alias-list">
        {row.aliases.length === 0 ? <li className="muted">None</li> : null}
        {row.aliases.map((entry) => (
          <li key={entry.id}>
            {entry.alias}
            <ToolbarButton
              icon={Trash2}
              label={`Remove alias ${entry.alias}`}
              danger
              disabled={busy !== null}
              onClick={() => void onRun(entry.id, () => removeManufacturerAlias(entry.id), "Alias removed.")}
            />
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
        <button
          type="submit"
          className="icon-button"
          title="Add alias"
          aria-label="Add alias"
          disabled={busy !== null || alias.trim() === ""}
        >
          <Plus size={18} strokeWidth={1.75} aria-hidden />
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
          <button
            type="submit"
            className="icon-button"
            title="Merge"
            aria-label="Merge"
            disabled={busy !== null || mergeId === ""}
          >
            <GitMerge size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </form>
      ) : null}
    </section>
  );
}
