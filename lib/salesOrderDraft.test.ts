import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocationsCover,
  compareSalesOrderList,
  formatSalesMoney,
  formatSalesOrderNumber,
  hideSalesMoney,
  invoiceNumber,
  lineExtension,
  lineRequiresItem,
  normalizeSalesDraftLines,
  withEbayShippingItem,
  salesOrderListHref,
  salesOrderListReference,
  salesOrderListScope,
  salesOrderListViewToRestore,
  readSalesOrderListView,
  writeSalesOrderListView,
  syncSalesLineMoney,
  syncAllocationMoney,
  qtyForAddedMapping,
  compareMappedLine,
  compareMappedOrder,
  parseSalesOrderNumber,
  partMatches,
  partPrefix,
  salesOrderTotal,
  sellerNet,
  toSalesOrderPayload,
  type SoDraftInput,
} from "./salesOrderDraft.ts";

describe("sales order draft", () => {
  it("matches a part number by normalized prefix", () => {
    assert.equal(partPrefix("m393a4k40db3-cwe"), "M393A4K40DB3CWE");
    assert.equal(partMatches("M393A4K40DB3-CWE", "M393A4K40DB3-CWEC0"), true);
    assert.equal(partMatches("M393A4K40DB3-CWE", "OTHER-PART"), false);
    assert.equal(partMatches("AB", "AB100"), false);
  });

  it("extends a line from quantity and unit price", () => {
    assert.equal(lineExtension("10", "12.5"), "125.00");
    assert.equal(lineExtension("0", "12.5"), null);
  });

  it("keeps quantity, unit price, and extension consistent", () => {
    const fromUnit = syncSalesLineMoney({ qty: "2", unitPrice: "10.125", extPrice: "", edited: "unit" });
    assert.equal(fromUnit.unitPrice, "10.125");
    assert.equal(fromUnit.extPrice, "20.25");

    const fromExt = syncSalesLineMoney({ qty: "3", unitPrice: "", extPrice: "10.00", edited: "ext" });
    assert.equal(fromExt.unitPrice, "3.3333");
    assert.equal(fromExt.extPrice, "10.00");
    assert.equal(lineExtension("3", fromExt.unitPrice), "10.00");

    const fromQty = syncSalesLineMoney({ qty: "2", unitPrice: "6338", extPrice: "6338.00", edited: "qty" });
    assert.equal(fromQty.extPrice, "6338.00");
    assert.equal(fromQty.unitPrice, "3169.00");
    assert.equal(lineExtension("2", fromQty.unitPrice), "6338.00");
  });

  it("balances each mapped SKU from the field that was edited", () => {
    const fromQty = syncAllocationMoney({ qty: "217", unitPrice: "10", extPrice: "2770.00", edited: "qty" });
    assert.equal(fromQty.unitPrice, "10");
    assert.equal(fromQty.extPrice, "2170.00");

    const fromUnit = syncAllocationMoney({ qty: "80", unitPrice: "12.5", extPrice: "800.00", edited: "unit" });
    assert.equal(fromUnit.unitPrice, "12.5");
    assert.equal(fromUnit.extPrice, "1000.00");

    const fromExt = syncAllocationMoney({ qty: "20", unitPrice: "10", extPrice: "250.00", edited: "ext" });
    assert.equal(fromExt.unitPrice, "12.50");
    assert.equal(fromExt.extPrice, "250.00");
    assert.equal(lineExtension("20", fromExt.unitPrice), "250.00");

    const guarded = syncAllocationMoney({ qty: "0", unitPrice: "10", extPrice: "50.00", edited: "ext" });
    assert.equal(guarded.unitPrice, "10");
    assert.equal(guarded.extPrice, "50.00");

    const blankQty = syncAllocationMoney({ qty: "", unitPrice: "10", extPrice: "50.00", edited: "qty" });
    assert.equal(blankQty.unitPrice, "10");
    assert.equal(blankQty.extPrice, "50.00");
  });

  it("defaults another mapped SKU to the quantity still unordered", () => {
    assert.equal(qtyForAddedMapping({ orderedQty: "100", allocations: [], firstQty: "100" }), "100");
    assert.equal(
      qtyForAddedMapping({ orderedQty: "100", allocations: [{ qty: "80" }], firstQty: "100" }),
      "20",
    );
    assert.equal(
      qtyForAddedMapping({ orderedQty: "277", allocations: [{ qty: "217" }], firstQty: "277" }),
      "60",
    );
    assert.equal(qtyForAddedMapping({ orderedQty: "10", allocations: [{ qty: "10" }], firstQty: "10" }), "");
  });

  it("flags a short ship and a money gap without dropping the mapped SKUs", () => {
    const line = compareMappedLine({
      qty: "277",
      extPrice: "2770.00",
      allocations: [{ qty: "217", extPrice: "2170.00" }],
    });
    assert.equal(line.qtyMismatch, true);
    assert.equal(line.moneyMismatch, true);
    assert.equal(line.mappedQty, 217);
    assert.equal(line.mappedExt, 2170);

    const split = compareMappedLine({
      qty: "100",
      extPrice: "1000.00",
      allocations: [
        { qty: "80", extPrice: "800.00" },
        { qty: "20", extPrice: "250.00" },
      ],
    });
    assert.equal(split.qtyMismatch, false);
    assert.equal(split.moneyMismatch, true);
    assert.equal(split.mappedExt, 1050);

    const order = compareMappedOrder([
      {
        lineKind: "product",
        extPrice: "2770.00",
        allocations: [{ extPrice: "2170.00" }],
      },
      { lineKind: "freight", extPrice: "12.00", allocations: [] },
    ]);
    assert.equal(order.poTotal, 2782);
    assert.equal(order.mappedTotal, 2182);
    assert.equal(order.mismatch, true);

    const matched = compareMappedOrder([
      {
        lineKind: "product",
        extPrice: "1000.00",
        allocations: [
          { extPrice: "800.00" },
          { extPrice: "200.00" },
        ],
      },
    ]);
    assert.equal(matched.mismatch, false);
  });

  it("lists an eBay order id or a customer PO and skips the internal reference", () => {
    assert.equal(salesOrderListReference({ ebayOrderId: "12-03456-78901", customerPo: "PO-1" }), "12-03456-78901");
    assert.equal(salesOrderListReference({ customerPo: "PO-1" }), "PO-1");
    assert.equal(salesOrderListReference({ customerPo: "" }), "");
    assert.equal(salesOrderListScope(undefined), "drafts");
    assert.equal(salesOrderListScope("all"), "all");
    assert.equal(salesOrderListScope("drafts"), "drafts");
    assert.equal(
      compareSalesOrderList(
        { orderDate: "2026-10-01", createdAt: "2026-10-01T00:00:00Z" },
        { orderDate: "2026-10-02", createdAt: "2026-09-01T00:00:00Z" },
      ),
      1,
    );
    assert.ok(
      compareSalesOrderList({ orderDate: null, createdAt: "2026-10-03T00:00:00Z" }, { orderDate: "2026-10-01", createdAt: "2026-01-01T00:00:00Z" }) > 0,
    );
  });

  it("requires allocations to add up to the line", () => {
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }, { itemId: "b", qty: "3" }]), true);
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }]), false);
    assert.equal(allocationsCover("10", [{ itemId: "", qty: "10" }]), false);
  });

  it("allocates an empty eBay freight line to the shipping item", () => {
    const lines = [
      { lineKind: "product", customerPartNumber: "1", customerDescription: "", qty: "1", unitPrice: "2", condition: "", allocations: [] },
      { lineKind: "freight", customerPartNumber: "", customerDescription: "Shipping", qty: "1", unitPrice: "12.79", condition: "", allocations: [] },
      {
        lineKind: "freight",
        customerPartNumber: "",
        customerDescription: "Shipping",
        qty: "2",
        unitPrice: "4",
        condition: "",
        allocations: [{ itemId: "kept", qty: "2", unitPrice: "4" }],
      },
    ];
    const filled = withEbayShippingItem(lines, "item-4343", true);
    assert.equal(filled[0].allocations.length, 0);
    assert.deepEqual(filled[1].allocations, [{ itemId: "item-4343", qty: "1", unitPrice: "12.79" }]);
    assert.deepEqual(filled[2].allocations, [{ itemId: "kept", qty: "2", unitPrice: "4" }]);
    assert.equal(withEbayShippingItem(lines, "item-4343", false)[1].allocations.length, 0);
  });

  it("requires an item only for a product line", () => {
    assert.equal(lineRequiresItem("product"), true);
    assert.equal(lineRequiresItem(""), true);
    assert.equal(lineRequiresItem("freight"), false);
    assert.equal(lineRequiresItem("kit"), false);
    assert.equal(lineRequiresItem("fee"), false);
  });

  it("strips prices when the viewer cannot see money", () => {
    const hidden = hideSalesMoney(
      {
        unitPrice: "12.50",
        extPrice: "25.00",
        total: 25,
        internalNotes: "margin",
        ebayTransactionFee: "1.25",
        ebayLabelFee: "0.50",
        ebayAdFee: "0.20",
        ebayOrderEarnings: "10.00",
        paymentAmount: "25.00",
      },
      false,
    );
    assert.deepEqual(hidden, {
      unitPrice: "",
      extPrice: "",
      total: null,
      internalNotes: "",
      ebayTransactionFee: "",
      ebayLabelFee: "",
      ebayAdFee: "",
      ebayOrderEarnings: "",
      paymentAmount: "",
    });
    assert.equal(salesOrderTotal([{ extPrice: "10.00" }, { extPrice: "2.50" }]), 12.5);
    assert.equal(salesOrderTotal([{ extPrice: "" }]), null);
    assert.equal(sellerNet("5631.59", ""), 5631.59);
    assert.equal(sellerNet("5631.59", "9.42"), 5622.17);
    assert.equal(sellerNet("$5,631.59", "$9.42"), 5622.17);
    assert.equal(sellerNet("", "9.42"), null);
    assert.equal(salesOrderTotal([{ extPrice: "$6,338.00" }]), 6338);
    assert.equal(formatSalesMoney(6338, "USD"), "$6,338.00");
  });

  it("shows an integer sales-order number as SO plus the digits", () => {
    assert.equal(formatSalesOrderNumber(27766), "SO27766");
    assert.equal(formatSalesOrderNumber("27766"), "SO27766");
    assert.equal(formatSalesOrderNumber(null), null);
    assert.equal(parseSalesOrderNumber("SO27770"), 27770);
    assert.equal(parseSalesOrderNumber("27770"), 27770);
    assert.equal(parseSalesOrderNumber("SO"), null);
    assert.equal(invoiceNumber(27766, 1), "INV27766");
    assert.equal(invoiceNumber(27766, 2), "INV27766-2");
    assert.equal(invoiceNumber(27766, 3), "INV27766-3");
  });

  it("sends a draft payload without a sales-order number", () => {
    const payload = toSalesOrderPayload(sampleDraft());
    assert.equal("so_number" in payload, false);
    assert.equal(payload.customer_po, "PO-100");
    const lines = payload.lines as { line_kind: string; allocations: { item_id: string }[] }[];
    assert.equal(payload.channel, "direct");
    assert.equal(payload.payment_method, "wire_ach");
    assert.equal(payload.ebay_transaction_fee, "1.25");
    assert.equal(payload.payment_amount, "20.00");
    assert.equal(lines[0].line_kind, "product");
    assert.equal(lines[0].allocations[0].item_id, "item-1");
    assert.equal(lines[0].allocations.length, 1);
  });

  it("keeps a verbal line that is only a mapped SKU, and the same SKU at two prices", () => {
    const verbal = normalizeSalesDraftLines([
      {
        lineKind: "product",
        customerPartNumber: "",
        customerDescription: "",
        qty: "",
        unitPrice: "",
        condition: "",
        allocations: [{ itemId: "item-4343", qty: "1", unitPrice: "500" }],
      },
      {
        lineKind: "product",
        customerPartNumber: "",
        customerDescription: "",
        qty: "1",
        unitPrice: "",
        condition: "",
        allocations: [],
      },
    ]);
    assert.equal(verbal.length, 1);
    assert.equal(verbal[0].qty, "1");
    assert.equal(verbal[0].allocations[0].itemId, "item-4343");

    const draft = sampleDraft();
    draft.lines = [
      {
        lineKind: "product",
        customerPartNumber: "",
        customerDescription: "Shipping & Handling Charge",
        qty: "1",
        unitPrice: "500",
        condition: "",
        allocations: [{ itemId: "item-4343", qty: "1", unitPrice: "500" }],
      },
      {
        lineKind: "product",
        customerPartNumber: "",
        customerDescription: "Shipping & Handling Charge",
        qty: "1",
        unitPrice: "75",
        condition: "",
        allocations: [{ itemId: "item-4343", qty: "1", unitPrice: "75" }],
      },
    ];
    const payload = toSalesOrderPayload(draft);
    const lines = payload.lines as { allocations: { item_id: string; unit_price: string }[] }[];
    assert.equal(lines.length, 2);
    assert.equal(lines[0].allocations[0].item_id, "item-4343");
    assert.equal(lines[1].allocations[0].item_id, "item-4343");
    assert.equal(lines[0].allocations[0].unit_price, "500");
    assert.equal(lines[1].allocations[0].unit_price, "75");
  });

  it("sends every mapped SKU with its unit price, including a short quantity", () => {
    const draft = sampleDraft();
    draft.lines[0].qty = "277";
    draft.lines[0].unitPrice = "10";
    draft.lines[0].allocations = [
      { itemId: "sku-a", qty: "217", unitPrice: "10" },
      { itemId: "sku-b", qty: "60", unitPrice: "12.5000" },
      { itemId: "", qty: "1", unitPrice: "10" },
    ];
    const payload = toSalesOrderPayload(draft);
    const lines = payload.lines as { allocations: { item_id: string; qty: string; unit_price: string; alloc_no: number }[] }[];
    assert.deepEqual(lines[0].allocations, [
      { item_id: "sku-a", qty: "217", unit_price: "10", alloc_no: 1 },
      { item_id: "sku-b", qty: "60", unit_price: "12.5000", alloc_no: 2 },
    ]);
  });

  it("leaves an eBay bill-to blank and keeps ship-to", () => {
    const draft = sampleDraft();
    const payload = toSalesOrderPayload({ ...draft, channel: "ebay" });
    const bill = payload.bill_to as { line1: string };
    const ship = payload.ship_to as { line1: string };
    assert.equal(bill.line1, "");
    assert.equal(ship.line1, draft.shipTo.line1);
    const direct = toSalesOrderPayload(draft);
    assert.equal((direct.bill_to as { line1: string }).line1, "1 Demo St");
  });
});

