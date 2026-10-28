/** Sales-order PDFs. Add a kind here and in so_attachments_kind_check. */
export const SO_ATTACHMENT_KINDS = [
  { id: "customer_po", label: "Customer PO" },
  { id: "shipping_label", label: "Shipping label" },
  { id: "proforma", label: "Proforma" },
  { id: "packing_list", label: "Packing list" },
  { id: "commercial_invoice", label: "Commercial invoice" },
  { id: "invoice", label: "Invoice" },
  { id: "other", label: "Other" },
] as const;

export type SoAttachmentKind = (typeof SO_ATTACHMENT_KINDS)[number]["id"];

const KINDS = new Set<string>(SO_ATTACHMENT_KINDS.map((kind) => kind.id));

export function parseSoAttachmentKind(value: string): SoAttachmentKind | null {
  return KINDS.has(value) ? (value as SoAttachmentKind) : null;
}

export function soAttachmentKindLabel(value: string): string {
  return SO_ATTACHMENT_KINDS.find((kind) => kind.id === value)?.label ?? "File";
}

export const SO_DOCUMENT_BUCKET = "so-documents";
export const SO_PDF_LIMIT = 10 * 1024 * 1024;
export const SO_ATTACHMENT_LIMIT = 20;

export function soPdfFileError(file: { name: string; type: string; size: number }): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "Choose a PDF.";
  if (file.size > SO_PDF_LIMIT) return "A PDF must be 10 MB or smaller.";
  const pdfName = file.name.toLowerCase().endsWith(".pdf");
  const pdfType = file.type === "application/pdf" || file.type === "";
  if (!pdfName || !pdfType) return "Attachments are PDF files.";
  return null;
}

export function soPdfDisplayName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "").trim().slice(0, 180);
  if (!cleaned) return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}
