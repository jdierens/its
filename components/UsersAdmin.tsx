"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchAppUsers, fetchCurrentAppUser, setAppUser, type AppUser } from "@/lib/appUsers";
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

  return (
    <main className="page">
      <p className="hint">
        Approve a Google account, change its role, or disable it. A new sign-in from @{COMPANY_DOMAIN} starts
        as pending. Read only does not block edits until database policies are turned on.
      </p>
      {message ? <p className="error">{message}</p> : null}
      {loading ? <p className="hint">Loading users…</p> : null}
      {!loading ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
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
      ) : null}
    </main>
  );
}
