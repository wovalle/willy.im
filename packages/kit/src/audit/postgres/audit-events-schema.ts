import {
  bigserial,
  index,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import type { AuditContextColumn } from "./types.js"

export type PgAuditEventsTableOptions = {
  /** Table name, matching the install's `eventsTable`. Default `audit_events`. */
  name?: string
  /** Schema, matching the install's `auditSchema`. Default `public`. */
  schema?: string
  /** Extra context columns to include in the table definition, matching the install. */
  contextColumns?: AuditContextColumn[]
}

function resolveColumns(options?: PgAuditEventsTableOptions): AuditContextColumn[] {
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

/** The custom events table (`audit_events`), matching `createAuditEventsInstallSql`. */
export function pgAuditEventsTable(options?: PgAuditEventsTableOptions) {
  const name = options?.name ?? "audit_events"
  const schema = options?.schema && options.schema !== "public" ? options.schema : undefined
  const contextColumns = resolveColumns(options)
  const columns = {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    subject_type: text("subject_type"),
    subject_id: text("subject_id"),
    user_id: text("user_id"),
    ...Object.fromEntries(contextColumns.map(({ column }) => [column, text(column)])),
    data: jsonb("data"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
  const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable
  return table(
    name,
    columns,
    (t) => [
      index(`${name}_name_idx`).on(t.name),
      index(`${name}_subject_idx`).on(t.subject_type, t.subject_id),
      index(`${name}_user_id_idx`).on(t.user_id),
      ...contextColumns
        .filter((c) => c.index !== false)
        .map(({ column }) =>
          index(`${name}_${column}_idx`).on((t as Record<string, any>)[column]),
        ),
      index(`${name}_created_at_idx`).on(t.created_at.desc()),
    ],
  )
}
