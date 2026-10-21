/** Admin, staff, and read_only can see prices. While sign-in is off, the open app can too. */
export function canViewFinancials(role: string | null, authOn: boolean): boolean {
  if (!authOn) return true;
  return role === "admin" || role === "staff" || role === "read_only";
}

export function sameItemName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** A blank SKU is assigned on save. A typed SKU must not be the original. */
export function skuReusesSource(sku: string, sourceSku: string): boolean {
  const typed = sku.trim();
  const source = sourceSku.trim();
  if (!typed || !source) return false;
  return typed.toLowerCase() === source.toLowerCase();
}
