import type { QboEnvironment } from "@/lib/qbo/config";

export type QboFailure = {
  subject: string;
  status: number;
  code: string | null;
  message: string;
  intuitTid: string | null;
  environment?: QboEnvironment | null;
  refreshed?: boolean;
};

export function formatQboError(input: QboFailure): string {
  const statusText = input.status > 0 ? `HTTP ${input.status}` : "no HTTP response";
  const codeText = input.code ? `, Intuit ${input.code}` : "";
  const detail =
    input.message && input.message !== "QuickBooks request failed." ? ` ${input.message}.` : "";
  const tid = input.intuitTid ? ` intuit_tid ${input.intuitTid}.` : "";
  const hint = environmentMismatchHint(input);
  return `${input.subject} failed: ${statusText}${codeText}.${detail}${tid}${hint ? ` ${hint}` : ""}`.replace(
    /\s+/g,
    " ",
  );
}

export function environmentMismatchHint(input: QboFailure): string | null {
  if (input.environment !== "sandbox" && input.environment !== "production") return null;
  const code = (input.code ?? "").replace(/^0+/, "");
  const authStatus = input.status === 401 || input.status === 403;
  const applicationAuth = code === "3100" || /applicationauthenticationfailed/i.test(input.message);
  const rejectedAfterRefresh = input.refreshed === true && authStatus && (code === "3200" || /authenticationfailed/i.test(input.message));
  const wrongCompany = /invalid realm|company.*(not found|does not exist)/i.test(input.message);
  if (!applicationAuth && !rejectedAfterRefresh && !wrongCompany) return null;
  if (input.environment === "sandbox") {
    return "QBO_ENVIRONMENT is sandbox, so this request used the sandbox API. Production keys and a production company are rejected there. Set QBO_ENVIRONMENT to production and reconnect.";
  }
  return "QBO_ENVIRONMENT is production, so this request used the production API. Sandbox keys and a sandbox company are rejected there. Set QBO_ENVIRONMENT to sandbox and reconnect.";
}
