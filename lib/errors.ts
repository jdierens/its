export function errorText(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "Something went wrong.";
  }

  const record = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const parts = [record.message, record.details, record.hint].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.join(" ") || "Something went wrong.";
}
