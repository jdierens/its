export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isPublicToken(value: unknown): value is string {
  return typeof value === "string" && /^public-(sandbox|production)-[A-Za-z0-9-]{8,180}$/.test(value);
}
