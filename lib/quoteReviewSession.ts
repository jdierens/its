import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { quoteReviewAccessForRole, type QuoteReviewAccess } from "@/lib/quoteReviewAccess";
import { sessionUser } from "@/lib/sessionUser";

export async function quoteReviewPageAccess(): Promise<QuoteReviewAccess> {
  if (!authRequired()) return quoteReviewAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return quoteReviewAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return quoteReviewAccessForRole(null, true);
  return quoteReviewAccessForRole(user.role, true, user.pricing_officer);
}
