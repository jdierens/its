import { createHash } from "node:crypto";

/**
 * eBay marketplace account deletion challenge.
 * challengeResponse is the hex SHA-256 of challengeCode + verificationToken + endpoint,
 * with no separator. The endpoint is the exact URL configured in the eBay developer portal.
 */
export function challengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return createHash("sha256").update(`${challengeCode}${verificationToken}${endpoint}`).digest("hex");
}
