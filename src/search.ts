// search.json entries use one-letter keys to keep the index small: t title, g game, r release, s status, u URL, x search text.
export type SearchEntry = {
  readonly t: string;
  readonly g: string;
  readonly r: string;
  readonly s: "VERIFIED" | "INFERRED" | "NOT TESTED" | "SUPERSEDED";
  readonly u: string;
  readonly x: string;
};
export function parseSearch(value: unknown): readonly SearchEntry[] {
  if (!Array.isArray(value)) throw new Error("Search index must be an array");
  const entries: readonly unknown[] = value;
  return entries.map((entry: unknown): SearchEntry => {
    if (typeof entry !== "object" || entry === null) throw new Error("Invalid search entry");
    if (
      !("t" in entry) ||
      typeof entry.t !== "string" ||
      !("g" in entry) ||
      typeof entry.g !== "string" ||
      !("r" in entry) ||
      typeof entry.r !== "string" ||
      !("x" in entry) ||
      typeof entry.x !== "string" ||
      !("u" in entry) ||
      typeof entry.u !== "string" ||
      !entry.u.startsWith("/games/") ||
      !("s" in entry) ||
      (entry.s !== "VERIFIED" && entry.s !== "INFERRED" && entry.s !== "NOT TESTED" && entry.s !== "SUPERSEDED")
    )
      throw new Error("Invalid search entry");
    return { t: entry.t, g: entry.g, r: entry.r, x: entry.x, u: entry.u, s: entry.s };
  });
}
