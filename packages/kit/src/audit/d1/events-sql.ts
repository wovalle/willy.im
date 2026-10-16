import {
  assertNonEmpty,
  DEFAULT_EVENTS_TABLE,
  normalizeContextColumns,
  quoteIdent,
} from "./sql-helpers.js"
import type { D1AuditInstallOptions } from "./types.js"

export type D1AuditEventsInstallOptions = Pick<D1AuditInstallOptions, "contextColumns"> & {
  /** Name of the custom events table. Default `audit_events`. */
  eventsTable?: string
}

/**
 * Generates SQL to install the audit_events table for custom events. Separate
 * from `createD1AuditInstallSql`: add both to your audit migration.
 */
export function createD1AuditEventsInstallSql(options: D1AuditEventsInstallOptions = {}) {
  const eventsTable = assertNonEmpty(
    options.eventsTable ?? DEFAULT_EVENTS_TABLE,
    "eventsTable",
  )
  const contextColumns = normalizeContextColumns(options)
  const table = quoteIdent(eventsTable)

  const columns = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "name TEXT NOT NULL",
    "subject_type TEXT",
    "subject_id TEXT",
    "user_id TEXT",
    ...contextColumns.map((c) => `${quoteIdent(c.column)} TEXT`),
    "data TEXT",
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ]

  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_name_idx`)} ON ${table} (name);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_subject_idx`)} ON ${table} (subject_type, subject_id);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_user_id_idx`)} ON ${table} (user_id);`,
    ...contextColumns
      .filter((c) => c.index)
      .map(
        (c) =>
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_${c.column}_idx`)} ON ${table} (${quoteIdent(c.column)});`,
      ),
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_created_at_idx`)} ON ${table} (created_at);`,
  ]

  return [
    `CREATE TABLE IF NOT EXISTS ${table} (\n  ${columns.join(",\n  ")}\n);`,
    ...indexStatements,
  ].join("\n\n")
}
