"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QueryField } from "@/components/QueryField";
import { SalesOrderListSwitch } from "@/components/SalesOrderListSwitch";
import { Badge } from "@/components/ui/badge";
import {
  SALES_ORDER_LIST_DEFAULT_SORT,
  readSalesOrderEcommerce,
  toggleSalesOrderListSort,
  visibleSalesOrders,
  writeSalesOrderEcommerce,
  type SalesOrderListSort,
  type SalesOrderListSortKey,
} from "@/lib/salesOrderList";
import { formatSalesMoney, SALES_ORDER_REFERENCE_LABEL, salesOrderStatusLabel } from "@/lib/salesOrderDraft";
import type { SalesOrderListItem } from "@/lib/salesOrders";

const COLUMNS: { key: SalesOrderListSortKey; label: string; numeric?: boolean }[] = [
  { key: "number", label: "Number" },
  { key: "customer", label: "Customer" },
  { key: "reference", label: SALES_ORDER_REFERENCE_LABEL },
  { key: "status", label: "Status" },
  { key: "orderDate", label: "Order date" },
  { key: "shipDate", label: "Ship date" },
  { key: "total", label: "Total", numeric: true },
];

function sortDirection(sort: SalesOrderListSort, column: SalesOrderListSortKey): SalesOrderListSort["dir"] | null {
  return sort.key === column ? sort.dir : null;
}

function SortButton({
  label,
  column,
  sort,
  onSort,
  labelled = false,
}: {
  label: string;
  column: SalesOrderListSortKey;
  sort: SalesOrderListSort;
  onSort: (key: SalesOrderListSortKey) => void;
  /** Phone bar has no column header, so the button name includes the direction. */
  labelled?: boolean;
}) {
  const direction = sortDirection(sort, column);
  const directionName = direction === "asc" ? "ascending" : "descending";
  return (
    <button
      type="button"
      className="so-col-sort"
      title={`Sort by ${label}`}
      aria-label={labelled ? (direction ? `Sort by ${label}, ${directionName}` : `Sort by ${label}`) : undefined}
      onClick={() => onSort(column)}
    >
      {label}
      {direction ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

function SortHeading({
  label,
  column,
  numeric = false,
  sort,
  onSort,
}: {
  label: string;
  column: SalesOrderListSortKey;
  numeric?: boolean;
  sort: SalesOrderListSort;
  onSort: (key: SalesOrderListSortKey) => void;
}) {
  const direction = sortDirection(sort, column);
  return (
    <th
      className={numeric ? "num" : undefined}
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <SortButton label={label} column={column} sort={activeSort} onSort={onSort} />
    </th>
  );
}

export function SalesOrderList({
  orders,
  view,
  canViewMoney,
  problem,
}: {
  orders: SalesOrderListItem[];
  view: "drafts" | "all";
  canViewMoney: boolean;
  problem: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const searchRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<SalesOrderListSort>(SALES_ORDER_LIST_DEFAULT_SORT);
  const [hideEcommerce, setHideEcommerce] = useState(false);

  useLayoutEffect(() => {
    setHideEcommerce(readSalesOrderEcommerce(window.localStorage) === "hide");
  }, []);

  const commitSearch = useCallback(
    (trimmed: string) => {
      if (trimmed === (paramsRef.current.get("q") ?? "")) return;
      const next = new URLSearchParams(paramsRef.current.toString());
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    function onSlash(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const columns = useMemo(() => (canViewMoney ? COLUMNS : COLUMNS.filter((column) => column.key !== "total")), [canViewMoney]);
  const query = q.trim();
  const activeSort = canViewMoney || sort.key !== "total" ? sort : SALES_ORDER_LIST_DEFAULT_SORT;
  const rows = useMemo(
    () => visibleSalesOrders(orders, { query, hideEcommerce, sort: activeSort }),
    [orders, query, hideEcommerce, activeSort],
  );
  const filtering = query.length > 0 || hideEcommerce;
  const showAll = view === "all";

  function chooseEcommerce(hide: boolean) {
    setHideEcommerce(hide);
    writeSalesOrderEcommerce(window.localStorage, hide ? "hide" : "show");
  }

  function onColumnSort(key: SalesOrderListSortKey) {
    setSort((current) => toggleSalesOrderListSort(canViewMoney || current.key !== "total" ? current : SALES_ORDER_LIST_DEFAULT_SORT, key));
  }

  return (
    <>
      <SalesOrderListSwitch view={view} search={params.toString()}>
        <div className="label-segments" role="group" aria-label="Ecommerce orders">
          <button type="button" aria-pressed={!hideEcommerce} onClick={() => chooseEcommerce(false)}>
            Show eBay
          </button>
          <button type="button" aria-pressed={hideEcommerce} onClick={() => chooseEcommerce(true)}>
            Hide eBay
          </button>
        </div>
      </SalesOrderListSwitch>
      <div className="so-list-search">
        <QueryField
          inputRef={searchRef}
          className="so-list-query"
          type="search"
          aria-label="Search sales orders"
          placeholder="Search number, customer, reference, or status"
          value={q}
          onCommit={commitSearch}
          autoComplete="off"
          spellCheck={false}
        />
        {filtering && orders.length > 0 ? (
          <p className="hint so-list-count">
            {rows.length} of {orders.length}
          </p>
        ) : null}
      </div>
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      {!problem && orders.length === 0 ? <p className="muted">{showAll ? "No sales orders yet." : "No drafts to process."}</p> : null}
      {!problem && orders.length > 0 && rows.length === 0 ? (
        <p className="muted">{query ? "No sales orders match." : "No sales orders to show. Ecommerce orders are hidden."}</p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <div className="so-sort-bar" role="group" aria-label="Sort sales orders">
            {columns.map((column) => (
              <SortButton labelled key={column.key} label={column.label} column={column.key} sort={activeSort} onSort={onColumnSort} />
            ))}
          </div>
          <div className="card so-table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <SortHeading
                      key={column.key}
                      label={column.label}
                      column={column.key}
                      numeric={column.numeric}
                      sort={activeSort}
                      onSort={onColumnSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id}>
                    <td className="tabular">
                      <Link href={`/sales/orders/${order.id}`}>{order.number}</Link>
                    </td>
                    <td>{order.customerName}</td>
                    <td>{order.orderReference}</td>
                    <td>
                      <Badge className="so-status" tone={order.status}>
                        {salesOrderStatusLabel(order.status)}
                      </Badge>
                    </td>
                    <td>{order.orderDate ?? ""}</td>
                    <td>{order.shipDate ?? ""}</td>
                    {canViewMoney ? <td className="num">{formatSalesMoney(order.total, order.currency)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="so-cards">
            {rows.map((order) => (
              <li className="so-card" key={order.id}>
                <Link href={`/sales/orders/${order.id}`}>{order.number}</Link>
                <dl>
                  <dt>Customer</dt>
                  <dd>{order.customerName}</dd>
                  <dt>{SALES_ORDER_REFERENCE_LABEL}</dt>
                  <dd>{order.orderReference}</dd>
                  <dt>Status</dt>
                  <dd>
                    <Badge className="so-status" tone={order.status}>
                      {salesOrderStatusLabel(order.status)}
                    </Badge>
                  </dd>
                  <dt>Order date</dt>
                  <dd>{order.orderDate ?? ""}</dd>
                  <dt>Ship date</dt>
                  <dd>{order.shipDate ?? ""}</dd>
                  {canViewMoney ? (
                    <>
                      <dt>Total</dt>
                      <dd className="num">{formatSalesMoney(order.total, order.currency)}</dd>
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
