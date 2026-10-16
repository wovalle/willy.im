import {
  assertNonEmpty,
  DEFAULT_AUDIT_SCHEMA,
  DEFAULT_AUDIT_TABLE,
  DEFAULT_CONTEXT_KEY,
  DEFAULT_ROW_ID_COLUMN,
  DEFAULT_TRIGGER_FUNCTION,
  normalizeContextColumns,
  qualifyName,
  quoteIdent,
  quoteLiteral,
  type ResolvedContextColumn,
} from "./sql-helpers.js"
import type {
  AuditInstallOptions,
  AuditTriggerTarget,
} from "./types.js"

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
function resolveUpdateFilter(target: AuditTriggerTarget): UpdateFilter | null {
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

/**
 * Builds the `WHEN` clause of the UPDATE trigger. The trigger function is shared
 * across tables, so the per-table filter lives on the trigger, not in the function.
 */
function buildUpdateWhenSql(filter: UpdateFilter | null): string {
  if (!filter) {
    return ""
  }
  if (filter.mode === "ignore") {
    const ignored = `ARRAY[${filter.columns.map(quoteLiteral).join(", ")}]::text[]`
    return `\nWHEN ((to_jsonb(OLD) - ${ignored}) IS DISTINCT FROM (to_jsonb(NEW) - ${ignored}))`
  }
  if (filter.columns.length === 1) {
    const column = quoteIdent(filter.columns[0]!)
    return `\nWHEN (OLD.${column} IS DISTINCT FROM NEW.${column})`
  }
  const oldColumns = filter.columns.map((c) => `OLD.${quoteIdent(c)}`).join(", ")
  const newColumns = filter.columns.map((c) => `NEW.${quoteIdent(c)}`).join(", ")

  return `\nWHEN ((${oldColumns}) IS DISTINCT FROM (${newColumns}))`
}

function buildTriggerFunctionSql(
  qualifiedAuditTable: string,
  qualifiedTriggerFunction: string,
  contextLiteral: string,
  contextColumns: ResolvedContextColumn[],
): string {
  const declContext = contextColumns
    .map((_, i) => `\n  audit_ctx_${i} TEXT;`)
    .join("")
  const readContext = contextColumns
    .map(
      (col, i) =>
        `\n  audit_ctx_${i} := NULLIF(current_setting(${quoteLiteral(
          col.sessionKey,
        )}, true), '');`,
    )
    .join("")

  const ctxColIdents = contextColumns.map((col) => quoteIdent(col.column))
  const ctxColPrefix = ctxColIdents.length ? `, ${ctxColIdents.join(", ")}` : ""
  const ctxValExprs = contextColumns.map((_, i) => `audit_ctx_${i}`)
  const ctxValPrefix = ctxValExprs.length ? `, ${ctxValExprs.join(", ")}` : ""

  const insertColsBase = "table_name, operation, row_id, user_id"
  const insertColsInsert = `${insertColsBase}${ctxColPrefix}, new_data`
  const insertColsUpdate = `${insertColsBase}${ctxColPrefix}, old_data, new_data`
  const insertColsDelete = `${insertColsBase}${ctxColPrefix}, old_data`
  const valuesInsert = `TG_TABLE_NAME, TG_OP, current_row_id, audit_user${ctxValPrefix}, to_jsonb(NEW)`
  const valuesUpdate = `TG_TABLE_NAME, TG_OP, current_row_id, audit_user${ctxValPrefix}, to_jsonb(OLD), to_jsonb(NEW)`
  const valuesDelete = `TG_TABLE_NAME, TG_OP, current_row_id, audit_user${ctxValPrefix}, to_jsonb(OLD)`

  return `
CREATE OR REPLACE FUNCTION ${qualifiedTriggerFunction}()
RETURNS TRIGGER AS $$
DECLARE
  audit_user TEXT;${declContext}
  row_id_column TEXT;
  current_row JSONB;
  current_row_id TEXT;
BEGIN
  audit_user := NULLIF(current_setting(${contextLiteral}, true), '');${readContext}

  row_id_column := COALESCE(NULLIF(TG_ARGV[0], ''), ${quoteLiteral(
    DEFAULT_ROW_ID_COLUMN,
  )});

  IF TG_OP = 'DELETE' THEN
    current_row := to_jsonb(OLD);
  ELSE
    current_row := to_jsonb(NEW);
  END IF;

  IF NOT (current_row ? row_id_column) THEN
    RAISE EXCEPTION 'Missing row id column "%" on audited table %.%.',
      row_id_column,
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
  END IF;

  current_row_id := current_row ->> row_id_column;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO ${qualifiedAuditTable} (${insertColsInsert})
    VALUES (${valuesInsert});
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO ${qualifiedAuditTable} (${insertColsUpdate})
    VALUES (${valuesUpdate});
    RETURN NEW;
  END IF;

  INSERT INTO ${qualifiedAuditTable} (${insertColsDelete})
  VALUES (${valuesDelete});
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;`.trim()
}

export function createAuditInstallSql(options: AuditInstallOptions = {}) {
  const auditSchema = assertNonEmpty(
    options.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextKey = assertNonEmpty(
    options.contextKey ?? DEFAULT_CONTEXT_KEY,
    "contextKey",
  )
  const triggerFunctionName = assertNonEmpty(
    options.triggerFunctionName ?? DEFAULT_TRIGGER_FUNCTION,
    "triggerFunctionName",
  )
  const contextColumns = normalizeContextColumns(options)

  const qualifiedAuditTable = qualifyName(auditTable, auditSchema)
  const qualifiedTriggerFunction = qualifyName(triggerFunctionName, auditSchema)
  const contextLiteral = quoteLiteral(contextKey)

  const tableColumns = [
    "id BIGSERIAL PRIMARY KEY",
    "table_name TEXT NOT NULL",
    "operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))",
    "row_id TEXT",
    "user_id TEXT",
    ...contextColumns.map((col) => quoteIdent(col.column) + " TEXT"),
    "old_data JSONB",
    "new_data JSONB",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  ]

  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_table_name_idx`)} ON ${qualifiedAuditTable} (table_name);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_row_id_idx`)} ON ${qualifiedAuditTable} (row_id);`,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_user_id_idx`)} ON ${qualifiedAuditTable} (user_id);`,
    ...contextColumns
      .filter((col) => col.index)
      .map(
        (col) =>
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_${col.column}_idx`)} ON ${qualifiedAuditTable} (${quoteIdent(col.column)});`,
      ),
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_created_at_idx`)} ON ${qualifiedAuditTable} (created_at DESC);`,
  ]

  return [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(auditSchema)};`,
    `
CREATE TABLE IF NOT EXISTS ${qualifiedAuditTable} (
  ${tableColumns.join(",\n  ")}
);`.trim(),
    ...indexStatements,
    buildTriggerFunctionSql(
      qualifiedAuditTable,
      qualifiedTriggerFunction,
      contextLiteral,
      contextColumns,
    ),
  ].join("\n\n")
}

