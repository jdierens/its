import { documentPartyName } from "@/lib/documentPartyName";
import { formatSalesOrderNumber, invoiceNumber, lineExtension, salesOrderTotal } from "@/lib/salesOrderDraft";
import type { SoAddress } from "@/lib/salesOrderDraft";

export type CustomerDocumentKind = "invoice" | "confirmation";

/** Official DDS mark. Transparent, so the white print page shows through. */
export const CUSTOMER_DOCUMENT_LOGO = "/brand/dds-logo.png";

export const CUSTOMER_DOCUMENT_COMPANY = {
  name: "Deep Discount Servers LLC (DDS)",
  address: "3730 E Dale Ave, Henderson, NV89044",
  bankTitle: "DDS Banking Info",
  bankLeft: [
    "Bank Name: Bank of America",
    "Address: 125 S Market St. 8th Floor",
    "San Jose CA 95113",
    "ABA#026009593",
  ],
  bankRight: [
    "ACH Routing#121000358",
    "Swift Code: BOFAUS3N",
    "Beneficiary: Deep Discount Servers LLC",
    "Account#325000486150",
  ],
};

export function customerDocumentTitle(kind: CustomerDocumentKind): string {
  return kind === "confirmation" ? "ORDER CONFIRMATION" : "INVOICE";
}

/** Confirmation barcodes are SO plus the number. Invoice barcodes stay INV plus the number. */
export function customerDocumentBarcode(kind: CustomerDocumentKind, soNumber: number): string | null {
  if (kind === "confirmation") return formatSalesOrderNumber(soNumber);
  return invoiceNumber(soNumber, 1);
}

export function documentDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return iso.trim();
  return `${match[2]}/${match[3]}/${match[1].slice(2)}`;
}

export function documentQty(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toFixed(2);
}

export function formatDocumentLocality(address: SoAddress): string {
  const country = address.country.trim().toUpperCase();
  const us = country === "" || country === "US" || country === "USA" || country === "UNITED STATES";
  if (us) {
    const region = [address.countrySubDivisionCode.trim(), address.postalCode.trim()].filter(Boolean).join(" ");
    return [address.city.trim(), region].filter(Boolean).join(", ");
  }
  return [address.postalCode.trim(), address.city.trim()].filter(Boolean).join(" ");
}

export function documentPartyLines(name: string, address: SoAddress, tail: string[] = []): string[] {
  return [documentPartyName(name), address.line1, address.line2, formatDocumentLocality(address), address.country, ...tail]
    .map((line) => line.trim())
    .filter(Boolean);
}

export function shippingColumns(input: { method: string; carrier: string; carrierAccount: string }): {
  method: string;
  account: string;
} {
  const method = input.method.trim() || input.carrier.trim();
  const account = input.carrierAccount.trim() || input.carrier.trim();
  return { method, account };
}

export function packageNotes(
  boxes: { boxNumber: number; weightLb: number | null; lengthIn: number | null; widthIn: number | null; heightIn: number | null }[],
): string[] {
  if (boxes.length === 0) return [];
  const total = boxes.length;
  return boxes.map((box) => {
    const weight = box.weightLb == null ? "" : `${Number(box.weightLb).toFixed(2)} LBS`;
    const dims =
      box.lengthIn != null && box.widthIn != null && box.heightIn != null
        ? `${trimMeasure(box.lengthIn)}x${trimMeasure(box.widthIn)}x${trimMeasure(box.heightIn)} INCHES`
        : "";
    const measure = [weight, dims].filter(Boolean).join(" - ");
    return `BOX${box.boxNumber}/${total}${measure ? ` ${measure}` : ""}`;
  });
}

