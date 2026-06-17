# drizzle-audit

Automatic audit logging for [Drizzle ORM](https://orm.drizzle.team). Supports Postgres (triggers) and D1/SQLite (triggers or app-level wrapper).

## Install

```bash
npm install @willyim/drizzle-audit
```

Peer dependencies: `drizzle-orm`. Optional: `drizzle-kit` (for CLI), `tsx` (for TS config files).

## Quick Start

### Postgres (triggers)

```ts
import {
  pgAuditLogTable,
  createAuditInstallSql,
  createAttachAuditTriggersSql,
  withAuditedTransaction,
} from "@willyim/drizzle-audit/postgres"

// 1. Add to your Drizzle schema
export const auditLogs = pgAuditLogTable()

// 2. Generate migration SQL
const migrationSql = [
  createAuditInstallSql(),
  createAttachAuditTriggersSql([
    { table: "users" },
    { table: "invoices", rowIdColumn: "invoice_id" },
  ]),
].join("\n\n")

// 3. Use in your app
await withAuditedTransaction(db, currentUser.id, async (tx) => {
  await tx.insert(users).values({ id: "u1", name: "Ada" })
  await tx.update(users).set({ name: "Ada Lovelace" }).where(eq(users.id, "u1"))
})
```

Postgres triggers capture full row snapshots (`old_data`/`new_data` as JSONB) automatically.

### D1/SQLite — App-Level Wrapper

For D1 and SQLite, the `withAudit` wrapper is the simplest approach. No triggers, no context tables — it intercepts operations in your JS code where you already have the user session.

```ts
import { d1AuditLogTable } from "@willyim/drizzle-audit/d1"
import { withAudit } from "@willyim/drizzle-audit/d1-runtime"

// 1. Add to your schema
export const auditLogs = d1AuditLogTable()

// 2. Create the audit_logs table (in a migration or setup script)
// CREATE TABLE audit_logs (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   table_name TEXT NOT NULL,
//   operation TEXT NOT NULL,
//   row_id TEXT,
//   user_id TEXT,
//   old_data TEXT,
//   new_data TEXT,
//   created_at TEXT NOT NULL DEFAULT (datetime('now'))
// );

// 3. Use in your app (e.g. React Router action)
const audit = withAudit(db, auditLogs, { userId: session.userId })

await audit.insert(users, { id: "u1", name: "Ada" })
await audit.update(users, eq(users.id, "u1"), { name: "Ada Lovelace" })
await audit.delete(users, eq(users.id, "u1"))

// Non-audited access is still available
audit.db.select().from(users).all()
```

The wrapper auto-detects primary keys from your Drizzle table schema and captures old/new row data. All methods return Promises and must be awaited.

> **Note:** Each operation runs the data write and audit log insert as sequential statements with no transaction wrapper. This is required for D1 compatibility (D1 does not support `BEGIN`/`COMMIT` over the prepared-statement API). In the unlikely event of a failure between the two writes, one may succeed without the other. If you need atomic auditing, use the trigger-based approach instead (see below).

### D1/SQLite — Triggers

If you prefer trigger-based auditing on SQLite (works with D1, better-sqlite3, libsql):

```ts
import {
  createD1AuditInstallSql,
  createAttachD1AuditTriggersSql,
  d1AuditLogTable,
  d1AuditContextTable,
  withD1AuditedTransaction,
} from "@willyim/drizzle-audit/d1"

// 1. Add to schema
export const auditLogs = d1AuditLogTable()
export const auditContext = d1AuditContextTable()

// 2. Install (creates audit_logs + _audit_context tables + triggers)
sqlite.exec(createD1AuditInstallSql())
sqlite.exec(createAttachD1AuditTriggersSql([
  { table: "users" },
]))

// 3. Use — context is passed via _audit_context table within a transaction
withD1AuditedTransaction(db, "user_123", (tx) => {
  tx.insert(users).values({ id: "u1", name: "Ada" }).run()
})
```

Since SQLite has no session variables, context (user_id) is stored in a `_audit_context` table that triggers read from within the transaction.

For full row snapshots, use the column-aware variant (SQLite can't enumerate columns dynamically):

```ts
sqlite.exec(createAttachD1AuditTriggersSqlWithColumns([
  { table: "users", columns: ["id", "name", "email"] },
]))
```

## Context Columns

Beyond `user_id`, you can declare arbitrary extra context columns (e.g.
`workspace_id`, `tenant_id`, `request_id`). Each is an extra `TEXT` column on
`audit_logs`, populated at write-time from a named runtime context value (a
Postgres session GUC, or a `_audit_context` KV row in D1).

```ts
type AuditContextColumn = {
  column: string      // audit table column (TEXT, nullable)
  sessionKey?: string // Postgres GUC the trigger reads — default `app.${column}`
                      // D1: the _audit_context key — default `${column}`
  index?: boolean     // create an index on the column — default true
}
```

### Postgres

```ts
const contextColumns = [{ column: "workspace_id" }, { column: "tenant_id" }]

createAuditInstallSql({ contextColumns })
export const auditLogs = pgAuditLogTable({ contextColumns })

// Pass context at runtime (GUC name → value)
await withAuditedTransaction(
  db, userId, async (tx) => { /* ... */ },
  "app.user_id",
  { context: { "app.workspace_id": "ws_1", "app.tenant_id": "t_1" } },
)
```

To add context columns to an existing install, use
`createAuditAddContextColumnsSql({ contextColumns })` — it adds each column and
regenerates the trigger over the full set. Pass the complete list of columns the
table should have.

### D1 Runtime

```ts
const audit = withAudit(db, auditLogs, {
  userId: "user_1",
  context: { workspace_id: "ws_1", tenant_id: "t_1" },
})
```

### D1 Triggers

```ts
const contextColumns = [{ column: "workspace_id" }, { column: "tenant_id" }]

createD1AuditInstallSql({ contextColumns })
createAttachD1AuditTriggersSql([{ table: "users" }], { contextColumns })

withD1AuditedTransaction(db, "user_1", (tx) => { /* ... */ }, {
  context: { workspace_id: "ws_1", tenant_id: "t_1" },
})
```

## CLI

Generate a Drizzle migration with audit SQL appended:

```bash
npx drizzle-audit generate \
  --config app/db/audit.ts \
  --drizzle-config drizzle.config.ts \
  --migrations-dir drizzle
```

Your config file exports a `createAuditSql()` function:

```ts
// app/db/audit.ts
import { createAuditInstallSql, createAttachAuditTriggersSql } from "@willyim/drizzle-audit/postgres"

export function createAuditSql() {
  return [
    createAuditInstallSql(),
    createAttachAuditTriggersSql([
      { table: "users" },
      { table: "workspaces" },
    ]),
  ].join("\n\n")
}
```

## API Reference

### `@willyim/drizzle-audit/postgres`

| Export | Description |
|---|---|
| `pgAuditLogTable(options?)` | Drizzle table definition for `audit_logs` |
| `createAuditInstallSql(options?)` | SQL to create the audit table, indexes, and trigger function |
| `createAttachAuditTriggerSql(target, options?)` | SQL to attach audit trigger to one table |
| `createAttachAuditTriggersSql(targets, options?)` | Same, for multiple tables |
| `createAuditAddContextColumnsSql(options)` | SQL to add context columns + regenerate trigger on existing install |
| `setAuditContext(db, actorId, contextKey?, options?)` | Set actor context in current transaction |
| `withAuditedTransaction(db, actorId, callback, contextKey?, options?)` | Transaction wrapper with actor context |

### `@willyim/drizzle-audit`

| Export | Description |
|---|---|
| `computeDiff(operation, oldData, newData, options?)` | Compute field-by-field diff from old/new row data |

### `@willyim/drizzle-audit/d1`

| Export | Description |
|---|---|
| `d1AuditLogTable(options?)` | Drizzle SQLite table definition for `audit_logs` |
| `d1AuditContextTable(options?)` | Drizzle SQLite table definition for `_audit_context` |
| `createD1AuditInstallSql(options?)` | SQL to create audit + context tables and indexes |
| `createAttachD1AuditTriggerSql(target, options?)` | SQL for audit triggers (one table) |
| `createAttachD1AuditTriggersSql(targets, options?)` | Same, for multiple tables |
| `createAttachD1AuditTriggerSqlWithColumns(target, options?)` | Column-aware triggers with full row snapshots |
| `createAttachD1AuditTriggersSqlWithColumns(targets, options?)` | Same, for multiple tables |
| `setD1AuditContext(db, actorId, options?)` | Set actor in `_audit_context` table |
| `clearD1AuditContext(db, options?)` | Clear actor from `_audit_context` table |
| `withD1AuditedTransaction(db, actorId, callback, options?)` | Transaction wrapper with context management |

### `@willyim/drizzle-audit/d1-runtime`

| Export | Description |
|---|---|
| `withAudit(db, auditTable, context)` | App-level audit wrapper (no triggers needed) |

`withAudit` returns an object with:
- `.insert(table, data)` — Insert + audit log
- `.update(table, where, data)` — Fetch old rows, update, audit log (per row)
- `.delete(table, where)` — Fetch old rows, delete, audit log (per row)
- `.db` — Raw Drizzle instance for non-audited operations

## Computing Diffs

The `computeDiff` utility produces field-by-field diffs from the `old_data`/`new_data` captured by audit triggers. It works with any operation type and requires no Drizzle dependency.

```ts
import { computeDiff } from "@willyim/drizzle-audit"

const result = computeDiff(
  "UPDATE",
  { id: "u1", name: "Ada", email: "ada@example.com" },
  { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
)
// {
//   operation: "UPDATE",
//   changes: [{ field: "name", old: "Ada", new: "Ada Lovelace" }]
// }
```

For INSERT operations, pass `null` as `oldData` — all fields appear as additions. For DELETE, pass `null` as `newData` — all fields appear as removals.

```ts
// INSERT — every field is new
computeDiff("INSERT", null, { id: "u1", name: "Ada" })

// DELETE — every field is removed
computeDiff("DELETE", { id: "u1", name: "Ada" }, null)
```

By default, `updated_at` and `created_at` fields are excluded. Override with `ignoreFields`:

```ts
computeDiff("UPDATE", oldData, newData, { ignoreFields: [] }) // include all fields
computeDiff("UPDATE", oldData, newData, { ignoreFields: ["internal_note"] })
```

Nested objects are compared using deep equality. Fields are returned sorted alphabetically.

## Audit Log Schema

### Postgres

```sql
CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation  TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id     TEXT,
  user_id    TEXT,
  old_data   JSONB,
  new_data   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### D1/SQLite

```sql
CREATE TABLE audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation  TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id     TEXT,
  user_id    TEXT,
  old_data   TEXT,  -- JSON string
  new_data   TEXT,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Which Approach Should I Use?

| | Postgres Triggers | D1 Runtime (`withAudit`) | D1 Triggers |
|---|---|---|---|
| **Setup** | Migration SQL | Create table only | Migration SQL + context table |
| **Row snapshots** | Automatic (full JSONB) | Automatic (full JSON) | Requires listing columns |
| **User context** | Native session vars | Available in JS | `_audit_context` table |
| **Bypass risk** | Low (DB-level) | Medium (must use wrapper) | Low (DB-level) |
| **Best for** | Postgres apps | D1/Cloudflare Workers | SQLite apps needing DB-level guarantees |

## Migrating from 0.2.x → 0.3.0

The `workspace_id`-specific options were removed in favor of the generic
[Context Columns](#context-columns) API. Mechanical replacements:

| Removed | Replacement |
|---|---|
| `pgAuditLogTable({ workspaceIdColumn: "workspace_id" })` | `pgAuditLogTable({ contextColumns: [{ column: "workspace_id" }] })` |
| `d1AuditLogTable({ workspaceIdColumn: "workspace_id" })` | `d1AuditLogTable({ contextColumns: [{ column: "workspace_id" }] })` |
| `createAuditInstallSql({ workspaceIdColumn: "workspace_id" })` | `createAuditInstallSql({ contextColumns: [{ column: "workspace_id" }] })` |
| `createD1AuditInstallSql({ workspaceIdColumn })` | `createD1AuditInstallSql({ contextColumns: [{ column }] })` |
| `createAttachD1AuditTriggersSql(targets, { workspaceIdColumn })` | `createAttachD1AuditTriggersSql(targets, { contextColumns: [{ column }] })` |
| `createAuditAddWorkspaceColumnSql(options)` | `createAuditAddContextColumnsSql({ contextColumns: [...] })` |
| Postgres runtime `{ workspaceId: v }` | `{ context: { "app.workspace_id": v } }` |
| Postgres runtime `{ workspaceId: v, workspaceContextKey: "app.tenant_id" }` | `{ context: { "app.tenant_id": v } }` |
| D1 runtime `{ workspaceId: v }` | `{ context: { workspace_id: v } }` |
| `withAudit(db, table, { userId, workspaceId: v })` | `withAudit(db, table, { userId, context: { workspace_id: v } })` |

The on-disk column name (`workspace_id`) is unchanged, so no data migration is
needed — only call sites change.

## License

MIT