/**
 * Generates SQL to attach the audit triggers to one table: `<triggerName>` for
 * INSERT and DELETE, and `<triggerName>_update` for UPDATE. The UPDATE trigger
 * carries a `WHEN` clause when the target sets `ignoreColumns` or `onlyColumns`.
 */
export function createAttachAuditTriggerSql(
  target: AuditTriggerTarget,
  options: AuditInstallOptions = {},
) {
  const table = assertNonEmpty(target.table, "table")
  const schema = target.schema?.trim() || undefined
  const rowIdColumn = assertNonEmpty(
    target.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN,
    "rowIdColumn",
  )
  const triggerName = assertNonEmpty(
    target.triggerName ?? `${table}_audit`,
    "triggerName",
  )
  const auditSchema = assertNonEmpty(
    options.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const triggerFunctionName = assertNonEmpty(
    options.triggerFunctionName ?? DEFAULT_TRIGGER_FUNCTION,
    "triggerFunctionName",
  )

  const updateWhen = buildUpdateWhenSql(resolveUpdateFilter(target))

  const qualifiedTable = qualifyName(table, schema)
  const qualifiedTriggerFunction = qualifyName(triggerFunctionName, auditSchema)
  const updateTriggerName = `${triggerName}_update`

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${qualifiedTable};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT OR DELETE
ON ${qualifiedTable}
FOR EACH ROW
EXECUTE FUNCTION ${qualifiedTriggerFunction}(${quoteLiteral(rowIdColumn)});

DROP TRIGGER IF EXISTS ${quoteIdent(updateTriggerName)} ON ${qualifiedTable};

CREATE TRIGGER ${quoteIdent(updateTriggerName)}
AFTER UPDATE
ON ${qualifiedTable}
FOR EACH ROW${updateWhen}
EXECUTE FUNCTION ${qualifiedTriggerFunction}(${quoteLiteral(rowIdColumn)});
`.trim()
}

export function createAttachAuditTriggersSql(
  targets: AuditTriggerTarget[],
  options: AuditInstallOptions = {},
) {
  if (targets.length === 0) {
    throw new Error("targets must contain at least one audited table")
  }

  return targets
    .map((target) => createAttachAuditTriggerSql(target, options))
    .join("\n\n")
}

/**
 * Generates SQL to add context columns and regenerate the trigger function on an
 * existing audit_logs table. Use in a new migration when adding context columns
 * after the initial install.
 *
 * Pass the FULL set of context columns the audit table should have (the trigger is
 * a single CREATE OR REPLACE, so it must reference every column). Columns are added
 * with `ADD COLUMN IF NOT EXISTS`, so already-present columns are left untouched.
 * Options must match your install (auditSchema, auditTable, triggerFunctionName,
 * contextKey).
 */
export function createAuditAddContextColumnsSql(options: AuditInstallOptions = {}) {
  const auditSchema = assertNonEmpty(
    options.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const auditTable = assertNonEmpty(
    options.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextKey = assertNonEmpty(
    options.contextKey ?? DEFAULT_CONTEXT_KEY,
    "contextKey",
  )
  const triggerFunctionName = assertNonEmpty(
    options.triggerFunctionName ?? DEFAULT_TRIGGER_FUNCTION,
    "triggerFunctionName",
  )

  const contextColumns = normalizeContextColumns(options)
  if (contextColumns.length === 0) {
    throw new Error("createAuditAddContextColumnsSql requires at least one context column")
  }

  const qualifiedAuditTable = qualifyName(auditTable, auditSchema)
  const qualifiedTriggerFunction = qualifyName(triggerFunctionName, auditSchema)
  const contextLiteral = quoteLiteral(contextKey)

  return [
    ...contextColumns.flatMap((col) => [
      `ALTER TABLE ${qualifiedAuditTable} ADD COLUMN IF NOT EXISTS ${quoteIdent(col.column)} TEXT;`,
      ...(col.index
        ? [
            `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${auditTable}_${col.column}_idx`)} ON ${qualifiedAuditTable} (${quoteIdent(col.column)});`,
          ]
        : []),
    ]),
    buildTriggerFunctionSql(
      qualifiedAuditTable,
      qualifiedTriggerFunction,
      contextLiteral,
      contextColumns,
    ),
  ].join("\n\n")
}