function trimMeasure(value: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

export function serialLines(serials: string[], perLine = 4): string[] {
  const clean = serials.map((serial) => serial.trim()).filter(Boolean);
  const lines: string[] = [];
  for (let index = 0; index < clean.length; index += perLine) {
    lines.push(clean.slice(index, index + perLine).join(", "));
  }
  return lines;
}

export type CustomerDocumentLineInput = {
  customerPartNumber: string;
  customerDescription: string;
  qty: string;
  unitPrice: string;
  extPrice: string;
  htsCode: string;
  eccn: string;
  /** Sales-order line condition. Used only when the mapped SKU has none. */
  condition?: string;
  lineNote?: string;
  allocations: {
    sku: string;
    name: string;
    description?: string;
    /** items.condition. New or Used. */
    condition?: string;
    /** items.condition_note. */
    conditionNote?: string;
    qty: string;
    unitPrice: string;
    extPrice: string;
    htsCode?: string;
    eccn?: string;
    serials?: string[];
  }[];
};

export type CustomerDocumentLine = {
  sku: string;
  description: string;
  extra: string[];
  compliance: string;
  lineNote: string;
  serials: string[];
  qty: string;
  unitPrice: string;
  extPrice: string;
};

/**
 * Confirmation description, in order. Blank parts are left off.
 * Customer PO text is never included.
 */
export function confirmationDescription(input: {
  sku: string;
  itemDescription: string;
  condition: string;
  conditionNote: string;
}): { description: string; extra: string[] } {
  const description = input.itemDescription.trim() || input.sku.trim() || "Item";
  const condition = input.condition.trim();
  const conditionNote = input.conditionNote.trim();
  return {
    description,
    extra: [condition ? `Condition: ${condition}` : "", conditionNote ? `Condition note: ${conditionNote}` : ""].filter(Boolean),
  };
}

/** One printed row per mapped SKU. The same SKU stays on separate rows when the prices differ. */
export function customerDocumentLines(
  lines: CustomerDocumentLineInput[],
  currency: string,
  kind: CustomerDocumentKind = "invoice",
): CustomerDocumentLine[] {
  const printed: CustomerDocumentLine[] = [];
  for (const line of lines) {
    const mapped = line.allocations.filter((row) => row.sku.trim() && Number(row.qty) > 0);
    const sources =
      mapped.length > 0
        ? mapped.map((row) => ({
            sku: row.sku,
            description: row.description ?? "",
            condition: row.condition ?? "",
            conditionNote: row.conditionNote ?? "",
            htsCode: row.htsCode ?? "",
            eccn: row.eccn ?? "",
            qty: row.qty,
            unitPrice: row.unitPrice || line.unitPrice,
            extPrice: row.extPrice,
            serials: row.serials ?? [],
          }))
        : [
            {
              sku: line.customerPartNumber,
              description: "",
              condition: "",
              conditionNote: "",
              htsCode: "",
              eccn: "",
              qty: line.qty,
              unitPrice: line.unitPrice,
              extPrice: line.extPrice,
              serials: [] as string[],
            },
          ];
    for (const source of sources) {
      if (!(Number(source.qty) > 0)) continue;
      const itemDescription = source.description.trim();
      let description: string;
      let extra: string[];
      if (kind === "confirmation") {
        const copy = confirmationDescription({
          sku: source.sku,
          itemDescription,
          condition: source.condition.trim() || (line.condition ?? "").trim(),
          conditionNote: source.conditionNote,
        });
        description = copy.description;
        extra = copy.extra;
      } else {
        const written = line.customerDescription
          .split(/\r?\n/)
          .map((part) => part.trim())
          .filter(Boolean);
        description = itemDescription || written[0] || source.sku.trim() || "Item";
        extra = itemDescription ? written : written.slice(1);
      }
      const ext = source.extPrice.trim() || lineExtension(source.qty, source.unitPrice) || "";
      printed.push({
        sku: source.sku.trim(),
        description,
        extra,
        compliance: resolvedCompliance(line, source),
        lineNote: (line.lineNote ?? "").trim(),
        serials: serialLines(source.serials),
        qty: documentQty(source.qty),
        unitPrice: money(source.unitPrice, currency),
        extPrice: money(ext, currency),
      });
    }
  }
  return printed;
}

export function complianceText(hts: string, eccn: string): string {
  const parts = [hts.trim() ? `HTS: ${hts.trim()}` : "", eccn.trim() ? `ECCN: ${eccn.trim()}` : ""].filter(Boolean);
  return parts.join("   ");
}

/** Line codes win when set. A blank side falls back to the mapped item. */
export function resolvedCompliance(
  line: { htsCode: string; eccn: string },
  item: { htsCode: string; eccn: string },
): string {
  return complianceText(line.htsCode.trim() || item.htsCode, line.eccn.trim() || item.eccn);
}

/** One shared line under the description when every mapped SKU resolves to the same codes. */
export function lineComplianceDisplay(line: {
  htsCode: string;
  eccn: string;
  allocations: { usHts: string; eccn: string }[];
}): { underDescription: string; perAllocation: string[] } {
  if (line.allocations.length === 0) {
    return { underDescription: complianceText(line.htsCode, line.eccn), perAllocation: [] };
  }
  const perAllocation = line.allocations.map((row) =>
    resolvedCompliance(line, { htsCode: row.usHts, eccn: row.eccn }),
  );
  const present = [...new Set(perAllocation.filter(Boolean))];
  if (present.length <= 1) {
    return { underDescription: present[0] ?? "", perAllocation: perAllocation.map(() => "") };
  }
  return { underDescription: "", perAllocation };
}

function money(value: string, currency: string): string {
  if (!value.trim()) return "";
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return value;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(numeric);
  } catch {
    return numeric.toFixed(2);
  }
}

