"use client";

import { useState } from "react";
import { COMPANY_DOMAIN, safeNextPath } from "@/lib/authDomain";
import { errorText } from "@/lib/errors";
import { browserSupabase } from "@/lib/supabaseBrowser";

const ERRORS: Record<string, string> = {
  domain: `Sign-in is limited to @${COMPANY_DOMAIN} Google accounts.`,
  denied: "Google did not complete sign-in. Try again.",
  missing: "Google did not return a sign-in code. Try again.",
  profile: "The account could not be saved. Try again.",
};

export function LoginPage({ error, next }: { error: string | null; next: string | null }) {
  const [message, setMessage] = useState<string | null>(error ? ERRORS[error] ?? "Sign-in failed. Try again." : null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    try {
      const supabase = browserSupabase();
      const origin = window.location.origin;
      const destination = safeNextPath(next);
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(destination)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            hd: COMPANY_DOMAIN,
            prompt: "select_account",
          },
        },
      });
      if (oauthError) throw oauthError;
    } catch (caught) {
      setMessage(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="card auth-card">
        <p className="soon-kicker">ITS</p>
        <h1>Sign in</h1>
        <p className="hint">Use your @{COMPANY_DOMAIN} Google account. A new account waits for an admin to approve it.</p>
        {message ? <p className="error">{message}</p> : null}
        <button type="button" onClick={() => void signIn()} disabled={busy}>
          {busy ? "Opening Google…" : "Sign in with Google"}
        </button>
      </section>
    </main>
  );
}
