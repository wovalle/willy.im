import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import type { AuditContextColumn } from "./types.js"

export type PgAuditLogTableOptions = {
  /** Extra context columns to include in the table definition, matching the install. */
  contextColumns?: AuditContextColumn[]
}

function resolveColumns(options?: PgAuditLogTableOptions): string[] {
  const columns: string[] = []
  const seen = new Set<string>()

  for (const entry of options?.contextColumns ?? []) {
    const column = entry.column?.trim()
    if (column && !seen.has(column)) {
      seen.add(column)
      columns.push(column)
    }
  }

  return columns
}

export function pgAuditLogTable(options?: PgAuditLogTableOptions) {
  const contextColumns = resolveColumns(options)
  const columns = {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    table_name: text("table_name").notNull(),
    operation: text("operation").notNull(),
    row_id: text("row_id"),
    user_id: text("user_id"),
    ...Object.fromEntries(contextColumns.map((c) => [c, text(c)])),
    old_data: jsonb("old_data"),
    new_data: jsonb("new_data"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
  return pgTable(
    "audit_logs",
    columns,
    (table) => [
      index("audit_logs_table_name_idx").on(table.table_name),
      index("audit_logs_row_id_idx").on(table.row_id),
      index("audit_logs_user_id_idx").on(table.user_id),
      index("audit_logs_created_at_idx").on(table.created_at),
    ],
  )
}
