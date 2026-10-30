import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SALES_ORDER_LIST_DEFAULT_SORT,
  readSalesOrderEcommerce,
  salesOrderIsEcommerce,
  salesOrderMatchesSearch,
  sortSalesOrders,
  toggleSalesOrderListSort,
  visibleSalesOrders,
  writeSalesOrderEcommerce,
  type SalesOrderListRow,
} from "./salesOrderList.ts";

function row(partial: Partial<SalesOrderListRow> & Pick<SalesOrderListRow, "number">): SalesOrderListRow {
  return {
    customerName: "",
    orderReference: "",
    status: "draft",
    orderDate: null,
    shipDate: null,
    currency: "USD",
    total: null,
    ecommerce: false,
    ...partial,
  };
}

describe("sales order ecommerce", () => {
  it("treats an eBay source, channel, order id, or sales record as ecommerce", () => {
    assert.equal(salesOrderIsEcommerce({ source: "manual", channel: "direct" }), false);
    assert.equal(salesOrderIsEcommerce({ source: "ebay" }), true);
    assert.equal(salesOrderIsEcommerce({ channel: "eBay" }), true);
    assert.equal(salesOrderIsEcommerce({ ebayOrderId: "12-03456-78901" }), true);
    assert.equal(salesOrderIsEcommerce({ ebaySalesRecordRef: " 441 " }), true);
    assert.equal(salesOrderIsEcommerce({ ebayOrderId: "  ", ebaySalesRecordRef: "" }), false);
  });

  it("remembers Hide and otherwise shows eBay orders", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return stored.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        stored.set(key, value);
      },
    };
    assert.equal(readSalesOrderEcommerce(storage), "show");
    writeSalesOrderEcommerce(storage, "hide");
    assert.equal(readSalesOrderEcommerce(storage), "hide");
    writeSalesOrderEcommerce(storage, "show");
    assert.equal(readSalesOrderEcommerce(storage), "show");
    assert.equal(readSalesOrderEcommerce({ getItem() { throw new Error("blocked"); } }), "show");
  });
});

describe("sales order list sort", () => {
  it("opens on order date descending and toggles like the inventory headings", () => {
    assert.deepEqual(SALES_ORDER_LIST_DEFAULT_SORT, { key: "orderDate", dir: "desc" });
    assert.deepEqual(toggleSalesOrderListSort(SALES_ORDER_LIST_DEFAULT_SORT, "orderDate"), { key: "orderDate", dir: "asc" });
    assert.deepEqual(toggleSalesOrderListSort({ key: "orderDate", dir: "asc" }, "orderDate"), { key: "orderDate", dir: "desc" });
    assert.deepEqual(toggleSalesOrderListSort(SALES_ORDER_LIST_DEFAULT_SORT, "customer"), { key: "customer", dir: "asc" });
  });

  it("sorts each column and keeps blanks at the bottom", () => {
    const rows = [
      row({ number: "SO10", customerName: "Zen", orderReference: "PO-2", status: "picking", orderDate: "2026-10-02", shipDate: "2026-10-09", total: 10 }),
      row({ number: "Draft", customerName: "", orderReference: "", status: "draft", orderDate: null, shipDate: null, total: null }),
      row({ number: "SO2", customerName: "Acme", orderReference: "PO-10", status: "approved", orderDate: "2026-10-01", shipDate: "2026-10-03", total: 2 }),
    ];
    assert.deepEqual(
      sortSalesOrders(rows, { key: "number", dir: "asc" }).map((item) => item.number),
      ["SO2", "SO10", "Draft"],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "number", dir: "desc" }).map((item) => item.number),
      ["SO10", "SO2", "Draft"],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "customer", dir: "asc" }).map((item) => item.customerName),
      ["Acme", "Zen", ""],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "reference", dir: "asc" }).map((item) => item.orderReference),
      ["PO-2", "PO-10", ""],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "status", dir: "asc" }).map((item) => item.status),
      ["approved", "draft", "picking"],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "orderDate", dir: "asc" }).map((item) => item.orderDate),
      ["2026-10-01", "2026-10-02", null],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "orderDate", dir: "desc" }).map((item) => item.orderDate),
      ["2026-10-02", "2026-10-01", null],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "shipDate", dir: "desc" }).map((item) => item.shipDate),
      ["2026-10-09", "2026-10-03", null],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "total", dir: "asc" }).map((item) => item.total),
      [2, 10, null],
    );
    assert.deepEqual(
      sortSalesOrders(rows, { key: "total", dir: "desc" }).map((item) => item.total),
      [10, 2, null],
    );
    assert.deepEqual(
      sortSalesOrders(rows, null).map((item) => item.number),
      ["SO10", "Draft", "SO2"],
    );
  });

  it("keeps the loaded order when the sort values are equal", () => {
    const rows = [
      row({ number: "SO3", customerName: "Acme", orderDate: "2026-10-01" }),
      row({ number: "SO4", customerName: "Acme", orderDate: "2026-10-01" }),
    ];
    assert.deepEqual(
      sortSalesOrders(rows, { key: "customer", dir: "asc" }).map((item) => item.number),
      ["SO3", "SO4"],
    );
  });
});

