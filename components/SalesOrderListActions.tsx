"use client";

import Link from "next/link";
import { CloudDownload, Inbox, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { actionProblem, errorDetail, readActionBody, recoverOrderPullMessage } from "@/lib/clientActionError";

export function SalesOrderListActions({ canEdit, canPullEbay }: { canEdit: boolean; canPullEbay: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"ebay" | "email" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(kind: "ebay" | "email") {
    setBusy(kind);
    setNotice(null);
    setProblem(null);
    const fallback = kind === "ebay" ? "eBay orders could not be pulled." : "Winston did not start the inbox pass.";
    const success = kind === "ebay" ? "eBay orders pulled." : "Winston is checking incoming orders.";
    const startedAt = Date.now();
    try {
      const response = await fetch(kind === "ebay" ? "/api/ebay/orders" : "/api/sales/inbox-pass", { method: "POST" });
      const body = await readActionBody(response);
      if (!body.httpOk) {
        const recovered = kind === "ebay" && !body.serverMessage ? await recoverOrderPullMessage(startedAt) : null;
        if (recovered) {
          setNotice(recovered);
          router.refresh();
        } else {
          setProblem(
            actionProblem({
              detailed: canPullEbay,
              fallback,
              status: body.status,
              serverMessage: body.serverMessage,
              transport: body.transport,
            }),
          );
        }
      } else {
        setNotice(body.serverMessage || success);
        router.refresh();
      }
    } catch (error) {
      const recovered = kind === "ebay" ? await recoverOrderPullMessage(startedAt) : null;
      if (recovered) {
        setNotice(recovered);
        router.refresh();
      } else {
        setProblem(actionProblem({ detailed: canPullEbay, fallback, transport: errorDetail(error) }));
      }
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit && !canPullEbay) return null;

  return (
    <>
      <div className="so-list-actions">
        {canEdit ? (
          <Link className="button so-new-order" href="/sales/orders/new" aria-label="New sales order" title="New sales order">
            <Plus size={18} strokeWidth={1.75} aria-hidden />
          </Link>
        ) : null}
        {canPullEbay ? (
          <button
            type="button"
            className="button so-new-order"
            aria-label="Pull eBay orders"
            title="Pull eBay orders"
            disabled={busy !== null}
            onClick={() => void run("ebay")}
          >
            {busy === "ebay" ? (
              <Loader2 className="icon-spin" size={18} strokeWidth={1.75} aria-hidden />
            ) : (
              <CloudDownload size={18} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="button so-new-order"
            aria-label="Check email orders"
            title="Check email orders"
            disabled={busy !== null}
            onClick={() => void run("email")}
          >
            {busy === "email" ? (
              <Loader2 className="icon-spin" size={18} strokeWidth={1.75} aria-hidden />
            ) : (
              <Inbox size={18} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ) : null}
      </div>
      {busy ? (
        <p className="hint" role="status">
          {busy === "ebay" ? "Pulling eBay orders…" : "Checking email orders…"}
        </p>
      ) : null}
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p className="banner ok" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
