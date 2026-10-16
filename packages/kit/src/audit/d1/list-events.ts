import { desc, getTableColumns } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"

import type { AuditEventFilter, AuditEventRow } from "../events.js"
import {
  auditEventColumns,
  buildAuditEventsWhere,
  resolveLimit,
  toAuditEventRow,
} from "../events-filter.js"

/** Any Drizzle SQLite database or transaction (D1, better-sqlite3, libsql). */
export type D1AuditEventsQueryDb = {
  select: () => any
}

/** `datetime('now')` format, UTC: `YYYY-MM-DD HH:MM:SS`. */
function toSqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}

function fromSqliteTimestamp(value: unknown): Date {
  const text = String(value)
  if (text.includes("T")) {
    return new Date(text)
  }

  return new Date(`${text.replace(" ", "T")}Z`)
}

/**
 * Lists custom events newest first (`ORDER BY id DESC`), with `data` parsed
 * from JSON. Pass the last row's `id` as `cursor` to get the next page.
 * `after` / `before` compare at second precision, as `datetime('now')` stores.
 */
export async function listD1AuditEvents(
  db: D1AuditEventsQueryDb,
  eventsTable: SQLiteTable,
  filter: AuditEventFilter = {},
): Promise<AuditEventRow[]> {
  const columns = getTableColumns(eventsTable)
  const { base, context } = auditEventColumns(columns)
  const rows: Record<string, unknown>[] = await db
    .select()
    .from(eventsTable)
    .where(buildAuditEventsWhere(columns, context, filter, toSqliteTimestamp))
    .orderBy(desc(base.id!))
    .limit(resolveLimit(filter.limit))
    .all()

  return rows.map((row) =>
    toAuditEventRow(row, context, {
      data: (value) => JSON.parse(value as string),
      createdAt: fromSqliteTimestamp,
    }),
  )
}