describe("sales order list search", () => {
  const rows = [
    row({ number: "SO27766", customerName: "Acme Corp", orderReference: "PO-100", status: "approved", orderDate: "2026-10-01", total: 1200.5 }),
    row({
      number: "Draft",
      customerName: "eBay Customer",
      orderReference: "12-03456-78901",
      status: "draft",
      orderDate: "2026-10-02",
      ecommerce: true,
    }),
    row({
      number: "SO27770",
      customerName: "Northwind",
      orderReference: "PO-9",
      status: "picking",
      orderDate: "2026-11-01",
      shipDate: "2026-11-01",
      total: 40,
    }),
  ];

  it("treats a pipe as OR and ignores punctuation", () => {
    assert.equal(salesOrderMatchesSearch(rows[0], ""), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "||"), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "acme"), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "SO27766|missing"), true);
    assert.equal(salesOrderMatchesSearch(rows[1], "  12-03456-78901 | PO-9 "), true);
    assert.equal(salesOrderMatchesSearch(rows[1], "120345678901"), true);
    assert.equal(salesOrderMatchesSearch(rows[2], "PO-9"), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "missing"), false);
  });

  it("matches the status label, a date, and the total that is on the row", () => {
    assert.equal(salesOrderMatchesSearch(rows[2], "Picking"), true);
    assert.equal(salesOrderMatchesSearch(rows[2], "2026-11-01"), true);
    assert.equal(salesOrderMatchesSearch(rows[2], "11/01/26"), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "1200.50"), true);
    assert.equal(salesOrderMatchesSearch(rows[0], "$1,200.50"), true);
    assert.equal(salesOrderMatchesSearch(rows[1], "1200"), false);
  });

  it("hides ecommerce rows and then sorts the ones that match", () => {
    const shown = visibleSalesOrders(rows, { query: "PO-100|PO-9", hideEcommerce: true, sort: { key: "customer", dir: "asc" } });
    assert.deepEqual(
      shown.map((item) => item.number),
      ["SO27766", "SO27770"],
    );
    const hidden = visibleSalesOrders(rows, { query: "", hideEcommerce: true, sort: SALES_ORDER_LIST_DEFAULT_SORT });
    assert.deepEqual(
      hidden.map((item) => item.number),
      ["SO27770", "SO27766"],
    );
  });
});

describe("sales order list page", () => {
  it("sorts from the headings, searches with a pipe, and can hide eBay orders", () => {
    const page = readFileSync(new URL("../components/SalesOrderList.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("./salesOrders.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(page, /aria-sort=/);
    assert.match(page, /so-col-sort/);
    assert.match(page, /visibleSalesOrders/);
    assert.match(page, /formatDataDate\(order\.orderDate\)/);
    assert.match(page, /formatDataDate\(order\.shipDate\)/);
    assert.match(page, /Hide eBay/);
    assert.match(page, /QueryField/);
    assert.match(list, /salesOrderIsEcommerce/);
    assert.match(css, /\.so-col-sort/);
    assert.match(css, /\.so-sort-bar/);
  });
});
