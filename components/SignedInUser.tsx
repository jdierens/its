"use client";

import { LogOut } from "lucide-react";

export function SignedInUser({ label }: { label: string }) {
  if (!label) return null;

  return (
    <div className="sidebar-user">
      <span className="nav-label sidebar-user-name" title={label}>
        {label}
      </span>
      <form action="/auth/sign-out" method="post">
        <button type="submit" className="secondary sidebar-signout" title="Sign out">
          <LogOut size={16} strokeWidth={1.75} aria-hidden />
          <span className="nav-label">Sign out</span>
        </button>
      </form>
    </div>
  );
}
