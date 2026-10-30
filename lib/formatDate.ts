/**
 * Display a calendar date as MM/DD/YY (for example 10/30/26).
 *
 * Date fields are stored as ISO (`YYYY-MM-DD` or a timestamptz). This reads the
 * calendar date in that string and does not shift it through a time zone.
 * A value that is not a date is returned trimmed, so a bad cell stays visible.
 * Full timestamps that include a time should keep their own formatter.
 */
export function formatDataDate(value: string | null | undefined): string {
  if (value == null) return "";
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return trimmed;
  const [, year, month, day] = match;
  return `${month}/${day}/${year.slice(2)}`;
}
