export function createId(prefix: string): string {
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${randomPart}`;
}

export function createSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || createId("board");
}
