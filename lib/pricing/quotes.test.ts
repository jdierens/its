import assert from "node:assert/strict";
import test from "node:test";
import {
  capturedPhrase,
  exactPacificTime,
  flagOutliers,
  formatMoney,
  median,
  moneyInput,
  parseMoney,
  parseWindowDays,
  quotesFromBrowse,
  quotesFromInsights,
  salesStats,
} from "./quotes.ts";

test("money accepts dollars and cents and rejects the rest", () => {
  assert.deepEqual(parseMoney(""), { ok: true, amount: null });
  assert.deepEqual(parseMoney("12.50"), { ok: true, amount: 12.5 });
  assert.deepEqual(parseMoney("$1,234.56"), { ok: true, amount: 1234.56 });
  assert.deepEqual(parseMoney("1,234.56"), { ok: true, amount: 1234.56 });
  assert.deepEqual(parseMoney("$1234.56"), { ok: true, amount: 1234.56 });
  assert.deepEqual(parseMoney("$"), { ok: true, amount: null });
  assert.equal(parseMoney("12.505").ok, false);
  assert.equal(parseMoney("-1").ok, false);
  assert.equal(parseMoney("USD 12").ok, false);
  assert.equal(parseMoney("10,000,000,000").ok, false);
  assert.equal(formatMoney(1234.5), "$1,234.50");
  assert.equal(formatMoney(null), "—");
  assert.equal(moneyInput(1234.5), "1,234.50");
  assert.equal(moneyInput(null), "");
});

test("median and outlier flags use 30 percent and 300 percent", () => {
  assert.equal(median([10, 20, 30]), 20);
  assert.equal(median([10, 40]), 25);
  const flagged = flagOutliers([
    { price: 100, currency: "USD" },
    { price: 110, currency: "USD" },
    { price: 20, currency: "usd" },
    { price: 400, currency: "USD" },
    { price: 50, currency: "EUR" },
  ]);
  assert.deepEqual(
    flagged.map((row) => row.outlier),
    [false, false, true, true, false],
  );
  assert.equal(flagOutliers([{ price: 10, currency: "USD" }])[0]?.outlier, false);
});

test("captured phrase counts hours from a fixed clock", () => {
  const now = Date.parse("2026-10-19T18:00:00.000Z");
  assert.equal(capturedPhrase("2026-10-19T16:00:00.000Z", now), "captured 2h ago");
  assert.equal(capturedPhrase("2026-10-19T17:50:00.000Z", now), "captured 10m ago");
  assert.match(exactPacificTime("2026-10-19T18:00:00.000Z"), /Oct 19, 2026/);
  assert.match(exactPacificTime("2026-10-19T18:00:00.000Z"), /PDT/);
});

test("browse and insights parsers keep positive prices only", () => {
  const listed = quotesFromBrowse({
    itemSummaries: [
      {
        title: "16GB module",
        price: { value: "40.00", currency: "USD" },
        condition: "Used",
        itemWebUrl: "https://www.ebay.com/itm/1",
        seller: { username: "ram-seller" },
      },
      { title: "missing price" },
    ],
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.source, "ebay_listed");
  assert.equal(listed[0]?.sellerName, "ram-seller");
  assert.equal(listed[0]?.price, 40);

  const sold = quotesFromInsights({
    itemSales: [
      {
        title: "16GB module",
        lastSoldPrice: { value: "25.00", currency: "USD" },
        totalSoldQuantity: 3,
        condition: "Used",
      },
    ],
  });
  assert.equal(sold[0]?.source, "ebay_sold");
  assert.equal(sold[0]?.qty, 3);
  assert.equal(sold[0]?.price, 25);
});

test("sales stats use the latest price and the window totals", () => {
  const stats = salesStats(
    [
      { type: "sell", txnDate: "2026-10-01", qty: 2, unitPrice: 10, total: 20, createdAt: "2026-10-01T00:00:00Z" },
      { type: "sell", txnDate: "2026-07-01", qty: 1, unitPrice: 99, total: 99, createdAt: "2026-07-01T00:00:00Z" },
      { type: "buy", txnDate: "2026-09-15", qty: 4, unitPrice: 5, total: 20, createdAt: "2026-09-15T00:00:00Z" },
      { type: "sell", txnDate: "2026-10-18", qty: 1, unitPrice: 30, total: 30, createdAt: "2026-10-18T00:00:00Z" },
    ],
    90,
    "2026-10-19",
  );
  assert.equal(stats.lastSoldPrice, 30);
  assert.equal(stats.lastBoughtPrice, 5);
  assert.equal(stats.qtySold, 3);
  assert.equal(stats.revenue, 50);
  assert.equal(stats.avgSellPrice, 16.67);
  assert.equal(stats.qtyBought, 4);
  assert.equal(stats.spend, 20);
  assert.equal(parseWindowDays("90"), 90);
  assert.equal(parseWindowDays("0"), null);
});
