"use client";

import { useEffect, useState } from "react";
import { fetchCurrentAppUser, type AppUser } from "@/lib/appUsers";
import { errorText } from "@/lib/errors";

export function WaitingPage() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentAppUser()
      .then(setUser)
      .catch((error: unknown) => setMessage(errorText(error)));
  }, []);

  const disabled = user?.status === "disabled";

  return (
    <main className="auth-screen">
      <section className="card auth-card">
        <p className="soon-kicker">ITS</p>
        <h1>{disabled ? "Account disabled" : "Waiting for approval"}</h1>
        <p className="hint">
          {disabled
            ? "An admin disabled this account. You can sign out, or ask an admin to approve it again."
            : `${user?.email || "This account"} is signed in and waiting for an admin to approve it.`}
        </p>
        {message ? <p className="error">{message}</p> : null}
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
