import type { D1AuditInstallOptions, D1AuditTriggerTarget } from "./types.js"

const DEFAULT_AUDIT_TABLE = "audit_logs"
const DEFAULT_CONTEXT_TABLE = "_audit_context"
const DEFAULT_ROW_ID_COLUMN = "id"

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function assertNonEmpty(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  return value
}

/**
 * Generates SQL to install the audit_logs table and _audit_context table.
 *
 * The _audit_context table stores user_id (and optionally workspace_id) for
 * the current transaction. Since D1/SQLite has no session variables, triggers
 * read context from this table instead.
 */
export function createD1AuditInstallSql(options: D1AuditInstallOptions = {}) {
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  const auditColumns = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "table_name TEXT NOT NULL",
    "operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))",
    "row_id TEXT",
    "user_id TEXT",
    ...(workspaceIdColumn ? [`${quoteIdent(workspaceIdColumn)} TEXT`] : []),
    "old_data TEXT",
    "new_data TEXT",
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ]

  const contextColumns = [
    "key TEXT PRIMARY KEY",
    "value TEXT",
  ]

  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_table_name_idx`)} ON ${quoteIdent(auditTable)} (table_name);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_row_id_idx`)} ON ${quoteIdent(auditTable)} (row_id);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_user_id_idx`)} ON ${quoteIdent(auditTable)} (user_id);`,
    ...(workspaceIdColumn
      ? [
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_${workspaceIdColumn}_idx`)} ON ${quoteIdent(auditTable)} (${quoteIdent(workspaceIdColumn)});`,
        ]
      : []),
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_created_at_idx`)} ON ${quoteIdent(auditTable)} (created_at);`,
  ]

  return [
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(auditTable)} (\n  ${auditColumns.join(",\n  ")}\n);`,
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(contextTable)} (\n  ${contextColumns.join(",\n  ")}\n);`,
    ...indexStatements,
  ].join("\n\n")
}

function buildInsertTriggerSql(
  target: D1AuditTriggerTarget,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_insert`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""})
  VALUES (
    '${table}',
    'INSERT',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""}
  );
END;`.trim()
}

function buildUpdateTriggerSql(
  target: D1AuditTriggerTarget,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_update`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER UPDATE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""})
  VALUES (
    '${table}',
    'UPDATE',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""}
  );
END;`.trim()
}

function buildDeleteTriggerSql(
  target: D1AuditTriggerTarget,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_delete`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER DELETE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""})
  VALUES (
    '${table}',
    'DELETE',
    OLD.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""}
  );
END;`.trim()
}

/**
 * Generates SQL to attach INSERT, UPDATE, and DELETE audit triggers to a single table.
 *
 * Unlike the Postgres variant, D1/SQLite triggers cannot serialize full row data dynamically
 * (no `row_to_json` equivalent). Audit rows capture `table_name`, `operation`, `row_id`,
 * and `user_id`. For full row snapshots, use `createAttachD1AuditTriggerSqlWithColumns`.
 */
export function createAttachD1AuditTriggerSql(
  target: D1AuditTriggerTarget,
  options: D1AuditInstallOptions = {},
) {
  return [
    buildInsertTriggerSql(target, options),
    buildUpdateTriggerSql(target, options),
    buildDeleteTriggerSql(target, options),
  ].join("\n\n")
}

export function createAttachD1AuditTriggersSql(
  targets: D1AuditTriggerTarget[],
  options: D1AuditInstallOptions = {},
) {
  if (targets.length === 0) {
    throw new Error("targets must contain at least one audited table")
  }
  return targets
    .map((target) => createAttachD1AuditTriggerSql(target, options))
    .join("\n\n")
}

// --- Column-aware variant for full row snapshots ---

export type D1AuditTriggerTargetWithColumns = D1AuditTriggerTarget & {
  /** Column names to capture in old_data/new_data JSON snapshots */
  columns: string[]
}

function buildJsonObjectExpr(columns: string[], ref: "NEW" | "OLD"): string {
  return `json_object(${columns.map((c) => `'${c}', ${ref}.${quoteIdent(c)}`).join(", ")})`
}

function buildInsertTriggerWithColumnsSql(
  target: D1AuditTriggerTargetWithColumns,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_insert`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""}, new_data)
  VALUES (
    '${table}',
    'INSERT',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""},
    ${buildJsonObjectExpr(target.columns, "NEW")}
  );
END;`.trim()
}

function buildUpdateTriggerWithColumnsSql(
  target: D1AuditTriggerTargetWithColumns,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_update`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER UPDATE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""}, old_data, new_data)
  VALUES (
    '${table}',
    'UPDATE',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""},
    ${buildJsonObjectExpr(target.columns, "OLD")},
    ${buildJsonObjectExpr(target.columns, "NEW")}
  );
END;`.trim()
}

function buildDeleteTriggerWithColumnsSql(
  target: D1AuditTriggerTargetWithColumns,
  options: D1AuditInstallOptions,
): string {
  const table = assertNonEmpty(target.table, "table")
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextTable = assertNonEmpty(
    options.contextTable ?? DEFAULT_CONTEXT_TABLE,
    "contextTable",
  )
  const triggerPrefix = target.triggerPrefix ?? table
  const triggerName = `${triggerPrefix}_audit_delete`
  const workspaceIdColumn = options.workspaceIdColumn?.trim()

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER DELETE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${workspaceIdColumn ? `, ${quoteIdent(workspaceIdColumn)}` : ""}, old_data)
  VALUES (
    '${table}',
    'DELETE',
    OLD.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${workspaceIdColumn ? `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'workspace_id')` : ""},
    ${buildJsonObjectExpr(target.columns, "OLD")}
  );
END;`.trim()
}

/**
 * Column-aware variant: generates triggers that capture full row snapshots
 * using json_object() with the specified column names.
 *
 * Unlike Postgres, SQLite cannot enumerate columns dynamically in triggers,
 * so you must list the columns to capture.
 *
 * @example
 * createAttachD1AuditTriggerSqlWithColumns(
 *   { table: "users", columns: ["id", "name", "email"] },
 * )
 */
export function createAttachD1AuditTriggerSqlWithColumns(
  target: D1AuditTriggerTargetWithColumns,
  options: D1AuditInstallOptions = {},
) {
  if (target.columns.length === 0) {
    throw new Error("columns must contain at least one column name")
  }
  return [
    buildInsertTriggerWithColumnsSql(target, options),
    buildUpdateTriggerWithColumnsSql(target, options),
    buildDeleteTriggerWithColumnsSql(target, options),
  ].join("\n\n")
}

export function createAttachD1AuditTriggersSqlWithColumns(
  targets: D1AuditTriggerTargetWithColumns[],
  options: D1AuditInstallOptions = {},
) {
  if (targets.length === 0) {
    throw new Error("targets must contain at least one audited table")
  }
  return targets
    .map((target) => createAttachD1AuditTriggerSqlWithColumns(target, options))
    .join("\n\n")
}

