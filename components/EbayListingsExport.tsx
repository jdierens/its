"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EbayListingMatchFilter } from "@/lib/ebay/listingsBrowser";
import { prefersFileShare } from "@/lib/export/download";

const STORAGE_KEY = "its.ebayListingsExport";

type ExportPayload = {
  format: "csv" | "sheet";
  q: string;
  match: EbayListingMatchFilter;
};

function sheetsMessage(flag: string): string {
  if (flag === "denied") return "Google did not grant access to create the spreadsheet.";
  if (flag === "unconfigured") return "Google Sheets is not configured.";
  if (flag === "state") return "The Google connection expired. Try again.";
  return "Google Sheets could not connect. Try again.";
}

function fileNameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

function matchOf(value: string): EbayListingMatchFilter {
  return value === "matched" || value === "unmatched" ? value : "all";
}

export function EbayListingsExport({
  q,
  match,
  googleConfigured,
}: {
  q: string;
  match: EbayListingMatchFilter;
  googleConfigured: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [google, setGoogle] = useState(googleConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replayed = useRef(false);
  const postSheetRef = useRef<(body: ExportPayload) => Promise<void>>(async () => {});
  const latest = useRef({ q, match });
  latest.current = { q, match };

  function payload(format: ExportPayload["format"]): ExportPayload {
    return { format, q: latest.current.q, match: latest.current.match };
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ebay/listings/export")
      .then(async (response) => {
        const body = (await response.json()) as { google?: boolean };
        if (!cancelled) setGoogle(Boolean(body.google));
      })
      .catch(() => {
        if (!cancelled) setGoogle(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function postSheet(body: ExportPayload) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ebay/listings/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, format: "sheet" }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string; url?: string; consentUrl?: string } | null;
      if (!response.ok) {
        if (response.status === 409) setGoogle(false);
        throw new Error(result?.error || "Export failed.");
      }
      if (result?.consentUrl) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...body, format: "sheet" }));
        const start = new URL(result.consentUrl, window.location.origin);
        start.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
        window.location.assign(start.toString());
        return;
      }
      if (!result?.url) throw new Error("Google did not return a spreadsheet link.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  postSheetRef.current = postSheet;

  useEffect(() => {
    const flag = params.get("sheets");
    if (!flag || replayed.current) return;
    replayed.current = true;
    const next = new URLSearchParams(params.toString());
    next.delete("sheets");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    if (flag !== "connected") {
      setError(sheetsMessage(flag));
      return;
    }
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<ExportPayload>;
      void postSheetRef.current({
        format: "sheet",
        q: typeof saved.q === "string" ? saved.q : "",
        match: matchOf(typeof saved.match === "string" ? saved.match : ""),
      });
    } catch {
      setError("The saved export could not be opened in Google Sheets. Try again.");
    }
  }, [params, pathname, router]);

  async function downloadCsv() {
    const body = payload("csv");
    const ios = prefersFileShare(navigator.userAgent, {
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    });
    if (ios) {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/ebay/listings/export";
      form.acceptCharset = "UTF-8";
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(body);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      form.remove();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ebay/listings/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Export failed.");
      }
      const blob = await response.blob();
      const name = fileNameFrom(response.headers.get("content-disposition"), "ITS eBay listings.csv");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ebay-listings-export">
      <p className="sr-only" id="ebay-listings-export-scope">
        Exports every active listing matching the current search and filter, not only this page.
      </p>
      <span className="hint ebay-listings-export-note">All matches, not only this page.</span>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        aria-describedby="ebay-listings-export-scope"
        onClick={() => void downloadCsv()}
      >
        Export CSV
      </button>
      {google ? (
        <button
          type="button"
          disabled={busy}
          aria-describedby="ebay-listings-export-scope"
          onClick={() => void postSheet(payload("sheet"))}
        >
          Open in Google Sheets
        </button>
      ) : null}
      {error ? (
        <p className="export-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
