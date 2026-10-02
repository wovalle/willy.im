import { sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

import type { AuditContextColumn } from "./types.js"

export type D1AuditLogTableOptions<C extends string = string> = {
  /** Extra context columns to include in the table definition, matching the install. */
  contextColumns?: readonly (AuditContextColumn & { column: C })[]
}

function resolveColumns(options?: D1AuditLogTableOptions): AuditContextColumn[] {
  const columns: AuditContextColumn[] = []
  const seen = new Set<string>()

  for (const entry of options?.contextColumns ?? []) {
    const column = entry.column?.trim()
    if (column && !seen.has(column)) {
      seen.add(column)
      columns.push({ ...entry, column })
    }
  }

  return columns
}

const textColumn = (name: string) => text(name)

/** The audit table. Context columns are typed by name: `table.workspace_id`. */
export function d1AuditLogTable<const C extends string = never>(options?: D1AuditLogTableOptions<C>) {
  const contextColumns = resolveColumns(options)
  const contextDefs = Object.fromEntries(
    contextColumns.map(({ column }) => [column, text(column)]),
  ) as { [K in C]: ReturnType<typeof textColumn> }
  const columns = {
    id: integer("id").primaryKey({ autoIncrement: true }),
    table_name: text("table_name").notNull(),
    operation: text("operation").notNull(),
    row_id: text("row_id"),
    user_id: text("user_id"),
    ...contextDefs,
    old_data: text("old_data"),
    new_data: text("new_data"),
    // An SQL default, as the install SQL has it: a string here would make
    // drizzle-kit emit the literal text '(datetime(''now''))' as the default.
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  }
  return sqliteTable(
    "audit_logs",
    columns,
    (table) => [
      index("audit_logs_table_name_idx").on(table.table_name),
      index("audit_logs_row_id_idx").on(table.row_id),
      index("audit_logs_user_id_idx").on(table.user_id),
      // Same indexes the install SQL creates: one per context column unless `index: false`.
      ...contextColumns
        .filter((c) => c.index !== false)
        .map(({ column }) =>
          index(`audit_logs_${column}_idx`).on((table as Record<string, any>)[column]),
        ),
      index("audit_logs_created_at_idx").on(table.created_at),
    ],
  )
}

export function d1AuditContextTable(options?: { contextTable?: string }) {
  const tableName = options?.contextTable ?? "_audit_context"
  return sqliteTable(tableName, {
    key: text("key").primaryKey(),
    value: text("value"),
  })
}
