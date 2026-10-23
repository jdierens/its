"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchAppUsers, fetchCurrentAppUser, setAppUser, setAppUserInitials, type AppUser } from "@/lib/appUsers";
import { COMPANY_DOMAIN, type AppRole, type AppStatus } from "@/lib/authDomain";
import { errorText } from "@/lib/errors";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
  { value: "read_only", label: "Read only" },
];

function statusLabel(status: AppStatus): string {
  if (status === "approved") return "Approved";
  if (status === "disabled") return "Disabled";
  return "Pending";
}

function lettersOnly(value: string): string {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);
}

function InitialsInput({
  id,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onCommit?: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="user-initials" htmlFor={id}>
      <span>Initials</span>
      <input
        id={id}
        value={text}
        maxLength={2}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => setText(lettersOnly(event.target.value))}
        onBlur={() => onCommit?.(text)}
      />
    </label>
  );
}

export function UsersAdmin() {
  const [rows, setRows] = useState<AppUser[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [people, self] = await Promise.all([fetchAppUsers(), fetchCurrentAppUser()]);
    setRows(people);
    setSelfId(self?.id ?? null);
  }

  useEffect(() => {
    load()
      .catch((error: unknown) => setMessage(errorText(error)))
      .finally(() => setLoading(false));
  }, []);

  async function save(row: AppUser, role: AppRole, status: AppStatus) {
    setBusyId(row.id);
    setMessage(null);
    try {
      await setAppUser(row.id, role, status);
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  async function saveInitials(row: AppUser, initials: string) {
    if (initials === row.initials) return;
    setBusyId(row.id);
    setMessage(null);
    try {
      await setAppUserInitials(row.id, initials);
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page users-page desk-fields">
      <p className="hint">
        Approve a Google account, change its role, or disable it. A new sign-in from @{COMPANY_DOMAIN} starts
        as pending. Read only does not block edits until database policies are turned on. Initials are two letters.
      </p>
      {message ? <p className="error">{message}</p> : null}
      {loading ? <p className="hint">Loading users…</p> : null}
      {!loading && rows.length === 0 ? (
        <section className="card user-initials-card">
          <InitialsInput id="operator-initials" value="OP" />
          <p className="hint">
            Two letters, A to Z. With sign-in on, each person keeps their own initials and an admin edits them here.
          </p>
        </section>
      ) : null}
      {!loading && rows.length > 0 ? (
        <>
          <div className="card users-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Initials</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const mine = row.id === selfId;
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>{row.email}</td>
                      <td>{row.name || "—"}</td>
                      <td>
                        <InitialsInput
                          id={`user-initials-${row.id}`}
                          value={row.initials}
                          disabled={busy}
                          onCommit={(initials) => void saveInitials(row, initials)}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Role for ${row.email}`}
                          value={row.role}
                          disabled={busy || mine}
                          onChange={(event) => {
                            const role = ROLES.find((item) => item.value === event.target.value)?.value ?? row.role;
                            void save(row, role, row.status);
                          }}
                        >
                          {ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Badge tone={row.status}>{statusLabel(row.status)}</Badge>
                      </td>
                      <td className="user-actions">
                        {row.status !== "approved" ? (
                          <button type="button" disabled={busy || mine} onClick={() => void save(row, row.role, "approved")}>
                            Approve
                          </button>
                        ) : (
                          <button type="button" className="secondary" disabled={busy || mine} onClick={() => void save(row, row.role, "disabled")}>
                            Disable
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="users-cards">
            {rows.map((row) => {
              const mine = row.id === selfId;
              const busy = busyId === row.id;
              return (
                <li key={`card-${row.id}`} className="card user-card">
                  <p>{row.email}</p>
                  <p>{row.name || "—"}</p>
                  <InitialsInput
                    id={`user-initials-card-${row.id}`}
                    value={row.initials}
                    disabled={busy}
                    onCommit={(initials) => void saveInitials(row, initials)}
                  />
                  <label>
                    <span>Role</span>
                    <select
                      aria-label={`Role for ${row.email}`}
                      value={row.role}
                      disabled={busy || mine}
                      onChange={(event) => {
                        const role = ROLES.find((item) => item.value === event.target.value)?.value ?? row.role;
                        void save(row, role, row.status);
                      }}
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    <Badge tone={row.status}>{statusLabel(row.status)}</Badge>
                  </p>
                  {row.status !== "approved" ? (
                    <button type="button" disabled={busy || mine} onClick={() => void save(row, row.role, "approved")}>
                      Approve
                    </button>
                  ) : (
                    <button type="button" className="secondary" disabled={busy || mine} onClick={() => void save(row, row.role, "disabled")}>
                      Disable
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </main>
  );
}
