import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  type PgBigSerial53Builder,
  type PgJsonbBuilder,
  type PgTextBuilder,
  type PgTimestampBuilder,
  type SetHasDefault,
  type SetIsPrimaryKey,
  type SetNotNull,
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

/**
 * The audit table's columns, as drizzle builders. Context columns are runtime-only.
 *
 * The factory's return type is spelled from these builders so the emitted declarations
 * name drizzle types instead of inlining the column configs one drizzle version computed:
 * the consumer's drizzle builds the table type, whatever version it is.
 */
export type PgAuditLogColumns = {
  id: SetIsPrimaryKey<PgBigSerial53Builder>
  table_name: SetNotNull<PgTextBuilder>
  operation: SetNotNull<PgTextBuilder>
  row_id: PgTextBuilder
  user_id: PgTextBuilder
  old_data: PgJsonbBuilder
  new_data: PgJsonbBuilder
  created_at: SetNotNull<SetHasDefault<PgTimestampBuilder>>
}

export type PgAuditLogTable = ReturnType<typeof pgTable<"audit_logs", PgAuditLogColumns>>

export function pgAuditLogTable(options?: PgAuditLogTableOptions): PgAuditLogTable {
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
