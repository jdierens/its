"use client";

import { FormEvent, useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import {
  createLocation,
  createLocationType,
  fetchPutawaySetting,
  savePutawayDefaults,
  type LocationRow,
  type LocationTypeRow,
} from "@/lib/locationSettings";
import type { BinType } from "@/lib/bins";
import { locationTypeInputError } from "@/lib/stockReceive";

const SUFFIXES: { type: BinType; label: string }[] = [
  { type: "B", label: "Box (-B)" },
  { type: "C", label: "Crate (-C)" },
  { type: "P", label: "Pallet (-P)" },
];

function missingMigration(message: string): boolean {
  return /schema cache|does not exist|relation|Could not find the/i.test(message);
}

export function PutawaySettings() {
  const [types, setTypes] = useState<LocationTypeRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [defaults, setDefaults] = useState<Record<BinType, string>>({ B: "", C: "", P: "" });
  const [canEdit, setCanEdit] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [pattern, setPattern] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    const setting = await fetchPutawaySetting();
    setTypes(setting.types);
    setLocations(setting.locations);
    setDefaults(setting.defaults);
    setCanEdit(setting.canEdit);
    setUnavailable(false);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const setting = await fetchPutawaySetting();
        if (cancelled) return;
        setTypes(setting.types);
        setLocations(setting.locations);
        setDefaults(setting.defaults);
        setCanEdit(setting.canEdit);
      } catch (loadError) {
        if (cancelled) return;
        const message = errorText(loadError);
        if (missingMigration(message)) setUnavailable(true);
        else setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSaveDefaults(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await savePutawayDefaults(defaults);
      setSaved("Saved. Bins and cycles created after this keep the new defaults.");
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function onAddType(event: FormEvent) {
    event.preventDefault();
    const problem = locationTypeInputError({ name: typeName, prefix, pattern });
    if (problem) {
      setError(problem);
      setSaved(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await createLocationType({ name: typeName, prefix, pattern });
      setTypeName("");
      setPrefix("");
      setPattern("");
      await load();
      setSaved("Location type added. Add a location code when the place exists.");
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function onAddLocation(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await createLocation(locationCode);
      setLocationCode("");
      await load();
      setSaved("Location added. It can be chosen as a default.");
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="putaway-settings" aria-labelledby="putaway-heading">
      <h2 id="putaway-heading">Put-away defaults</h2>
      {loading ? <p className="muted">Loading put-away defaults…</p> : null}
      {unavailable ? (
        <p className="hint">Put-away defaults appear after the stock migration is applied.</p>
      ) : null}
      {!loading && !unavailable ? (
        <>
          <p className="hint">
            Each suffix starts a new bin at the location chosen here. Opening a cycle records that
            same choice. Saving a new location leaves bins and cycles that already exist where they
            are. Pick a location that is already in the list.
          </p>
          {!canEdit ? <p className="hint">Only an admin can change put-away defaults.</p> : null}
          <form onSubmit={onSaveDefaults}>
            <div className="receive-row receive-defaults">
              {SUFFIXES.map((suffix) => (
                <label key={suffix.type} htmlFor={`default-${suffix.type}`}>
                  <span>{suffix.label}</span>
                  <select
                    id={`default-${suffix.type}`}
                    value={defaults[suffix.type]}
                    disabled={!canEdit || saving}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDefaults((current) => ({ ...current, [suffix.type]: value }));
                      setSaved(null);
                    }}
                  >
                    <option value="">Choose a location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="actions">
              <button type="submit" disabled={!canEdit || saving}>
                Save put-away defaults
              </button>
            </div>
          </form>
          <h3>Location types</h3>
          <p className="hint">
            A type has a prefix and a pattern. Shelves and racking are already here. Add another
            type when you need one, such as an office lab. The code for that place is added after
            the type exists.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Pattern</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type.id}>
                  <td>{type.name}</td>
                  <td>{type.prefix}</td>
                  <td>
                    <code>{type.pattern}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={onAddType}>
            <div className="receive-row">
              <label htmlFor="location-type-name">
                <span>Name</span>
                <input
                  id="location-type-name"
                  value={typeName}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  onChange={(event) => setTypeName(event.target.value)}
                />
              </label>
              <label htmlFor="location-type-prefix">
                <span>Prefix</span>
                <input
                  id="location-type-prefix"
                  value={prefix}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  autoCapitalize="characters"
                  onChange={(event) => setPrefix(event.target.value)}
                />
              </label>
            </div>
            <div className="field-with-action">
              <label htmlFor="location-type-pattern">
                <span>Pattern</span>
                <input
                  id="location-type-pattern"
                  value={pattern}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="^LAB-.+$"
                  onChange={(event) => setPattern(event.target.value)}
                />
              </label>
              <button type="submit" className="secondary" disabled={!canEdit || saving}>
                Add location type
              </button>
            </div>
            <span className="hint">
              The prefix is stored in capitals, and the pattern must include it, start with ^, and
              end with $.
            </span>
          </form>
          <form onSubmit={onAddLocation}>
            <div className="field-with-action">
              <label htmlFor="location-code-add">
                <span>Location code</span>
                <input
                  id="location-code-add"
                  value={locationCode}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  autoCapitalize="characters"
                  onChange={(event) => setLocationCode(event.target.value)}
                />
              </label>
              <button type="submit" className="secondary" disabled={!canEdit || saving}>
                Add location
              </button>
            </div>
            <span className="hint">
              The code must match one type. It then shows up in the default lists above.
            </span>
          </form>
        </>
      ) : null}
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="banner ok" role="status">
          {saved}
        </p>
      ) : null}
    </section>
  );
}
