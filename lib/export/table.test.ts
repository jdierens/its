import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExportTable,
  exportColumnIds,
  exportTitle,
  guardSpreadsheetFormula,
  moneyCell,
  timestampCell,
  toCsv,
  type ExportItem,
} from "./table.ts";

function item(patch: Partial<ExportItem> = {}): ExportItem {
  return {
    sku: "107075",
    name: "32GB DDR5",
    description: "Server memory",
    taxonomy: "MEM",
    itemType: "Product",
    manufacturer: "Samsung",
    model: "",
    partNumber: "M329R4GA0BB0-CQKEG",
    oemName: "Samsung",
    oemPartNumber: "M329",
    productUrl: "https://example.com/m329",
    unit: "Piece",
    condition: "Used",
    conditionNote: "",
    eccn: "5A992.C",
    usHts: "",
    ccats: "",
    coo: "",
    quantity: "4",
    prices: {},
    updatedAt: "2026-10-18T22:39:47.000Z",
    attributes: { speed: "4800" },
    attributeOrder: [{ name: "speed", taxonomySort: 2, sort: 0 }],
    ...patch,
  };
}

test("all fields follow the inventory order, then one column per attribute", () => {
  const table = buildExportTable(
    [
      item({
        prices: {
          ecommerce_price: "120.00",
          market_price: "99.50",
          msrp: "240.00",
        },
      }),
    ],
    { columns: "all", includeMoney: true },
  );

  assert.deepEqual(table.headers.slice(0, 6), ["SKU", "Name", "Description", "Taxonomy", "Item type", "Manufacturer"]);
  assert.equal(table.rows[0]?.[1], "32GB DDR5");
  assert.equal(table.rows[0]?.[2], "Server memory");
  assert.equal(table.headers.indexOf("Quantity"), 17);
  assert.equal(table.rows[0]?.[17], "4");
  assert.deepEqual(table.headers.slice(18, 22), ["Product URL", "Ecommerce price", "Market price", "MSRP"]);
  assert.equal(table.rows[0]?.[19], "120.00");
  assert.equal(table.headers.at(-1), "speed");
  assert.equal(table.rows[0]?.at(-1), "4800");
});

test("money columns are omitted when the caller cannot view financials", () => {
  const table = buildExportTable([item()], { columns: "all", includeMoney: false });
  assert.equal(table.headers.includes("Ecommerce price"), false);
  assert.equal(table.headers.includes("Market price"), false);
  assert.equal(table.headers.includes("MSRP"), false);
  assert.equal(table.headers.at(-2), "Product URL");
  assert.equal(table.headers.at(-1), "speed");
});

test("visible columns keep the requested order and skip photo, fields, and unknown ids", () => {
  const columns = exportColumnIds({
    columns: ["photo", "sku", "name", "ecommerce_price", "bogus", "fields", "attr:speed", "edited"],
    includeMoney: false,
    items: [item()],
  });
  assert.deepEqual(
    columns.map((column) => column.header),
    ["SKU", "Name", "speed", "Edited"],
  );

  const withMoney = buildExportTable([item({ prices: { ecommerce_price: "10.00" } })], {
    columns: ["sku", "ecommerce_price", "edited"],
    includeMoney: true,
  });
  assert.deepEqual(withMoney.headers, ["SKU", "Ecommerce price", "Edited"]);
  assert.equal(withMoney.rows[0]?.[1], "10.00");
  assert.equal(withMoney.rows[0]?.[2], "2026-10-18T22:39:47.000Z");
});

test("shared attribute names become one column, ordered by taxonomy then field", () => {
  const table = buildExportTable(
    [
      item({
        sku: "2",
        attributes: { speed: "4800", capacity_gb: "32" },
        attributeOrder: [
          { name: "speed", taxonomySort: 2, sort: 1 },
          { name: "capacity_gb", taxonomySort: 2, sort: 0 },
        ],
      }),
      item({
        sku: "1",
        taxonomy: "NIC",
        attributes: { speed: "10G", interface: "SFP" },
        attributeOrder: [
          { name: "speed", taxonomySort: 5, sort: 0 },
          { name: "interface", taxonomySort: 5, sort: 1 },
        ],
      }),
    ],
    { columns: "all", includeMoney: true },
  );

  assert.deepEqual(table.headers.slice(-3), ["capacity_gb", "speed", "interface"]);
  const speed = table.headers.indexOf("speed");
  const capacity = table.headers.indexOf("capacity_gb");
  const iface = table.headers.indexOf("interface");
  assert.equal(table.rows[0]?.[speed], "4800");
  assert.equal(table.rows[0]?.[capacity], "32");
  assert.equal(table.rows[0]?.[iface], "");
  assert.equal(table.rows[1]?.[speed], "10G");
  assert.equal(table.rows[1]?.[iface], "SFP");
});

test("csv quotes special characters and neutralizes formulas", () => {
  const table = buildExportTable(
    [item({ sku: "=1+1", manufacturer: 'SK "Hynix"', conditionNote: "line\n2", name: "+cmd", description: " @sum" })],
    { columns: "all", includeMoney: false },
  );
  const csv = toCsv(table);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.includes("\r\n"), true);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /'\+cmd/);
  assert.match(csv, /' @sum/);
  assert.match(csv, /"SK ""Hynix"""/);
  assert.match(csv, /"line\n2"/);
  assert.equal(guardSpreadsheetFormula("-12"), "'-12");
  assert.equal(guardSpreadsheetFormula("\t=1"), "'\t=1");
  assert.equal(guardSpreadsheetFormula("plain"), "plain");
});

test("the sheet title uses Pacific time", () => {
  assert.equal(exportTitle(new Date("2026-10-19T18:00:00.000Z")), "ITS items export 2026-10-19 11:00");
  assert.equal(exportTitle(new Date("2026-12-19T18:00:00.000Z")), "ITS items export 2026-12-19 10:00");
});

test("money and timestamps stay blank when the value is missing", () => {
  assert.equal(moneyCell(null), "");
  assert.equal(moneyCell("12.5"), "12.50");
  assert.equal(moneyCell(0), "0.00");
  assert.equal(timestampCell(null), "");
  assert.equal(timestampCell("2026-10-19T18:00:00Z"), "2026-10-19T18:00:00.000Z");
});
