import { invoiceNumber, lineExtension, salesOrderTotal } from "@/lib/salesOrderDraft";
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
  return kind === "confirmation" ? "Sales Order Confirmation" : "INVOICE";
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
  return [name, address.line1, address.line2, formatDocumentLocality(address), address.country, ...tail]
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
  allocations: { sku: string; name: string; qty: string; unitPrice: string; extPrice: string; serials?: string[] }[];
};

export type CustomerDocumentLine = {
  sku: string;
  description: string;
  extra: string[];
  compliance: string;
  serials: string[];
  qty: string;
  unitPrice: string;
  extPrice: string;
};

/** One printed row per mapped SKU. The same SKU stays on separate rows when the prices differ. */
export function customerDocumentLines(lines: CustomerDocumentLineInput[], currency: string): CustomerDocumentLine[] {
  const printed: CustomerDocumentLine[] = [];
  for (const line of lines) {
    const mapped = line.allocations.filter((row) => row.sku.trim() && Number(row.qty) > 0);
    const sources =
      mapped.length > 0
        ? mapped.map((row) => ({
            sku: row.sku,
            name: row.name,
            qty: row.qty,
            unitPrice: row.unitPrice || line.unitPrice,
            extPrice: row.extPrice,
            serials: row.serials ?? [],
          }))
        : [
            {
              sku: line.customerPartNumber,
              name: "",
              qty: line.qty,
              unitPrice: line.unitPrice,
              extPrice: line.extPrice,
              serials: [] as string[],
            },
          ];
    for (const source of sources) {
      if (!(Number(source.qty) > 0)) continue;
      const written = line.customerDescription
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean);
      const description = written[0] || source.name.trim() || source.sku.trim() || "Item";
      const extra = written.length > 0 ? written.slice(1) : [];
      const ext = source.extPrice.trim() || lineExtension(source.qty, source.unitPrice) || "";
      printed.push({
        sku: source.sku.trim(),
        description,
        extra,
        compliance: complianceText(line.htsCode, line.eccn),
        serials: serialLines(source.serials),
        qty: documentQty(source.qty),
        unitPrice: money(source.unitPrice, currency),
        extPrice: money(ext, currency),
      });
    }
  }
  return printed;
}

function complianceText(hts: string, eccn: string): string {
  const parts = [hts.trim() ? `HTS: ${hts.trim()}` : "", eccn.trim() ? `ECCN: ${eccn.trim()}` : ""].filter(Boolean);
  return parts.join("   ");
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
  const barcode = invoiceNumber(input.soNumber, 1);
  if (!barcode) return null;
  const lines = customerDocumentLines(input.lines, input.currency);
  const subtotal = salesOrderTotal(lines.map((line) => ({ extPrice: line.extPrice })));
  const notes = [input.exportNotes.trim(), ...packageNotes(input.packages)].filter(Boolean);
  return {
    title: customerDocumentTitle(input.kind),
    barcode,
    salesOrderRef: `SO#${input.soNumber}`,
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
