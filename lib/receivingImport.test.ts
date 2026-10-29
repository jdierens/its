import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { templateCsv } from "@/lib/data/csv";
import { autoMatch } from "@/lib/data/matchColumns";
import { parseSpreadsheet } from "@/lib/data/parseTable";
import { mappingColumns, templateColumns } from "@/lib/data/registry";
import { templateWorkbook } from "@/lib/data/templateWorkbook";
import { CONSIGNED_VENDOR_REQUIRED } from "@/lib/consignedReceive";
import {
  emptyReceivingDefaults,
  normalizeImportDate,
  parseReceivingFlag,
  prepareReceivingImport,
  RECEIVING_IMPORT_MIGRATION,
  RECEIVING_TABLE,
  receivingBatchCanCommit,
  receivingRpcRows,
  splitReceivingSerials,
} from "@/lib/receivingImport";

const sql = readFileSync(new URL(`../${RECEIVING_IMPORT_MIGRATION}`, import.meta.url), "utf8");

const TODAY = "2026-10-29";

function row(values: Record<string, string>): Record<string, string> {
  return values;
}

describe("receiving template", () => {
  it("downloads ITS column names and one sample row", () => {
    const csv = templateCsv(RECEIVING_TABLE);
    assert.equal(
      csv,
      "\uFEFFsku,search,qty,bin,vendor,purchase_order,project,received_on,incoming_bin,origin,origin_qty,comment,cleaned,wiped,serial,country_of_origin\r\n94415,samsung 860,4,10059-C,Example Vendor,,Example project,2026-10-29,DOCK-1,eBay,4,sample row - replace before import,no,no,SN-1001,USA\r\n",
    );
    assert.equal(templateColumns(RECEIVING_TABLE).some((column) => column.required && column.key === "qty"), true);
    assert.equal(templateColumns(RECEIVING_TABLE).some((column) => column.required && column.key === "bin"), true);
  });

  it("round-trips the workbook and guesses receipt-export headers", async () => {
    const bytes = await templateWorkbook(RECEIVING_TABLE);
    const parsed = await parseSpreadsheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "receiving-template.xlsx");
    assert.deepEqual(parsed.sheets.map((sheet) => sheet.name), ["Receiving", "Instructions"]);
    assert.equal(parsed.sheets[0]?.rows[0]?.[0], "94415");
    assert.equal(parsed.sheets[0]?.rows[0]?.[12], "no");
    assert.match(parsed.sheets[1]?.rows.map((line) => line.join(" ")).join("\n") ?? "", /consigned/);

    const mapping = autoMatch(
      ["Item Qty", "Putaway", "SKU", "Vendor", "PO", "COO", "Cleaned", "Wiped", "Date", "System", "System Qty", "Incoming bin"],
      mappingColumns(RECEIVING_TABLE),
    );
    assert.equal(mapping.qty, "Item Qty");
    assert.equal(mapping.bin, "Putaway");
    assert.equal(mapping.sku, "SKU");
    assert.equal(mapping.vendor, "Vendor");
    assert.equal(mapping.purchase_order, "PO");
    assert.equal(mapping.country_of_origin, "COO");
    assert.equal(mapping.cleaned, "Cleaned");
    assert.equal(mapping.wiped, "Wiped");
    assert.equal(mapping.received_on, "Date");
    assert.equal(mapping.origin, "System");
    assert.equal(mapping.origin_qty, "System Qty");
    assert.equal(mapping.incoming_bin, "Incoming bin");
  });
});

