import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShipments, parseFreightIn, trackingUrl } from "./poCharges.ts";
import { parsePaymentTerm, PAYMENT_TERMS } from "./paymentTerms.ts";

test("payment terms are the fixed list", () => {
  assert.deepEqual(PAYMENT_TERMS, ["Net0", "Net1", "Net7", "Net10", "Net14", "Net15", "Net30"]);
  assert.equal(parsePaymentTerm("Net30"), "Net30");
  assert.equal(parsePaymentTerm(" Net30 "), "Net30");
  assert.equal(parsePaymentTerm("Net 30"), "invalid");
  assert.equal(parsePaymentTerm(""), "invalid");
});

test("freight-in is a non-negative USD amount or empty", () => {
  assert.equal(parseFreightIn(""), null);
  assert.equal(parseFreightIn("0"), 0);
  assert.equal(parseFreightIn("12.50"), 12.5);
  assert.equal(parseFreightIn("-1"), "invalid");
  assert.equal(parseFreightIn("1.234"), "invalid");
});

test("tracking links are built for parcel carriers", () => {
  assert.equal(trackingUrl("UPS", "1Z999"), "https://www.ups.com/track?tracknum=1Z999");
  assert.match(trackingUrl("FedEx", "123") ?? "", /fedex\.com/);
  assert.match(trackingUrl("USPS", "9400") ?? "", /usps\.com/);
  assert.match(trackingUrl("DHL", "ABC") ?? "", /dhl\.com/);
  assert.equal(trackingUrl("Freight", "BOL1"), null);
  assert.equal(trackingUrl("Other", "X"), null);
});

test("shipments need a known carrier and a tracking number", () => {
  const saved = normalizeShipments([
    { carrier: "UPS", trackingNumber: "1Z1" },
    { carrier: "", trackingNumber: "" },
  ]);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.length, 1);

  assert.equal(normalizeShipments([{ carrier: "DHL", trackingNumber: "" }]).ok, false);
  assert.equal(normalizeShipments([{ carrier: "Pony", trackingNumber: "1" }]).ok, false);
  assert.equal(
    normalizeShipments([
      { carrier: "UPS", trackingNumber: "1Z1" },
      { carrier: "UPS", trackingNumber: "1z1" },
    ]).ok,
    false,
  );
});
