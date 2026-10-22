/** Pause before a search box writes the address or starts a list fetch. */
export const QUERY_COMMIT_MS = 280;

/**
 * The field keeps what the user typed. A URL or server value is applied only
 * when the field is idle and the value is not the one this field just published.
 */
export function adoptExternalQuery(input: {
  focused: boolean;
  draft: string;
  external: string;
  published: string;
}): string | null {
  if (input.external === input.published) return null;
  if (input.focused) return null;
  if (input.external === input.draft) return null;
  return input.external;
}
