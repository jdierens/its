/**
 * Text for a toast, banner, or inline alert.
 *
 * Postgres and PostgREST constraint failures are rewritten into a sentence an
 * operator can act on. Table names, column names, constraint names, and the
 * conflicting value are kept. Tokens, connection strings, and service-role
 * keys are not.
 *
 * In production, Next.js replaces a thrown server-action error with
 * "omitted in production builds to avoid leaking sensitive details" and only
 * forwards `digest`. `installExposeErrors` makes `digest` the same sentence
 * `errorText` would show, so a client that calls `errorText` still sees it.
 */

const FALLBACK = "Something went wrong.";
const LIMIT = 800;
const REDACTED_BY_NEXT = /omitted in production builds to avoid leaking sensitive details/i;
const DATABASE_ERROR =
  /duplicate key value violates unique constraint|violates foreign key constraint|violates check constraint|violates exclusion constraint|conflicting key value violates exclusion constraint|violates not-null constraint|invalid input syntax for type|value too long for type|deadlock detected|could not serialize access|numeric field overflow|integer out of range|smallint out of range|bigint out of range|canceling statement due to/i;
const INSTALLED = Symbol.for("its.exposeErrorDigest");

type ErrorParts = {
  message: string;
  details: string;
  hint: string;
};

type KeyParts = {
  columns: string[];
  values: string[];
};

export function errorText(error: unknown, fallback = FALLBACK): string {
  if (typeof error === "string") return finish(error, fallback);
  if (!error || typeof error !== "object") return fallback;

  const record = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    digest?: unknown;
  };
  const message = textPart(record.message) ?? "";
  const details = textPart(record.details) ?? "";
  const hint = textPart(record.hint) ?? "";
  if (REDACTED_BY_NEXT.test(message) || DATABASE_ERROR.test(message) || DATABASE_ERROR.test(details)) {
    const carried = carriedDigest(readDigest(record));
    if (carried) return carried;
  }
  if (REDACTED_BY_NEXT.test(message)) return finish(message, fallback);

  const parts = { message, details, hint };
  return finish(databaseMessage(parts) ?? plain(parts), fallback);
}

/** Puts the operator-facing sentence on `error.digest` for every later Error. */
export function installExposeErrors(): void {
  const proto = Error.prototype as Error & { [INSTALLED]?: boolean };
  if (proto[INSTALLED]) return;
  Object.defineProperty(proto, INSTALLED, { value: true, configurable: true });
  Object.defineProperty(proto, "digest", {
    configurable: true,
    enumerable: false,
    get(this: Error & { __itsDigest?: string; __itsFormatting?: boolean }) {
      if (typeof this.__itsDigest === "string") return this.__itsDigest;
      if (this.__itsFormatting) return undefined;
      const message = typeof this.message === "string" ? this.message : "";
      if (!message.trim() || REDACTED_BY_NEXT.test(message)) return undefined;
      this.__itsFormatting = true;
      try {
        const extra = this as { details?: unknown; hint?: unknown };
        return errorText({ message, details: extra.details, hint: extra.hint });
      } finally {
        this.__itsFormatting = false;
      }
    },
    set(this: Error & { __itsDigest?: string }, value: unknown) {
      if (typeof value === "string") this.__itsDigest = value;
    },
  });
}

/** Test helper. Production keeps the digest bridge installed. */
export function uninstallExposeErrors(): void {
  const proto = Error.prototype as Error & { [INSTALLED]?: boolean };
  if (!proto[INSTALLED]) return;
  delete (proto as { digest?: unknown }).digest;
  delete proto[INSTALLED];
}

if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
  installExposeErrors();
}

function databaseMessage(parts: ErrorParts): string | null {
  const blob = [parts.message, parts.details, parts.hint].filter(Boolean).join(" ");
  return (
    uniqueMessage(blob) ||
    foreignKeyMessage(blob) ||
    notNullMessage(blob) ||
    checkMessage(blob) ||
    invalidInputMessage(blob) ||
    tooLongMessage(blob) ||
    rangeMessage(parts.message) ||
    busyMessage(parts.message)
  );
}

function uniqueMessage(blob: string): string | null {
  const unique = /duplicate key value violates unique constraint/i.test(blob);
  const exclusion =
    /violates exclusion constraint/i.test(blob) || /conflicting key value violates exclusion constraint/i.test(blob);
  if (!unique && !exclusion) return null;
  const constraint = blob.match(/(?:unique|exclusion) constraint "([^"]+)"/i)?.[1] ?? "";
  const where = constraint ? ` (${constraint})` : "";
  const key = parseKey(blob);
  if (key && key.columns.length === 1 && key.values.length === 1) {
    return `Failed to save: ${showValue(key.values[0])} already exists. It must be unique for ${key.columns[0]}${where}.`;
  }
  if (key && key.columns.length > 1 && key.columns.length === key.values.length) {
    const pairs = key.columns.map((column, index) => `${column} ${showValue(key.values[index] ?? "")}`).join(", ");
    return `Failed to save: ${pairs} already exists. Those values must be unique together${where}.`;
  }
  return `Failed to save: a duplicate value already exists. It must be unique${where}.`;
}

