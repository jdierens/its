/**
 * Files on a purchase order. None of these are customer documents.
 * Each type can carry prices, so a role without can_view_financials receives none of them:
 * a vendor invoice and a quote are the bill and the offer, an order confirmation repeats
 * those prices, and Other is unlabeled so it is treated as a money file too.
 */
export const PO_ATTACHMENT_KINDS = [
  { id: "vendor_invoice", label: "Vendor invoice" },
  { id: "quote", label: "Quote" },
  { id: "order_confirmation", label: "Order confirmation" },
  { id: "other", label: "Other" },
] as const;

export type PoAttachmentKind = (typeof PO_ATTACHMENT_KINDS)[number]["id"];

const KINDS = new Set<string>(PO_ATTACHMENT_KINDS.map((kind) => kind.id));

export function parseAttachmentKind(value: string): PoAttachmentKind | null {
  return KINDS.has(value) ? (value as PoAttachmentKind) : null;
}

export function attachmentKindLabel(value: string): string {
  return PO_ATTACHMENT_KINDS.find((kind) => kind.id === value)?.label ?? "File";
}

export const PO_DOCUMENT_BUCKET = "po-documents";
export const PO_PDF_LIMIT = 10 * 1024 * 1024;
export const PO_ATTACHMENT_LIMIT = 20;

export function pdfFileError(file: { name: string; type: string; size: number }): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "Choose a PDF.";
  if (file.size > PO_PDF_LIMIT) return "A PDF must be 10 MB or smaller.";
  const pdfName = file.name.toLowerCase().endsWith(".pdf");
  const pdfType = file.type === "application/pdf" || file.type === "";
  if (!pdfName || !pdfType) return "Attachments are PDF files.";
  return null;
}

export function pdfDisplayName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "").trim().slice(0, 180);
  if (!cleaned) return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}
