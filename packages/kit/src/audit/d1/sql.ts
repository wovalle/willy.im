import type {
  AuditContextColumn,
  D1AuditInstallOptions,
  D1AuditTriggerTarget,
} from "./types.js"

const DEFAULT_AUDIT_TABLE = "audit_logs"
const DEFAULT_CONTEXT_TABLE = "_audit_context"
const DEFAULT_ROW_ID_COLUMN = "id"

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function assertNonEmpty(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  return value
}

type ResolvedContextColumn = {
  column: string
  sessionKey: string
  index: boolean
}

/**
 * Normalizes the context columns from the install options, de-duplicating by
 * column name. For D1 the KV key defaults to the column name itself.
 */
function normalizeContextColumns(
  options: { contextColumns?: AuditContextColumn[] },
): ResolvedContextColumn[] {
  const resolved: ResolvedContextColumn[] = []
  const seen = new Set<string>()
  for (const entry of options.contextColumns ?? []) {
    const column = entry.column?.trim()
    if (!column) {
      throw new Error("contextColumns[].column must not be empty")
    }
    if (seen.has(column)) {
      continue
    }
    seen.add(column)
    resolved.push({
      column,
      sessionKey: entry.sessionKey?.trim() || column,
      index: entry.index ?? true,
    })
  }

  return resolved
}

/** Builds the column-name suffix for an INSERT column list. */
function contextColsClause(contextColumns: ResolvedContextColumn[]): string {
  return contextColumns.map((c) => `, ${quoteIdent(c.column)}`).join("")
}

/** Builds the matching VALUES suffix that reads each KV row from the context table. */
function contextValuesClause(
  contextColumns: ResolvedContextColumn[],
  contextTable: string,
): string {
  return contextColumns
    .map(
      (c) =>
        `,\n    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = ${quoteLiteral(c.sessionKey)})`,
    )
    .join("")
}

type UpdateFilter = {
  mode: "ignore" | "only"
  columns: string[]
}

function normalizeColumnList(columns: string[], label: string): string[] {
  if (columns.length === 0) {
    throw new Error(`${label} must contain at least one column name`)
  }
  const resolved: string[] = []
  for (const entry of columns) {
    const column = entry.trim()
    if (!column) {
      throw new Error(`${label}[] must not be empty`)
    }
    if (resolved.includes(column)) {
      continue
    }
    resolved.push(column)
  }

  return resolved
}

/** Validates a target's `ignoreColumns` / `onlyColumns`, returning the UPDATE filter if one is set. */
function resolveUpdateFilter(target: D1AuditTriggerTarget): UpdateFilter | null {
  if (target.ignoreColumns && target.onlyColumns) {
    throw new Error("ignoreColumns and onlyColumns are mutually exclusive")
  }
  if (target.ignoreColumns) {
    return { mode: "ignore", columns: normalizeColumnList(target.ignoreColumns, "ignoreColumns") }
  }
  if (target.onlyColumns) {
    return { mode: "only", columns: normalizeColumnList(target.onlyColumns, "onlyColumns") }
  }

  return null
}

/** `WHEN` clause that fires when any of `columns` changed. `IS NOT` is null-safe. */
function buildChangedWhenSql(columns: string[]): string {
  return `\nWHEN (${columns.map((c) => `OLD.${quoteIdent(c)} IS NOT NEW.${quoteIdent(c)}`).join(" OR ")})`
}

/**
 * Builds the UPDATE trigger's `WHEN` clause from the target's filter. SQLite
 * can't enumerate a row's columns, so `ignoreColumns` is resolved against the
 * column list and only works on the `WithColumns` variant.
 */