function foreignKeyMessage(blob: string): string | null {
  if (!/violates foreign key constraint/i.test(blob)) return null;
  const constraint = blob.match(/foreign key constraint "([^"]+)"/i)?.[1] ?? "";
  const where = constraint ? ` (${constraint})` : "";
  const key = parseKey(blob);
  const field = key?.columns.length === 1 ? key.columns[0] : "";
  const value = key?.values.length === 1 ? showValue(key.values[0] ?? "") : "";
  const subject = field && value ? `${field} ${value}` : value || field || "That value";
  const missing = blob.match(/not present in table "([^"]+)"/i);
  if (missing) return `Failed to save: ${subject} is not in ${missing[1]}${where}.`;
  const referenced = blob.match(/still referenced from table "([^"]+)"/i);
  if (referenced) return `Failed to save: ${subject} is still used by ${referenced[1]}${where}.`;
  return `Failed to save: a related row is missing or still in use${where}.`;
}

function notNullMessage(blob: string): string | null {
  const match = blob.match(/null value in column "([^"]+)" of relation "([^"]+)" violates not-null constraint/i);
  if (!match) return null;
  return `Failed to save: ${match[1]} is required on ${match[2]}.`;
}

function checkMessage(blob: string): string | null {
  const match = blob.match(/violates check constraint "([^"]+)"/i);
  if (!match) return null;
  const relation = blob.match(/relation "([^"]+)"/i)?.[1];
  return relation
    ? `Failed to save: ${match[1]} on ${relation} was not satisfied.`
    : `Failed to save: ${match[1]} was not satisfied.`;
}

function invalidInputMessage(blob: string): string | null {
  const match = blob.match(/invalid input syntax for type ([^:]+):\s*"([^"]*)"/i);
  if (!match) return null;
  return `Failed to save: ${showValue(match[2] ?? "")} is not a valid ${match[1].trim()}.`;
}

function tooLongMessage(blob: string): string | null {
  const match = blob.match(/value too long for type ([^.]+)/i);
  if (!match) return null;
  return `Failed to save: the value is too long for ${match[1].trim()}.`;
}

function rangeMessage(message: string): string | null {
  if (!/^(?:numeric field overflow|integer out of range|smallint out of range|bigint out of range)\b/i.test(message)) {
    return null;
  }
  return "Failed to save: the number is out of range.";
}

function busyMessage(message: string): string | null {
  if (/^deadlock detected\b/i.test(message) || /^could not serialize access\b/i.test(message)) {
    return "Failed to save: another update was using those rows. Try again.";
  }
  if (/^canceling statement due to (?:statement timeout|user request)\b/i.test(message)) {
    return "Failed to save: the database canceled the request. Try again.";
  }
  return null;
}

function parseKey(text: string): KeyParts | null {
  const start = text.indexOf("Key (");
  if (start < 0) return null;
  const open = start + 4;
  const columns = readBalanced(text, open);
  if (columns == null) return null;
  const close = open + columns.length + 1;
  if (text.slice(close, close + 3) !== ")=(") return null;
  const values = readBalanced(text, close + 2);
  if (values == null) return null;
  const fields = splitTop(columns);
  if (fields.length === 0) return null;
  return { columns: fields, values: splitTop(values) };
}

function readBalanced(text: string, open: number): string | null {
  if (text[open] !== "(") return null;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}

function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      const part = input.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const last = input.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function showValue(value: string): string {
  const clean = redactSecrets(value).replace(/\s+/g, " ").trim();
  const shown = clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
  return `"${shown}"`;
}

function plain(parts: ErrorParts): string {
  return [parts.message, parts.details, parts.hint].filter(Boolean).join(" ");
}

function textPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^Failing row contains \(/i.test(trimmed)) return null;
  return trimmed;
}

function carriedDigest(digest: unknown): string | null {
  if (typeof digest !== "string") return null;
  const text = digest.replace(/@E\d+$/, "").trim();
  if (!text || /^\d+$/.test(text) || text.startsWith("NEXT_") || REDACTED_BY_NEXT.test(text)) return null;
  const clean = finish(text, "");
  return clean || null;
}

function readDigest(error: object): unknown {
  try {
    return (error as { digest?: unknown }).digest;
  } catch {
    return undefined;
  }
}

function finish(text: string, fallback: string): string {
  const clean = redactSecrets(text).replace(/\s*\n\s*/g, " ").trim();
  if (!clean) return fallback;
  if (clean.length <= LIMIT) return clean;
  return `${clean.slice(0, LIMIT - 1)}…`;
}

function redactSecrets(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(?:sb_secret|sbp)_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi, "Bearer [redacted]")
    .replace(/([?&](?:apikey|api_key|access_token|refresh_token|token)=)[^&\s'"]+/gi, "$1[redacted]");
}
