import { sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

import type { AuditContextColumn } from "./types.js"

export type D1AuditEventsTableOptions<C extends string = string> = {
  /** Table name, matching the install's `eventsTable`. Default `audit_events`. */
  name?: string
  /** Extra context columns to include in the table definition, matching the install. */
  contextColumns?: readonly (AuditContextColumn & { column: C })[]
}

function resolveColumns(options?: D1AuditEventsTableOptions): AuditContextColumn[] {
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

/** The custom events table (`audit_events`). Context columns are typed by name: `table.workspace_id`. */
export function d1AuditEventsTable<const C extends string = never>(options?: D1AuditEventsTableOptions<C>) {
  const name = options?.name ?? "audit_events"
  const contextColumns = resolveColumns(options)
  const contextDefs = Object.fromEntries(
    contextColumns.map(({ column }) => [column, text(column)]),
  ) as { [K in C]: ReturnType<typeof textColumn> }
  const columns = {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    subject_type: text("subject_type"),
    subject_id: text("subject_id"),
    user_id: text("user_id"),
    ...contextDefs,
    data: text("data"),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  }
  return sqliteTable(
    name,
    columns,
    (table) => [
      index(`${name}_name_idx`).on(table.name),
      index(`${name}_subject_idx`).on(table.subject_type, table.subject_id),
      index(`${name}_user_id_idx`).on(table.user_id),
      ...contextColumns
        .filter((c) => c.index !== false)
        .map(({ column }) =>
          index(`${name}_${column}_idx`).on((table as Record<string, any>)[column]),
        ),
      index(`${name}_created_at_idx`).on(table.created_at),
    ],
  )
}
