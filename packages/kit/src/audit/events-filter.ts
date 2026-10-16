import {
  and,
  eq,
  gt,
  inArray,
  lt,
  or,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm"

import type { AuditEventFilter, AuditEventRow } from "./events.js"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/** Columns of audit_events that are not context columns. */
export const AUDIT_EVENT_BASE_COLUMNS = new Set([
  "id",
  "name",
  "subject_type",
  "subject_id",
  "user_id",
  "data",
  "created_at",
])

/** Splits a name filter into exact names and family prefixes ("api_key.*" → "api_key."). */
export function resolveNameFilter(name: string | string[]): {
  exact: string[]
  prefixes: string[]
} {
  const names = Array.isArray(name) ? name : [name]
  const exact: string[] = []
  const prefixes: string[] = []
  for (const entry of names) {
    if (entry.endsWith(".*")) {
      prefixes.push(entry.slice(0, -1))
      continue
    }
    exact.push(entry)
  }

  return { exact, prefixes }
}

/** Escapes `%`, `_` and the escape char itself for a `LIKE ... ESCAPE '\'` pattern. */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function resolveLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer")
  }

  return Math.min(limit, MAX_LIMIT)
}

/** Splits an audit_events table's columns into the base ones and the context columns. */
export function auditEventColumns(columns: Record<string, Column>): {
  base: Record<string, Column>
  context: string[]
} {
  const base: Record<string, Column> = {}
  const context: string[] = []
  for (const [key, column] of Object.entries(columns)) {
    if (AUDIT_EVENT_BASE_COLUMNS.has(key)) {
      base[key] = column
      continue
    }
    context.push(key)
  }
  for (const key of AUDIT_EVENT_BASE_COLUMNS) {
    if (!base[key]) {
      throw new Error(`audit events table is missing the "${key}" column`)
    }
  }

  return { base, context }
}

/**
 * Builds the WHERE clause for a filter. `timestamp` turns a Date into the value
 * compared against created_at (Postgres takes the Date, SQLite its text form).
 */
export function buildAuditEventsWhere(
  columns: Record<string, Column>,
  contextColumns: string[],
  filter: AuditEventFilter,
  timestamp: (date: Date) => unknown,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = []

  if (filter.name !== undefined) {
    const { exact, prefixes } = resolveNameFilter(filter.name)
    const nameConditions = [
      exact.length > 0 ? inArray(columns.name!, exact) : undefined,
      ...prefixes.map(
        (prefix) => sql`${columns.name} LIKE ${`${escapeLikePrefix(prefix)}%`} ESCAPE '\\'`,
      ),
    ]
    conditions.push(or(...nameConditions) ?? sql`false`)
  }
  if (filter.subject) {
    conditions.push(eq(columns.subject_type!, filter.subject.type))
    if (filter.subject.id !== undefined) {
      conditions.push(eq(columns.subject_id!, filter.subject.id))
    }
  }
  if (filter.userId !== undefined) {
    conditions.push(eq(columns.user_id!, filter.userId))
  }
  for (const [key, value] of Object.entries(filter.context ?? {})) {
    if (!contextColumns.includes(key)) {
      throw new Error(`unknown audit context column "${key}"`)
    }
    conditions.push(eq(columns[key]!, value))
  }
  if (filter.after) {
    conditions.push(gt(columns.created_at!, timestamp(filter.after)))
  }
  if (filter.before) {
    conditions.push(lt(columns.created_at!, timestamp(filter.before)))
  }
  if (filter.cursor !== undefined) {
    conditions.push(lt(columns.id!, filter.cursor))
  }

  return and(...conditions)
}

/** Maps a raw audit_events row to the public row shape. */
export function toAuditEventRow(
  row: Record<string, unknown>,
  contextColumns: string[],
  parse: { data: (value: unknown) => unknown; createdAt: (value: unknown) => Date },
): AuditEventRow {
  return {
    id: Number(row.id),
    name: row.name as string,
    subjectType: (row.subject_type as string | null) ?? null,
    subjectId: (row.subject_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    data: row.data == null ? null : parse.data(row.data),
    createdAt: parse.createdAt(row.created_at),
    context: Object.fromEntries(
      contextColumns.map((column) => [column, (row[column] as string | null) ?? null]),
    ),
  }
}
