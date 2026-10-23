export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value;
}

export function list(
  value: unknown,
  label: string,
  { nonempty = false, unique = true }: { readonly nonempty?: boolean; readonly unique?: boolean } = {},
): readonly string[] {
  if (!Array.isArray(value) || (nonempty && !value.length))
    throw new Error(`${label} must be an array${nonempty ? " with at least one item" : ""}`);
  const items: readonly unknown[] = value;
  const result: readonly string[] = items.map((item: unknown): string => text(item, label));
  if (unique && new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}