export type CustomerDocumentInput = {
  kind: CustomerDocumentKind;
  soNumber: number;
  documentDate: string;
  orderDate: string;
  salesRep: string;
  paymentTerms: string;
  incoterms: string;
  shipMethod: string;
  shipAccount: string;
  orderRef: string;
  tracking: string;
  customerName: string;
  billTo: SoAddress;
  shipTo: SoAddress;
  shipTail: string[];
  currency: string;
  exportNotes: string;
  packages: { boxNumber: number; weightLb: number | null; lengthIn: number | null; widthIn: number | null; heightIn: number | null }[];
  lines: CustomerDocumentLineInput[];
};

export type CustomerDocument = {
  kind: CustomerDocumentKind;
  title: string;
  barcode: string;
  salesOrderRef: string;
  documentDate: string;
  orderDate: string;
  salesRep: string;
  paymentTerms: string;
  incoterms: string;
  shipMethod: string;
  shipAccount: string;
  orderRef: string;
  tracking: string;
  billTo: string[];
  shipTo: string[];
  lines: CustomerDocumentLine[];
  notes: string[];
  subtotal: string;
  tax: string;
  total: string;
};

export function buildCustomerDocument(input: CustomerDocumentInput): CustomerDocument | null {
  const barcode = customerDocumentBarcode(input.kind, input.soNumber);
  if (!barcode) return null;
  const lines = customerDocumentLines(input.lines, input.currency, input.kind);
  const subtotal = salesOrderTotal(lines.map((line) => ({ extPrice: line.extPrice })));
  const notes = [input.exportNotes.trim(), ...packageNotes(input.packages)].filter(Boolean);
  return {
    kind: input.kind,
    title: customerDocumentTitle(input.kind),
    barcode,
    salesOrderRef: `SO${input.soNumber}`,
    documentDate: documentDate(input.documentDate),
    orderDate: documentDate(input.orderDate),
    salesRep: input.salesRep.trim(),
    paymentTerms: input.paymentTerms.trim(),
    incoterms: input.incoterms.trim(),
    shipMethod: input.shipMethod.trim(),
    shipAccount: input.shipAccount.trim(),
    orderRef: input.orderRef.trim(),
    tracking: input.tracking.trim(),
    billTo: documentPartyLines(input.customerName, input.billTo),
    shipTo: documentPartyLines(input.customerName, input.shipTo, input.shipTail),
    lines,
    notes,
    subtotal: money(subtotal == null ? "0" : String(subtotal), input.currency),
    tax: money("0", input.currency),
    total: money(subtotal == null ? "0" : String(subtotal), input.currency),
  };
}
