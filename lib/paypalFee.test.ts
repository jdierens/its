import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePaypalFeeFormula,
  paypalFeeAmount,
  paypalFeeBase,
  paypalFeeIsInternational,
  paypalFeeSkuFromSetting,
  syncPaypalFeeLines,
  type PaypalFeeCatalog,
  type PaypalFeeLine,
} from "./paypalFee.ts";

const domestic = {
  id: "item-domestic",
  sku: "102475",
  name: "PayPal fee domestic",
  description: "Paypal CC Fee Domestic $0.75 + 3.5%",
};
const international = {
  id: "item-international",
  sku: "102476",
  name: "PayPal fee international",
  description: "Paypal CC Fee International $0.75 + 4.5%",
};
const catalog: PaypalFeeCatalog = {
  domesticSku: "102475",
  internationalSku: "102476",
  domestic,
  international,
};

function line(partial: Partial<PaypalFeeLine> & Pick<PaypalFeeLine, "qty" | "unitPrice">): PaypalFeeLine {
  return {
    lineKind: "product",
    customerPartNumber: "106683",
    customerDescription: "Drive",
    extPrice: "",
    allocations: [],
    ...partial,
  };
}

describe("PayPal fee", () => {
  it("parses a fixed amount and a percent from the item description", () => {
    assert.deepEqual(parsePaypalFeeFormula("Paypal CC Fee Domestic $0.75 + 3.5%"), { fixed: 0.75, percent: 3.5 });
    assert.deepEqual(parsePaypalFeeFormula("$0.75+3.5%"), { fixed: 0.75, percent: 3.5 });
    assert.deepEqual(parsePaypalFeeFormula("0.75 + 3.5 percent"), { fixed: 0.75, percent: 3.5 });
    assert.deepEqual(parsePaypalFeeFormula("3.5% + $0.75"), { fixed: 0.75, percent: 3.5 });
    assert.equal(parsePaypalFeeFormula("PayPal fee"), null);
    assert.equal(parsePaypalFeeFormula("$0.75"), null);
  });

  it("prices a $1000 order as 0.75 + 1000 * 3.5%", () => {
    const formula = parsePaypalFeeFormula(domestic.description);
    assert.ok(formula);
    assert.equal(paypalFeeAmount(1000, formula), 35.75);
  });

  it("uses the international item when ship-to or bill-to is outside the United States", () => {
    assert.equal(paypalFeeIsInternational("", ""), false);
    assert.equal(paypalFeeIsInternational("US", ""), false);
    assert.equal(paypalFeeIsInternational("usa", "United States"), false);
    assert.equal(paypalFeeIsInternational("United States of America", ""), false);
    assert.equal(paypalFeeIsInternational("u.s.a.", ""), false);
    assert.equal(paypalFeeIsInternational("Germany", ""), true);
    assert.equal(paypalFeeIsInternational("US", "Germany"), true);
    assert.equal(paypalFeeSkuFromSetting("  ", "102475"), "102475");
    assert.equal(paypalFeeSkuFromSetting("102480", "102475"), "102480");
  });

  it("adds one managed fee line and leaves a manual line of the same SKU", () => {
    const manual = line({
      customerPartNumber: "102475",
      qty: "1",
      unitPrice: "5",
      extPrice: "5.00",
      allocations: [{ itemId: "item-domestic", qty: "1", unitPrice: "5" }],
    });
    const product = line({ qty: "1", unitPrice: "1000", extPrice: "1000.00" });
    const first = syncPaypalFeeLines([product, manual], {
      paymentMethod: "paypal",
      shipCountry: "US",
      billCountry: "",
      catalog,
      createLine: (_previous, item, unitPrice, extPrice) =>
        line({
          managedFee: "paypal",
          lineKind: "fee",
          customerPartNumber: item.sku,
          customerDescription: item.name,
          qty: "1",
          unitPrice,
          extPrice,
          allocations: [{ itemId: item.id, qty: "1", unitPrice }],
        }),
    });
    assert.equal(first.error, null);
    assert.equal(first.lines.length, 3);
    assert.equal(first.lines[1], manual);
    const fee = first.lines[2];
    assert.equal(fee.managedFee, "paypal");
    assert.equal(fee.qty, "1");
    assert.equal(fee.unitPrice, "35.93");
    assert.equal(fee.customerPartNumber, "102475");
    assert.equal(paypalFeeBase(first.lines), 1005);

    const again = syncPaypalFeeLines(first.lines, {
      paymentMethod: "PayPal",
      shipCountry: "US",
      billCountry: "Canada",
      catalog,
      createLine: (previous, item, unitPrice, extPrice) => ({
        ...(previous ?? line({ qty: "1", unitPrice })),
        managedFee: "paypal",
        lineKind: "fee",
        customerPartNumber: item.sku,
        customerDescription: item.name,
        qty: "1",
        unitPrice,
        extPrice,
        allocations: [{ itemId: item.id, qty: "1", unitPrice }],
      }),
    });
    assert.equal(again.lines.filter((row) => row.managedFee === "paypal").length, 1);
    assert.equal(again.lines.at(-1)?.customerPartNumber, "102476");
    assert.equal(again.lines.at(-1)?.unitPrice, "45.98");

    const removed = syncPaypalFeeLines(again.lines, {
      paymentMethod: "ach",
      shipCountry: "Canada",
      billCountry: "",
      catalog,
      createLine: () => line({ qty: "1", unitPrice: "0" }),
    });
    assert.equal(removed.error, null);
    assert.equal(removed.lines.some((row) => row.managedFee === "paypal"), false);
    assert.equal(removed.lines.some((row) => row.customerPartNumber === "102475" && row.managedFee !== "paypal"), true);
  });

  it("reports a description that has no fee formula", () => {
    const broken: PaypalFeeCatalog = {
      ...catalog,
      domestic: { ...domestic, description: "Domestic card fee" },
    };
    const result = syncPaypalFeeLines([line({ qty: "1", unitPrice: "10", extPrice: "10.00" })], {
      paymentMethod: "paypal",
      shipCountry: "",
      billCountry: "",
      catalog: broken,
      createLine: () => line({ qty: "1", unitPrice: "0" }),
    });
    assert.equal(result.lines.length, 1);
    assert.match(result.error ?? "", /102475/);
    assert.match(result.error ?? "", /\$0\.75 \+ 3\.5%/);
  });
});
