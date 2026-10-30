"use client";

import Link from "next/link";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  readSalesOrderListView,
  salesOrderListHref,
  salesOrderListViewToRestore,
  writeSalesOrderListView,
  type SalesOrderListView,
} from "@/lib/salesOrderDraft";

export function SalesOrderListSwitch({
  view,
  search = "",
  children,
}: {
  view: SalesOrderListView;
  search?: string;
  children?: ReactNode;
}) {
  const showAll = view === "all";
  return (
    <div className="so-list-switch">
      <p className="label-caption">{showAll ? "Every sales order" : "Drafts that still need processing"}</p>
      <div className="so-list-switch-row">
        <nav className="label-segments" aria-label="Which sales orders to show">
          <Link
            href={salesOrderListHref("drafts", search)}
            aria-current={showAll ? undefined : "page"}
            onClick={() => writeSalesOrderListView(window.localStorage, "drafts")}
          >
            Drafts to process
          </Link>
          <Link
            href={salesOrderListHref("all", search)}
            aria-current={showAll ? "page" : undefined}
            onClick={() => writeSalesOrderListView(window.localStorage, "all")}
          >
            All orders
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}

/** A visit with no view in the address opens the list this browser last used. */
export function SalesOrderListMemory({ view, children }: { view: SalesOrderListView; children: ReactNode }) {
  const router = useRouter();
  const [hold, setHold] = useState(false);

  useLayoutEffect(() => {
    const hasViewParam = new URLSearchParams(window.location.search).has("view");
    if (hasViewParam) writeSalesOrderListView(window.localStorage, view);
    const next = salesOrderListViewToRestore({
      hasViewParam,
      stored: readSalesOrderListView(window.localStorage),
    });
    if (next && next !== view) {
      setHold(true);
      router.replace(salesOrderListHref(next, window.location.search));
      return;
    }
    setHold(false);
  }, [router, view]);

  if (hold) return null;
  return children;
}
