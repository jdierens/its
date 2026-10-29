export type OrderContact = {
  person: string;
  email: string;
  phone: string;
};

const EMAIL_SOURCE = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const PHONE_SOURCE = "(?:\\+?\\d{1,3}[\\s.-]*)?(?:\\(\\d{3}\\)|\\d{3})[\\s.-]\\d{3}[\\s.-]\\d{4}";

function emailPattern(): RegExp {
  return new RegExp(EMAIL_SOURCE, "g");
}

function phonePattern(): RegExp {
  return new RegExp(PHONE_SOURCE);
}
const PERSON_LABEL =
  /^(?:contact(?:\s+person|\s+name)?|attn\.?|attention|buyer|ordered\s+by|requested\s+by|purchasing\s+agent|purchaser|prepared\s+by)\s*[:\-]\s*(.+)$/i;
const EMAIL_LABEL = /^(?:e-?mail|contact\s+email)\s*[:\-]\s*(.+)$/i;
const PHONE_LABEL = /^(?:phone|tel(?:ephone)?|mobile|cell|contact\s+phone)\s*[:\-]\s*(.+)$/i;

export function blankContact(): OrderContact {
  return { person: "", email: "", phone: "" };
}

export function contactHasAny(contact: OrderContact): boolean {
  return Boolean(contact.person.trim() || contact.email.trim() || contact.phone.trim());
}

/** Keeps a value already on the order. Fills only what is still blank. */
export function mergeBlankContact(current: OrderContact, found: OrderContact): OrderContact {
  return {
    person: current.person.trim() || cleanPerson(found.person),
    email: current.email.trim() || found.email.trim(),
    phone: current.phone.trim() || found.phone.trim(),
  };
}

function cleanPerson(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  text = text.replace(emailPattern(), " ").replace(new RegExp(PHONE_SOURCE, "g"), " ").replace(/\s+/g, " ").trim();
  text = text.replace(/[|•].*$/, "").replace(/[,;]\s*$/, "").trim();
  text = text.replace(/^[:\-]+|[:\-]+$/g, "").trim();
  if (!text || !/[A-Za-z]/.test(text) || text.length > 120) return "";
  return text.slice(0, 200);
}

function firstEmail(text: string): string {
  const matches = text.match(emailPattern()) ?? [];
  const usable = matches.find((email) => !/no-?reply|donotreply|notifications?/i.test(email));
  return usable ?? matches[0] ?? "";
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n| {2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Best-effort contact from a customer PO. Missing pieces stay blank. */
export function contactFromPoText(text: string): OrderContact {
  let person = "";
  let email = "";
  let phone = "";
  for (const line of linesOf(text)) {
    if (!person) {
      const match = line.match(PERSON_LABEL);
      if (match) person = cleanPerson(match[1]);
    }
    if (!email) {
      const match = line.match(EMAIL_LABEL);
      if (match) email = firstEmail(match[1]);
    }
    if (!phone) {
      const match = line.match(PHONE_LABEL);
      if (match) {
        const found = match[1].match(phonePattern());
        if (found) phone = found[0];
      }
    }
  }
  if (!email) email = firstEmail(text);
  if (!phone) {
    const found = text.match(phonePattern());
    if (found) phone = found[0];
  }
  return { person, email, phone };
}

/**
 * Email capture fallback. A display name wins. Otherwise the mailbox local-part
 * is the contact person. Phone and a clearer name come from the body when present.
 */
export function contactFromEmail(input: { from?: string | null; body?: string | null }): OrderContact {
  const from = (input.from ?? "").replace(/\s+/g, " ").trim();
  let person = "";
  let email = "";
  const named = from.match(/^"?([^"<]+?)"?\s*<\s*([^>]+)\s*>$/);
  if (named) {
    person = cleanPerson(named[1]) || named[1].trim();
    email = firstEmail(named[2]);
  } else {
    email = firstEmail(from);
    if (email) person = email.split("@")[0] ?? "";
  }
  const body = contactFromPoText(input.body ?? "");
  return mergeBlankContact({ person, email, phone: "" }, body);
}
