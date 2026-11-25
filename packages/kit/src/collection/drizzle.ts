import { and, asc, desc, eq, gt, lt, or, type SQL, type SQLWrapper } from "drizzle-orm"
import type { After, Dir } from "../collection.js"

/**
 * The rows strictly after `after` in `(columns…)` order, for a collection's `load` on drizzle.
 * `columns` are the sort key's columns, then the id column last: `[t.createdAt, t.id]`, or
 * `[t.lastName, t.firstName, t.id]` for a tuple key. Null `after` (the first page) gives
 * `undefined`, so the result goes straight into `and(...)`. Values go through each column's
 * mapping, so for a column that holds a `Date` turn the key back into one first.
 *
 * For `desc`: `(c1 < k1) OR (c1 = k1 AND c2 < k2) OR …`; `>` for `asc`.
 */
export function cursorWhere(
  columns: readonly SQLWrapper[],
  after: After<unknown, unknown> | null,
  dir: Dir,
): SQL | undefined {
  if (!after) return undefined
  const values = [...(Array.isArray(after.key) ? after.key : [after.key]), after.id]
  if (columns.length !== values.length)
    throw new Error(
      `kit: cursorWhere needs ${values.length} columns (the sort key's ${values.length - 1}, then the id), got ${columns.length}`,
    )
  const past = dir === "asc" ? gt : lt
  return or(
    ...columns.map((column, i) =>
      and(...columns.slice(0, i).map((c, j) => eq(c, values[j])), past(column, values[i])),
    ),
  )
}

/** `orderBy` for the same columns: each one `asc` or `desc`, the id last. */
export function orderFor(columns: readonly SQLWrapper[], dir: Dir): SQL[] {
  return columns.map((c) => (dir === "asc" ? asc(c) : desc(c)))
}
