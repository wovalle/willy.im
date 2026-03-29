import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export type PgAuditLogTableOptions = {
  /** When set (e.g. "workspace_id"), the table definition includes this optional column to match the install. */
  workspaceIdColumn?: string
}

export function pgAuditLogTable(options?: PgAuditLogTableOptions) {
  const workspaceIdColumn = options?.workspaceIdColumn?.trim()
  const columns = {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    table_name: text("table_name").notNull(),
    operation: text("operation").notNull(),
    row_id: text("row_id"),
    user_id: text("user_id"),
    ...(workspaceIdColumn
      ? { [workspaceIdColumn]: text(workspaceIdColumn) }
      : {}),
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
