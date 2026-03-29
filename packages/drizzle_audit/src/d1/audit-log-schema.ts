import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

export type D1AuditLogTableOptions = {
  /** When set (e.g. "workspace_id"), the table definition includes this optional column. */
  workspaceIdColumn?: string
}

export function d1AuditLogTable(options?: D1AuditLogTableOptions) {
  const workspaceIdColumn = options?.workspaceIdColumn?.trim()
  const columns = {
    id: integer("id").primaryKey({ autoIncrement: true }),
    table_name: text("table_name").notNull(),
    operation: text("operation").notNull(),
    row_id: text("row_id"),
    user_id: text("user_id"),
    ...(workspaceIdColumn
      ? { [workspaceIdColumn]: text(workspaceIdColumn) }
      : {}),
    old_data: text("old_data"),
    new_data: text("new_data"),
    created_at: text("created_at").notNull().default("(datetime('now'))"),
  }
  return sqliteTable(
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

export function d1AuditContextTable(options?: { contextTable?: string }) {
  const tableName = options?.contextTable ?? "_audit_context"
  return sqliteTable(tableName, {
    key: text("key").primaryKey(),
    value: text("value"),
  })
}
