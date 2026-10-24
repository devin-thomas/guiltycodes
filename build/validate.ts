// Boundary parsers for untrusted JSON and YAML: each returns the required value or throws a labelled error.
export function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  // The check above proves a non-array object; TypeScript cannot narrow `object` to an indexable record without this.
  return value as Record<string, unknown>;
}

export function parseText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value;
}

type TextListOptions = { readonly nonempty?: boolean; readonly unique?: boolean };

export function parseTextList(value: unknown, label: string, { nonempty = false, unique = true }: TextListOptions = {}): readonly string[] {
  if (!Array.isArray(value) || (nonempty && !value.length))
    throw new Error(`${label} must be an array${nonempty ? " with at least one item" : ""}`);
  const items: readonly unknown[] = value;
  const texts: readonly string[] = items.map((item: unknown): string => parseText(item, label));
  if (unique && new Set(texts).size !== texts.length) throw new Error(`${label} contains duplicates`);
  return texts;
}

export function parseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function parseNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}
