export type ShareHints = {
  maxTouchPoints?: number;
  platform?: string;
};

/**
 * iOS Safari (including Chrome on iOS, and iPadOS reporting as a Mac) ignores a
 * download started from a blob after an async request. Those browsers need a
 * real navigation that returns Content-Disposition: attachment.
 */
export function prefersFileShare(userAgent: string, hints?: ShareHints): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return /Mac/i.test(hints?.platform ?? "") && (hints?.maxTouchPoints ?? 0) > 1;
}
