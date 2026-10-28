/**
 * Files on an inventory item. Kinds are a closed list, the same way sales-order
 * attachment kinds are: add a value here and in the item_attachments check.
 */
export const ITEM_ATTACHMENT_KINDS = [
  { id: "product_brief", label: "Product brief" },
  { id: "data_sheet", label: "Data sheet" },
  { id: "manual", label: "Manual" },
  { id: "other", label: "Other" },
] as const;

export type ItemAttachmentKind = (typeof ITEM_ATTACHMENT_KINDS)[number]["id"];

const KINDS = new Set<string>(ITEM_ATTACHMENT_KINDS.map((kind) => kind.id));

export function parseItemAttachmentKind(value: string): ItemAttachmentKind | null {
  return KINDS.has(value) ? (value as ItemAttachmentKind) : null;
}

export function itemAttachmentKindLabel(value: string): string {
  return ITEM_ATTACHMENT_KINDS.find((kind) => kind.id === value)?.label ?? "File";
}

export const ITEM_DOCUMENT_BUCKET = "item-documents";
export const ITEM_PDF_LIMIT = 10 * 1024 * 1024;
export const ITEM_ATTACHMENT_LIMIT = 20;

export function itemPdfFileError(file: { name: string; type: string; size: number }): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "Choose a PDF.";
  if (file.size > ITEM_PDF_LIMIT) return "A PDF must be 10 MB or smaller.";
  const pdfName = file.name.toLowerCase().endsWith(".pdf");
  const pdfType = file.type === "application/pdf" || file.type === "";
  if (!pdfName || !pdfType) return "Attachments are PDF files.";
  return null;
}

export function itemPdfDisplayName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "").trim().slice(0, 180);
  if (!cleaned) return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

/** True when item_attachments has not been created yet. Other errors stay errors. */
export function itemAttachmentsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/item_attachments/i.test(message)) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist|could not find/i.test(message);
}
