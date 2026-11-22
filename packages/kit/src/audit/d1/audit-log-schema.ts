import { sql, type HasDefault, type IsPrimaryKey, type NotNull } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
  type SQLiteIntegerBuilder,
  type SQLiteTextBuilder,
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

type Text = SQLiteTextBuilder<[string, ...string[]]>

/**
 * The audit table's columns, as drizzle builders, plus one text column per context column.
 *
 * The factory's return type is spelled from these builders so the emitted declarations
 * name drizzle types instead of inlining the column configs one drizzle version computed:
 * the consumer's drizzle builds the table type, whatever version it is.
 */
export type D1AuditLogColumns<C extends string = never> = {
  id: IsPrimaryKey<HasDefault<NotNull<SQLiteIntegerBuilder>>>
  table_name: NotNull<Text>
  operation: NotNull<Text>
  row_id: Text
  user_id: Text
  old_data: Text
  new_data: Text
  created_at: HasDefault<NotNull<Text>>
} & { [K in C]: Text }

export type D1AuditLogTable<C extends string = never> = ReturnType<
  typeof sqliteTable<"audit_logs", D1AuditLogColumns<C>>
>

export type D1AuditContextColumns = {
  key: IsPrimaryKey<NotNull<Text>>
  value: Text
}

export type D1AuditContextTable = ReturnType<typeof sqliteTable<string, D1AuditContextColumns>>

/** The audit table. Context columns are typed by name: `table.workspace_id`. */
export function d1AuditLogTable<const C extends string = never>(
  options?: D1AuditLogTableOptions<C>,
): D1AuditLogTable<C> {
  const contextColumns = resolveColumns(options)
  const contextDefs = Object.fromEntries(
    contextColumns.map(({ column }) => [column, text(column)]),
  ) as { [K in C]: Text }
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

export function d1AuditContextTable(options?: { contextTable?: string }): D1AuditContextTable {
  const tableName = options?.contextTable ?? "_audit_context"
  return sqliteTable(tableName, {
    key: text("key").primaryKey(),
    value: text("value"),
  })
}
