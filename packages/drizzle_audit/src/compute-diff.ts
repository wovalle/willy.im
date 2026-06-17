export type DiffEntry = {
  field: string;
  old: unknown;
  new: unknown;
};

export type DiffResult = {
  operation: string;
  changes: DiffEntry[];
};

export type ComputeDiffOptions = {
  /** Fields to exclude from the diff (default: ["updated_at", "created_at"]) */
  ignoreFields?: string[];
};

const DEFAULT_IGNORE = ["updated_at", "created_at"];

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function computeDiff(
  operation: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  options?: ComputeDiffOptions,
): DiffResult {
  const ignore = options?.ignoreFields ?? DEFAULT_IGNORE;

  if (oldData === null && newData === null) {
    return { operation, changes: [] };
  }

  const allKeys = Array.from(
    new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]),
  )
    .filter((k) => !ignore.includes(k))
    .sort();

  const changes: DiffEntry[] = [];

  for (const field of allKeys) {
    const oldVal = oldData?.[field] ?? null;
    const newVal = newData?.[field] ?? null;

    if (!deepEqual(oldVal, newVal)) {
      changes.push({ field, old: oldVal, new: newVal });
    }
  }

  return { operation, changes };
}
