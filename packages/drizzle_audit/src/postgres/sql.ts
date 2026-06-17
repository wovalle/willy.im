import type {
  AuditContextColumn,
  AuditInstallOptions,
  AuditTriggerTarget,
} from "./types.js"

const DEFAULT_AUDIT_SCHEMA = "public"
const DEFAULT_AUDIT_TABLE = "audit_logs"
const DEFAULT_CONTEXT_KEY = "app.user_id"
const DEFAULT_TRIGGER_FUNCTION = "drizzle_audit_trigger"
const DEFAULT_ROW_ID_COLUMN = "id"

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function qualifyName(name: string, schema?: string) {
  if (!schema) {
    return quoteIdent(name)
  }

  return `${quoteIdent(schema)}.${quoteIdent(name)}`
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
 * Normalizes the context columns from the install options, folding the
 * deprecated `workspaceIdColumn` alias into the generic `contextColumns` list
 * and de-duplicating by column name.
 */
function normalizeContextColumns(
  options: { contextColumns?: AuditContextColumn[]; workspaceIdColumn?: string },
): ResolvedContextColumn[] {
  const raw: AuditContextColumn[] = [...(options.contextColumns ?? [])]

  const workspaceIdColumn = options.workspaceIdColumn?.trim()
  if (workspaceIdColumn) {
    raw.push({ column: workspaceIdColumn })
  }

  const resolved: ResolvedContextColumn[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
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
      sessionKey: entry.sessionKey?.trim() || `app.${column}`,
      index: entry.index ?? true,
    })
  }

  return resolved
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

  const qualifiedTable = qualifyName(table, schema)
  const qualifiedTriggerFunction = qualifyName(triggerFunctionName, auditSchema)

  return `
DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${qualifiedTable};

CREATE TRIGGER ${quoteIdent(triggerName)}
AFTER INSERT OR UPDATE OR DELETE
ON ${qualifiedTable}
FOR EACH ROW
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

/**
 * @deprecated Use `createAuditAddContextColumnsSql({ contextColumns: [...] })` instead.
 * Thin backward-compat wrapper that adds a single workspace column.
 */
export function createAuditAddWorkspaceColumnSql(
  options: AuditInstallOptions & { workspaceIdColumn: string },
) {
  assertNonEmpty(options.workspaceIdColumn.trim(), "workspaceIdColumn")
  return createAuditAddContextColumnsSql(options)
}
