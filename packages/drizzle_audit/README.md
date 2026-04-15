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

### D1/SQLite — App-Level Wrapper (recommended)

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

audit.insert(users, { id: "u1", name: "Ada" })
audit.update(users, eq(users.id, "u1"), { name: "Ada Lovelace" })
audit.delete(users, eq(users.id, "u1"))

// Non-audited access is still available
audit.db.select().from(users).all()
```

The wrapper auto-detects primary keys from your Drizzle table schema, captures old/new row data, and runs each operation + audit log insert in a transaction.

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

## Workspace / Tenant Scoping

All three approaches support an optional workspace column for multi-tenant apps.

### Postgres

```ts
// Install with workspace column
createAuditInstallSql({ workspaceIdColumn: "workspace_id" })
export const auditLogs = pgAuditLogTable({ workspaceIdColumn: "workspace_id" })

// Pass workspace at runtime
await withAuditedTransaction(
  db, userId, async (tx) => { /* ... */ },
  "app.user_id",
  { workspaceId: "ws_1" },
)
```

To add workspace to an existing install, use `createAuditAddWorkspaceColumnSql()`.

### D1 Runtime

```ts
const audit = withAudit(db, auditLogs, {
  userId: "user_1",
  workspaceId: "ws_1",
})
```

### D1 Triggers

```ts
createD1AuditInstallSql({ workspaceIdColumn: "workspace_id" })
createAttachD1AuditTriggersSql(
  [{ table: "users" }],
  { workspaceIdColumn: "workspace_id" },
)

withD1AuditedTransaction(db, "user_1", (tx) => { /* ... */ }, {
  workspaceId: "ws_1",
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
| `createAuditAddWorkspaceColumnSql(options)` | SQL to add workspace column to existing install |
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

## License

MIT
