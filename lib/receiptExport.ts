/** Project typing waits so each keystroke does not query. A save or a page change does not. */
export const RECEIPT_LIST_PROJECT_DELAY_MS = 300;

export function receiptListRefreshDelay(projectChanged: boolean): number {
  return projectChanged ? RECEIPT_LIST_PROJECT_DELAY_MS : 0;
}

export type ReceiptExportKind = "summary" | "detail";

/**
 * The summary and detail downloads repeat the same project and kind.
 * A fresh token makes each download a new request, and no-store keeps a
 * previous response from being reused after a line is entered or corrected.
 */
export function receiptExportRequest(project: string, kind: ReceiptExportKind, fresh: number) {
  return {
    cache: "no-store" as const,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    body: JSON.stringify({ project, kind, fresh }),
  };
}