describe("receiving import rows", () => {
  it("parses flags, dates, and serial lists", () => {
    assert.deepEqual(parseReceivingFlag("", "Cleaned"), { ok: true, value: false });
    assert.deepEqual(parseReceivingFlag("YES", "Cleaned"), { ok: true, value: true });
    assert.equal(parseReceivingFlag("maybe", "Wiped").ok, false);
    assert.deepEqual(splitReceivingSerials("SN1; SN2|SN3\nSN4"), ["SN1", "SN2", "SN3", "SN4"]);
    assert.deepEqual(splitReceivingSerials("SN1, USA"), ["SN1, USA"]);
    assert.equal(normalizeImportDate("10/29/2026"), "2026-10-29");
    assert.equal(normalizeImportDate("10/29/26"), "2026-10-29");
    assert.equal(normalizeImportDate("2026-10-29 00:00:00"), "2026-10-29");
    assert.throws(() => normalizeImportDate("yesterday"), /YYYY-MM-DD/);
  });

  it("requires a vendor when the row and the page have no purchase order", () => {
    const [prepared] = prepareReceivingImport(
      [row({ sku: "94415", qty: "1", bin: "10059-C" })],
      emptyReceivingDefaults(),
      ["req-1"],
      TODAY,
    );
    assert.equal(prepared?.error, CONSIGNED_VENDOR_REQUIRED);
    assert.equal(receivingBatchCanCommit([prepared!]), false);
  });

  it("uses the page header for blank owner, project, and date, and lets a sheet vendor replace the page PO", () => {
    const defaults = {
      ...emptyReceivingDefaults(),
      project: "Page project",
      receivedOn: "2026-10-28",
      incomingBin: "PAGE-IN",
      origin: "Page system",
      originQty: "2",
      vendorId: "vendor-1",
      vendorName: "Page Vendor",
      purchaseOrderId: "po-1",
      purchaseOrderNumber: "PO100",
    };
    const [fromPage, named, sheetPo] = prepareReceivingImport(
      [
        row({ sku: "94415", qty: "2", bin: "10059-c", cleaned: "", wiped: "no" }),
        row({ sku: "94415", qty: "1", bin: "10059-C", vendor: "Sheet Vendor" }),
        row({ sku: "94415", qty: "1", bin: "10059-C", purchase_order: "PO6304", vendor: "PO Vendor" }),
      ],
      defaults,
      ["a", "b", "c"],
      TODAY,
    );
    assert.equal(fromPage?.error, null);
    assert.equal(fromPage?.purchaseOrderId, "po-1");
    assert.equal(fromPage?.purchaseOrder, "PO100");
    assert.equal(fromPage?.project, "Page project");
    assert.equal(fromPage?.receivedOn, "2026-10-28");
    assert.equal(fromPage?.incomingBin, "PAGE-IN");
    assert.equal(fromPage?.origin, "Page system");
    assert.equal(fromPage?.originQty, 2);
    assert.equal(fromPage?.cleaned, false);
    assert.equal(fromPage?.wiped, false);
    assert.equal(fromPage?.bin, "10059-C");
    assert.equal(named?.vendorName, "Sheet Vendor");
    assert.equal(named?.purchaseOrderId, null);
    assert.equal(named?.vendorId, null);
    assert.equal(sheetPo?.purchaseOrder, "PO6304");
    assert.equal(sheetPo?.vendorName, "PO Vendor");
    const rpc = receivingRpcRows([fromPage!, named!, sheetPo!]);
    assert.equal(rpc[0]?.purchase_order_id, "po-1");
    assert.equal(rpc[0]?.vendor_name, "");
    assert.equal(rpc[1]?.vendor_name, "Sheet Vendor");
    assert.equal(rpc[1]?.vendor_id, null);
    assert.equal(rpc[2]?.purchase_order, "PO6304");
    assert.equal(rpc[2]?.vendor_name, "PO Vendor");
  });

  it("keeps a pending search, rejects serials without a SKU, and notes a system-qty mismatch", () => {
    const defaults = { ...emptyReceivingDefaults(), vendorId: "vendor-1", vendorName: "Acme" };
    const [pending, serials, mismatch, dup, tooMany, skuSerial] = prepareReceivingImport(
      [
        row({ search: "samsung 860", qty: "4", bin: "10059-C" }),
        row({ search: "samsung 860", qty: "1", bin: "10059-C", serial: "SN1", country_of_origin: "USA" }),
        row({ sku: "94415", qty: "3", bin: "10059-C", origin_qty: "2" }),
        row({ sku: "94415", qty: "2", bin: "10059-C", serial: "SN9; sn9" }),
        row({ sku: "94415", qty: "1", bin: "10059-C", serial: "SN1|SN2" }),
        row({ sku: "94415", qty: "1", bin: "10059-C", serial: "94415" }),
      ],
      defaults,
      ["1", "2", "3", "4", "5", "6"],
      TODAY,
    );
    assert.equal(pending?.error, null);
    assert.equal(pending?.search, "samsung 860");
    assert.equal(pending?.units.length, 0);
    assert.equal(serials?.error, "Choose an item before entering serials.");
    assert.equal(mismatch?.error, null);
    assert.match(mismatch?.note ?? "", /not a multiple of system qty 2/);
    assert.equal(dup?.error, "That serial is already in this receipt.");
    assert.equal(tooMany?.error, "Enter at most one serial for each piece.");
    assert.equal(skuSerial?.error, "That scan is the SKU, not a serial.");
  });

  it("flags a repeated serial, a bad bin, and a blank quantity, and skips an empty row", () => {
    const defaults = { ...emptyReceivingDefaults(), vendorId: "vendor-1", vendorName: "Acme" };
    const rows = prepareReceivingImport(
      [
        row({}),
        row({ sku: "10", qty: "1", bin: "10059-C", serial: "SN-A", country_of_origin: "US" }),
        row({ sku: "10", qty: "1", bin: "10059-C", serial: "sn-a" }),
        row({ sku: "10", qty: "1", bin: "12-B" }),
        row({ sku: "10", qty: "", bin: "10059-C" }),
        row({ sku: "10", qty: "4", bin: "10059-C", country_of_origin: "usa" }),
        row({ sku: "10", qty: "1", bin: "10059-C", cleaned: "cleaned" }),
      ],
      defaults,
      ["", "r2", "r3", "r4", "r5", "r6", "r7"],
      TODAY,
    );
    assert.equal(rows.length, 6);
    assert.equal(rows[0]?.row, 3);
    assert.equal(rows[0]?.error, null);
    assert.deepEqual(rows[0]?.units, [{ serial: "SN-A", coo: "US" }]);
    assert.equal(rows[1]?.error, "That serial is already in this import.");
    assert.equal(rows[2]?.error, "A bin code is five digits, a hyphen, and B, C, or P.");
    assert.equal(rows[3]?.error, "Enter a quantity.");
    assert.equal(rows[4]?.error, null);
    assert.deepEqual(rows[4]?.units, [{ serial: null, coo: "USA" }]);
    assert.equal(rows[5]?.error, "Cleaned is yes or no.");
    assert.equal(receivingBatchCanCommit(rows), false);
  });
});

describe("receiving import migration", () => {
  it("posts the batch through receive_into_bin and writes nothing when a row fails", () => {
    assert.match(sql, /Not applied here/);
    assert.match(sql, /20261027233000_consigned_receive\.sql/);
    assert.match(sql, /perform public\.receive_into_bin\(/);
    assert.match(sql, /p_vendor_id =>/);
    assert.match(sql, /p_purchase_order_id =>/);
    assert.match(sql, /p_units =>/);
    assert.match(sql, /v_ownership|Consigned to/);
    assert.match(sql, /A receipt without a purchase order is consigned/);
    assert.match(sql, /if coalesce\(p_dry_run, false\) or v_has_error then/);
    assert.match(sql, /'committed', false/);
    assert.match(sql, /'committed', true/);
    assert.match(sql, /item_receive_check/);
    assert.match(sql, /normalize_country/);
    assert.match(sql, /No bin with that code/);
    assert.match(sql, /This bin has quantity and no open cycle/);
    assert.match(
      sql,
      /grant execute on function public\.import_receiving_rows\(jsonb, text, boolean\) to service_role/,
    );
    assert.doesNotMatch(sql, /grant .+ to anon/);
    assert.doesNotMatch(sql, /grant .+ to authenticated/);
  });
});
