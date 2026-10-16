import {
  assertNonEmpty,
  DEFAULT_AUDIT_SCHEMA,
  DEFAULT_EVENTS_TABLE,
  normalizeContextColumns,
  qualifyName,
  quoteIdent,
} from "./sql-helpers.js"
import type { AuditInstallOptions } from "./types.js"

export type AuditEventsInstallOptions = Pick<AuditInstallOptions, "auditSchema" | "contextColumns"> & {
  /** Name of the custom events table. Default `audit_events`. */
  eventsTable?: string
}

/**
 * Generates SQL to install the audit_events table for custom events. Separate
 * from `createAuditInstallSql`: add both to your audit migration.
 */
export function createAuditEventsInstallSql(options: AuditEventsInstallOptions = {}) {
  const auditSchema = assertNonEmpty(
    options.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const eventsTable = assertNonEmpty(
    options.eventsTable ?? DEFAULT_EVENTS_TABLE,
    "eventsTable",
  )
  const contextColumns = normalizeContextColumns(options)

  const qualifiedEventsTable = qualifyName(eventsTable, auditSchema)

  const tableColumns = [
    "id BIGSERIAL PRIMARY KEY",
    "name TEXT NOT NULL",
    "subject_type TEXT",
    "subject_id TEXT",
    "user_id TEXT",
    ...contextColumns.map((col) => quoteIdent(col.column) + " TEXT"),
    "data JSONB",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  ]

  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_name_idx`)} ON ${qualifiedEventsTable} (name);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_subject_idx`)} ON ${qualifiedEventsTable} (subject_type, subject_id);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_user_id_idx`)} ON ${qualifiedEventsTable} (user_id);`,
    ...contextColumns
      .filter((col) => col.index)
      .map(
        (col) =>
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_${col.column}_idx`)} ON ${qualifiedEventsTable} (${quoteIdent(col.column)});`,
      ),
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${eventsTable}_created_at_idx`)} ON ${qualifiedEventsTable} (created_at DESC);`,
  ]

  return [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(auditSchema)};`,
    `
CREATE TABLE IF NOT EXISTS ${qualifiedEventsTable} (
  ${tableColumns.join(",\n  ")}
);`.trim(),
    ...indexStatements,
  ].join("\n\n")
}
