import Link from "next/link";
import type { ReactNode } from "react";

export function LegalDocument({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="legal">
      <p className="legal-brand">ITS</p>
      <article>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated October 18, 2026</p>
        <p className="legal-notice">
          This page is a plain-language template for an internal business tool. It is not legal
          advice. Replace each marked placeholder before you rely on it.
        </p>
        {children}
      </article>
      <footer className="legal-foot">
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Use</Link>
        <Link href="/items">Back to ITS</Link>
      </footer>
    </main>
  );
}
