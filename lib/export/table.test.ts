import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExportTable,
  exportTitle,
  moneyCell,
  timestampCell,
  toCsv,
  type ExportItem,
} from "./table.ts";

function item(patch: Partial<ExportItem> = {}): ExportItem {
  return {
    sku: "107075",
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
    prices: {},
    primaryImageUrl: "",
    createdAt: "2026-10-18T22:39:47.000Z",
    updatedAt: "2026-10-18T22:39:47.000Z",
    attributes: { speed: "4800" },
    attributeOrder: [{ name: "speed", taxonomySort: 2, sort: 0 }],
    ...patch,
  };
}

test("pricing columns sit between COO and the primary image when those fields exist", () => {
  const table = buildExportTable(
    [
      item({
        prices: {
          ecommerce_price: "120.00",
          market_price: "99.50",
          msrp: "240.00",
          pricing_checked_at: "2026-10-19T18:00:00.000Z",
        },
      }),
    ],
    ["ecommerce_price", "market_price", "msrp", "pricing_checked_at"],
  );

  assert.equal(table.headers[2], "Item type");
  assert.equal(table.rows[0]?.[2], "Product");
  assert.deepEqual(table.headers.slice(5, 10), ["Part number", "OEM name", "OEM part number", "Product page", "Unit"]);
  assert.equal(table.rows[0]?.[6], "Samsung");
  assert.equal(table.rows[0]?.[8], "https://example.com/m329");
  assert.equal(table.rows[0]?.[9], "Piece");
  assert.deepEqual(table.headers.slice(15, 23), [
    "COO",
    "Ecommerce price",
    "Market price",
    "MSRP",
    "Pricing checked",
    "Primary image URL",
    "Created",
    "Updated",
  ]);
  assert.equal(table.headers.at(-1), "speed");
  assert.equal(table.rows[0]?.[16], "120.00");
  assert.equal(table.rows[0]?.[20], "");
  assert.equal(table.rows[0]?.at(-1), "4800");
});

test("pricing columns are left out when the database does not have them", () => {
  const table = buildExportTable([item()], []);
  assert.equal(table.headers.includes("Ecommerce price"), false);
  assert.deepEqual(table.headers.slice(15, 19), ["COO", "Primary image URL", "Created", "Updated"]);
  assert.equal(table.headers.at(-1), "speed");
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
    [],
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
    [item({ sku: "=1+1", manufacturer: 'SK "Hynix"', conditionNote: "line\n2" })],
    [],
  );
  const csv = toCsv(table);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /"SK ""Hynix"""/);
  assert.match(csv, /"line\n2"/);
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