describe("sales order list view", () => {
  it("remembers All orders and restores it when the address has no view", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return stored.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        stored.set(key, value);
      },
    };
    assert.equal(readSalesOrderListView(storage), null);
    assert.equal(salesOrderListViewToRestore({ hasViewParam: false, stored: null }), null);
    writeSalesOrderListView(storage, "all");
    assert.equal(readSalesOrderListView(storage), "all");
    assert.equal(salesOrderListHref("all"), "/sales/orders?view=all");
    assert.equal(salesOrderListViewToRestore({ hasViewParam: false, stored: "all" }), "all");
    assert.equal(salesOrderListViewToRestore({ hasViewParam: true, stored: "all" }), null);
    writeSalesOrderListView(storage, "drafts");
    assert.equal(readSalesOrderListView(storage), "drafts");
    assert.equal(salesOrderListHref("drafts"), "/sales/orders?view=drafts");
    assert.equal(salesOrderListViewToRestore({ hasViewParam: false, stored: "drafts" }), null);
    assert.equal(readSalesOrderListView({ getItem() { throw new Error("blocked"); } }), null);
  });
});

function sampleDraft(): SoDraftInput {
  return {
    id: null,
    customerId: "customer-1",
    customerPo: "PO-100",
    reference: "desk",
    channel: "direct",
    orderDate: "2026-10-24",
    shipDate: "",
    billTo: {
      line1: "1 Demo St",
      line2: "",
      city: "Springfield",
      countrySubDivisionCode: "IL",
      postalCode: "62701",
      country: "US",
      attention: "",
      phone: "",
    },
    shipTo: {
      line1: "1 Demo St",
      line2: "",
      city: "Springfield",
      countrySubDivisionCode: "IL",
      postalCode: "62701",
      country: "US",
      attention: "",
      phone: "",
    },
    terms: "Net30",
    incoterms: "EXW",
    shipMethod: "UPS Ground",
    carrierAccount: "",
    currency: "USD",
    salesRep: "OP",
    exportNotes: "",
    internalNotes: "",
    paymentRequirement: "terms",
    paymentMethod: "wire_ach",
    paymentDate: "2026-10-24",
    paymentRef: "WIRE-1",
    paymentAmount: "20.00",
    ebayTransactionFee: "1.25",
    ebayLabelFee: "",
    ebayAdFee: "",
    ebayOrderEarnings: "",
    lines: [
      {
        lineKind: "product",
        customerPartNumber: "M393A4K40DB3-CWE",
        customerDescription: "Memory",
        qty: "2",
        unitPrice: "10",
        condition: "New",
        allocations: [
          { itemId: "item-1", qty: "2", unitPrice: "10" },
          { itemId: "", qty: "1", unitPrice: "" },
        ],
      },
    ],
    notes: [],
    saveAddressToCustomer: false,
  };
}