function buildUpdateWhenSql(target: D1AuditTriggerTarget, columns?: string[]): string {
  const filter = resolveUpdateFilter(target)
  if (!filter) {
    return ""
  }
  if (filter.mode === "only") {
    return buildChangedWhenSql(filter.columns)
  }
  if (!columns) {
    throw new Error(
      "ignoreColumns needs the table's column list: use createAttachD1AuditTriggerSqlWithColumns",
    )
  }
  const unknown = filter.columns.filter((c) => !columns.includes(c))
  if (unknown.length > 0) {
    throw new Error(`ignoreColumns names columns not in columns: ${unknown.join(", ")}`)
  }
  const watched = columns.filter((c) => !filter.columns.includes(c))
  if (watched.length === 0) {
    throw new Error("ignoreColumns must leave at least one column to watch")
  }

  return buildChangedWhenSql(watched)
}

/**
 * Generates SQL to install the audit_logs table and _audit_context table.
 *
 * The _audit_context table stores user_id (and any configured context columns)
 * for the current transaction. Since D1/SQLite has no session variables, triggers
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
  const contextColumns = normalizeContextColumns(options)

  const auditColumns = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "table_name TEXT NOT NULL",
    "operation TEXT NOT NULL",
    "row_id TEXT",
    "user_id TEXT",
    ...contextColumns.map((c) => `${quoteIdent(c.column)} TEXT`),
    "old_data TEXT",
    "new_data TEXT",
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ]

  const contextTableColumns = [
    "key TEXT PRIMARY KEY",
    "value TEXT",
  ]

  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_table_name_idx`)} ON ${quoteIdent(auditTable)} (table_name);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_row_id_idx`)} ON ${quoteIdent(auditTable)} (row_id);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_user_id_idx`)} ON ${quoteIdent(auditTable)} (user_id);`,
    ...contextColumns
      .filter((c) => c.index)
      .map(
        (c) =>
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_${c.column}_idx`)} ON ${quoteIdent(auditTable)} (${quoteIdent(c.column)});`,
      ),
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_created_at_idx`)} ON ${quoteIdent(auditTable)} (created_at);`,
  ]

  return [
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(auditTable)} (\n  ${auditColumns.join(",\n  ")}\n);`,
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(contextTable)} (\n  ${contextTableColumns.join(",\n  ")}\n);`,
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
  const contextColumns = normalizeContextColumns(options)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)})
  VALUES (
    ${quoteLiteral(table)},
    'INSERT',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)}
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
  const contextColumns = normalizeContextColumns(options)
  const when = buildUpdateWhenSql(target)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER UPDATE ON ${quoteIdent(table)}
FOR EACH ROW${when}
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)})
  VALUES (
    ${quoteLiteral(table)},
    'UPDATE',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)}
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
  const contextColumns = normalizeContextColumns(options)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER DELETE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)})
  VALUES (
    ${quoteLiteral(table)},
    'DELETE',
    OLD.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)}
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
  return `json_object(${columns.map((c) => `${quoteLiteral(c)}, ${ref}.${quoteIdent(c)}`).join(", ")})`
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
  const contextColumns = normalizeContextColumns(options)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)}, new_data)
  VALUES (
    ${quoteLiteral(table)},
    'INSERT',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)},
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
  const contextColumns = normalizeContextColumns(options)
  const when = buildUpdateWhenSql(target, target.columns)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER UPDATE ON ${quoteIdent(table)}
FOR EACH ROW${when}
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)}, old_data, new_data)
  VALUES (
    ${quoteLiteral(table)},
    'UPDATE',
    NEW.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)},
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
  const contextColumns = normalizeContextColumns(options)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER DELETE ON ${quoteIdent(table)}
FOR EACH ROW
BEGIN
  INSERT INTO ${quoteIdent(auditTable)} (table_name, operation, row_id, user_id${contextColsClause(contextColumns)}, old_data)
  VALUES (
    ${quoteLiteral(table)},
    'DELETE',
    OLD.${quoteIdent(rowIdColumn)},
    (SELECT value FROM ${quoteIdent(contextTable)} WHERE key = 'user_id')${contextValuesClause(contextColumns, contextTable)},
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
