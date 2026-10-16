# `@willyim/kit/audit`: reference

Automatic audit logging for [Drizzle ORM](https://orm.drizzle.team). Supports Postgres (triggers) and D1/SQLite (triggers or app-level wrapper).

## Install

```bash
npm install @willyim/kit drizzle-orm
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
} from "@willyim/kit/audit/postgres"

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
Each audited table gets two triggers sharing one trigger function: `<table>_audit` for INSERT
and DELETE, and `<table>_audit_update` for UPDATE (where [update filters](#update-filters) go).

### D1/SQLite — App-Level Wrapper

For D1 and SQLite, the `withAudit` wrapper is the simplest approach. No triggers, no context tables — it intercepts operations in your JS code where you already have the user session.

```ts
import { d1AuditLogTable } from "@willyim/kit/audit/d1"
import { withAudit } from "@willyim/kit/audit/d1-runtime"

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

// A change made through another library, or an action that writes no row
await audit.record({ table: "user", operation: "impersonate", rowId: "u1" })

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
} from "@willyim/kit/audit/d1"

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

// Pass context at runtime, keyed by COLUMN name. Each value is written to the
// GUC `app.${column}` (matching the trigger's default sessionKey). Override the
// prefix with `contextPrefix`, or set it to "" to pass fully-qualified keys.
await withAuditedTransaction(
  db, userId, async (tx) => { /* ... */ },
  { context: { workspace_id: "ws_1", tenant_id: "t_1" } },
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

## Update Filters

Some columns change constantly and mean nothing (a `last_seen_at` heartbeat, a hit
counter). Set one of two filters per table so those UPDATEs don't flood the log:

```ts
createAttachAuditTriggersSql([
  // Skip UPDATEs that change only these columns
  { table: "sessions", ignoreColumns: ["last_seen_at", "hits"] },
  // Log only UPDATEs that change at least one of these columns
  { table: "invoices", rowIdColumn: "invoice_id", onlyColumns: ["status", "amount"] },
])
```

- The filters are mutually exclusive, and each must name at least one column.
- They only decide **whether** an UPDATE is logged. A logged row still carries the
  full snapshot, ignored columns included.
- INSERT and DELETE are always logged.
- Comparisons are NULL-safe: `NULL` → value counts as a change.

**Postgres.** The filter is a `WHEN` clause on the `<table>_audit_update` trigger
(`ignoreColumns` compares `to_jsonb(OLD) - ignored` against `to_jsonb(NEW) - ignored`;
`onlyColumns` compares the listed columns with `IS DISTINCT FROM`). Before this
version a table had one `<table>_audit` trigger for all three operations;
re-running the attach SQL replaces it with the pair. With the CLI that happens on
its own: the attach SQL changed, so the next `kit-audit generate` ships it.

**D1/SQLite.** The filter is a `WHEN` clause on the `<prefix>_audit_update`
trigger, built from `OLD."col" IS NOT NEW."col"` checks. `onlyColumns` works on
both variants. `ignoreColumns` needs the table's column list (SQLite can't
enumerate a row's columns), so it only works with
`createAttachD1AuditTriggersSqlWithColumns`, and every ignored column must be in
`columns`:

```ts
createAttachD1AuditTriggersSqlWithColumns([
  {
    table: "sessions",
    columns: ["id", "name", "last_seen_at"],
    ignoreColumns: ["last_seen_at"],
  },
])
```

## Custom Events

Triggers record row changes. Some things worth auditing aren't a row change, or
the row change doesn't say why: a member invited, an API key revoked, a login
as someone else. Those are **custom events**, and they get their own table,
`audit_events`, next to `audit_logs`:

- `audit_logs` stays a pure change log (`INSERT` / `UPDATE` / `DELETE` with
  before/after snapshots), so diffs and row history never trip over rows that
  aren't changes.
- An event is a dotted name (`member.invite`), an optional subject (what it's
  about: `{ type: "workspace", id }`), the actor, the same context columns as
  `audit_logs`, and a JSON payload. The payload is whatever the event needs,
  not a before/after pair.
- Every event has a zod schema, so payloads are validated when recorded and
  typed where they're read.

### Install

Install the table alongside the audit log; `createAuditSql()` returns both, so
the CLI ships it like any other audit change:

```ts
// app/db/audit.ts
import {
  createAttachAuditTriggersSql,
  createAuditEventsInstallSql,
  createAuditInstallSql,
} from "@willyim/kit/audit/postgres"

const contextColumns = [{ column: "workspace_id" }]

export function createAuditSql() {
  return [
    createAuditInstallSql({ contextColumns }),
    createAuditEventsInstallSql({ contextColumns }),
    createAttachAuditTriggersSql([{ table: "members" }]),
  ].join("\n\n")
}
```

`createAuditEventsInstallSql({ auditSchema?, eventsTable?, contextColumns? })`
defaults to `public.audit_events`. On D1 use
`createD1AuditEventsInstallSql({ eventsTable?, contextColumns? })`. The Drizzle
tables are `pgAuditEventsTable({ name?, schema?, contextColumns? })` and
`d1AuditEventsTable({ name?, contextColumns? })`; pass the same options as the
install.

### Catalog

```ts
import { z } from "zod"
import { defineAuditEvents } from "@willyim/kit/audit/events"

export const auditEvents = defineAuditEvents({
  "member.invite": z.object({ email: z.email(), role: z.enum(["admin", "member"]) }),
  "api_key.create": z.object({ keyId: z.string(), permissions: z.array(z.string()) }),
  "api_key.revoke": z.object({ keyId: z.string(), reason: z.string().optional() }),
})
```

Names are dotted lowercase segments of `[a-z0-9_]`; `defineAuditEvents` throws
on anything else. Recording an event parses `data` with its schema (so defaults
and transforms apply, and the stored value is the schema's output) and throws
on an unknown name or an invalid payload, writing nothing. `parseAuditEvent`
exposes the same check.

### Recording

**Postgres.** `recordAuditEvent(db, catalog, name, { subject?, data }, options?)`
runs one INSERT. `user_id` and the context columns are read from the same
session GUCs the trigger reads, so inside `withAuditedTransaction` the event is
attributed exactly like the row changes and commits or rolls back with them:

```ts
import { recordAuditEvent, withAuditedTransaction } from "@willyim/kit/audit/postgres"

await withAuditedTransaction(db, actorId, async (tx) => {
  await tx.insert(invites).values({ workspaceId, email })
  await recordAuditEvent(tx, auditEvents, "member.invite", {
    subject: { type: "workspace", id: workspaceId },
    data: { email, role: "member" },
  }, { contextColumns })
}, { context: { workspace_id: workspaceId } })
```

Options (`auditSchema`, `eventsTable`, `contextKey`, `contextColumns`) must match
the install. Outside a transaction with the context set, the actor and context
columns are `NULL`.

**Ambient context.** `recordEvent(db, catalog, name, input, options?)` from
`@willyim/kit/audit/context` records inside `ensureAuditedTx`: it reuses the
open audited transaction or opens one with the ambient actor, and throws
outside `runWithAuditContext`.

```ts
import { recordEvent } from "@willyim/kit/audit/context"

await recordEvent(db, auditEvents, "api_key.revoke", {
  subject: { type: "api_key", id: keyId },
  data: { keyId, reason: "leaked" },
}, { contextColumns })
```

**D1/SQLite.** `withAuditEvents(db, eventsTable, catalog, { userId, context? })`
from `@willyim/kit/audit/d1-runtime` takes the same context as `withAudit` and
returns `{ record(name, input) }`. Context values are matched to the table's
context columns by name; empty values leave the column `NULL`.

```ts
import { d1AuditEventsTable } from "@willyim/kit/audit/d1"
import { withAuditEvents } from "@willyim/kit/audit/d1-runtime"

const eventsTable = d1AuditEventsTable({ contextColumns: [{ column: "workspace_id" }] })
const events = withAuditEvents(drizzle(env.DB), eventsTable, auditEvents, {
  userId: actor,
  context: { workspace_id: tenantId ?? "" },
})
await events.record("member.invite", {
  subject: { type: "workspace", id: tenantId },
  data: { email, role: "member" },
})
```

`withAudit().record` still writes free-form events into `audit_logs`; it is
unchanged.

### Listing

`listAuditEvents(db, eventsTable, filter?)` (Postgres) and
`listD1AuditEvents(db, eventsTable, filter?)` (D1) return rows newest first
(`ORDER BY id DESC`):

```ts
import { listAuditEvents, pgAuditEventsTable } from "@willyim/kit/audit/postgres"

const eventsTable = pgAuditEventsTable({ contextColumns })
const filter = {
  name: "api_key.*",
  context: { workspace_id: workspaceId },
  after: new Date(Date.now() - 7 * 86_400_000),
  limit: 50,
}
const page = await listAuditEvents(db, eventsTable, filter)
const next = await listAuditEvents(db, eventsTable, { ...filter, cursor: page.at(-1)?.id })
```

| Filter | Matches |
|---|---|
| `name` | Exact name, a family with a trailing `.*` (`"api_key.*"`), or an array of either. `%` and `_` in a family prefix are literal |
| `subject` | `{ type }`, or `{ type, id }` |
| `userId` | The actor |
| `context` | Context column → value (throws on a column the table doesn't have) |
| `after` / `before` | `created_at > after`, `created_at < before` |
| `limit` | Default 50, max 500 |
| `cursor` | Rows with `id < cursor`: the last `id` of the previous page |

Each row is `{ id, name, subjectType, subjectId, userId, data, createdAt, context }`,
with `createdAt` a `Date` and `context` keyed by column. D1 parses `data` from
JSON, and compares `after` / `before` at second precision (`datetime('now')`).

## Ambient Context (AsyncLocalStorage)

The explicit `withAuditedTransaction(db, actorId, cb)` is the cross-runtime floor —
it works everywhere and you pass the actor by hand. The opt-in
`@willyim/kit/audit/context` export adds an *ambient* layer on top: establish
"who is acting" **once** at an entry boundary (a request, a job, an engine tick),
then open-or-reuse a single audited transaction anywhere below — the actor is read
from the ambient store, never threaded through call signatures.

```ts
import {
  runWithAuditContext,
  ensureAuditedTx,
  currentAudit,
} from "@willyim/kit/audit/context"

// 1. Boundary: set the ambient actor for the unit of work. Pass a thunk to
//    resolve it LAZILY — it only runs if a write actually happens, so read-only
//    requests never pay for it (e.g. resolving a session).
app.use((req, next) =>
  runWithAuditContext(
    async () => ({
      actorId: (await getSession(req)).userId,
      context: { workspace_id: req.workspaceId },
    }),
    next,
  ),
)

// 2. Anywhere below: open-or-reuse ONE audited tx. Reads don't call this, so
//    they never open a transaction. Reentrant — nested calls share the tx.
async function archive(db, id) {
  await ensureAuditedTx(db, async (tx) => {
    await tx.update(items).set({ archived: true }).where(eq(items.id, id))
  })
}

// 3. Read the actor for a domain column (inside the callback, where it's resolved).
async function assign(db, id, to) {
  await ensureAuditedTx(db, async (tx) => {
    await tx.insert(assignments).values({ id, to, assignedBy: currentAudit().actorId })
  })
}
```

**Runtime support.** This uses *only* `AsyncLocalStorage` from `node:async_hooks`
(not `createHook`/`executionAsyncId`/…), which is the subset Cloudflare Workers
implements. Works on Node, Bun, and Workers — Workers needs the `nodejs_compat`
flag and a recent compatibility date. If a target lacks ALS, the import throws
loudly; fall back to the explicit `withAuditedTransaction`.

**Guardrail.** `ensureAuditedTx` (and `currentAudit`) throw if there is no ambient
context — a missed boundary becomes a loud failure instead of an unattributed write.

## CLI

Generate a Drizzle migration with audit SQL appended:

```bash
npx kit-audit generate \
  --config app/db/audit.ts \
  --drizzle-config drizzle.config.ts \
  --migrations-dir drizzle
```

Any argument the CLI doesn't recognize (and anything after `--`) is passed
through to `drizzle-kit generate`, so `--name` and `--custom` work. drizzle-kit
runs with your terminal's stdio, so its interactive prompts (rename vs create)
behave exactly as they do when you run drizzle-kit directly.

The audit SQL is appended **only when it changed** since the last time it was
shipped, tracked by a hash in `<migrations-dir>/.drizzle-audit.json` — commit
that file. Migrations that don't touch the audit config stay free of trigger
DDL, and a diff carrying the `-- drizzle-audit <hash>` block is a signal that
the audit setup actually moved. If the audit SQL changes but your schema
didn't, the CLI exits non-zero and tells you to create an empty migration for
it:

```bash
npx kit-audit generate --config app/db/audit.ts -- --custom --name audit-update
```

Your config file exports a `createAuditSql()` function:

```ts
// app/db/audit.ts
import { createAuditInstallSql, createAttachAuditTriggersSql } from "@willyim/kit/audit/postgres"

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

### `@willyim/kit/audit/postgres`

| Export | Description |
|---|---|
| `pgAuditLogTable(options?)` | Drizzle table definition for `audit_logs` |
| `createAuditInstallSql(options?)` | SQL to create the audit table, indexes, and trigger function |
| `createAttachAuditTriggerSql(target, options?)` | SQL to attach audit trigger to one table |
| `createAttachAuditTriggersSql(targets, options?)` | Same, for multiple tables |
| `createAuditAddContextColumnsSql(options)` | SQL to add context columns + regenerate trigger on existing install |
| `setAuditContext(db, actorId, options?)` | Set actor + context GUCs in the current transaction |
| `withAuditedTransaction(db, actorId, callback, options?)` | Transaction wrapper with actor context |
| `pgAuditEventsTable(options?)` | Drizzle table definition for `audit_events` |
| `createAuditEventsInstallSql(options?)` | SQL to create the `audit_events` table and indexes |
| `recordAuditEvent(db, catalog, name, input, options?)` | Validate and record a custom event; actor + context from the session GUCs |
| `listAuditEvents(db, eventsTable, filter?)` | Filtered custom events, newest first |

Trigger targets accept `ignoreColumns` or `onlyColumns`; see [Update Filters](#update-filters).

### `@willyim/kit/audit/context`

Opt-in ambient layer (AsyncLocalStorage). See [Ambient Context](#ambient-context-asynclocalstorage).

| Export | Description |
|---|---|
| `runWithAuditContext(audit, fn)` | Set the ambient actor for `fn` (`audit` is an `AuditContext` or a lazy thunk) |
| `ensureAuditedTx(db, run, options?)` | Open-or-reuse one audited tx; actor read from the ambient context |
| `currentAudit()` | The resolved ambient `AuditContext` (throws if absent/unresolved) |
| `maybeCurrentAudit()` | The resolved ambient `AuditContext`, or `null` |
| `hasAuditContext()` | Whether an ambient context is in scope |
| `recordEvent(db, catalog, name, input, options?)` | `recordAuditEvent` inside `ensureAuditedTx` |

### `@willyim/kit/audit`

| Export | Description |
|---|---|
| `computeDiff(operation, oldData, newData, options?)` | Compute field-by-field diff from old/new row data |

Plus everything from the other entries, and the catalog below.

### `@willyim/kit/audit/events`

| Export | Description |
|---|---|
| `defineAuditEvents(schemas)` | Typed catalog of custom events: dotted name → zod payload schema |
| `parseAuditEvent(catalog, name, input)` | Validate a name and payload; returns `{ name, subjectType, subjectId, data }` |

### `@willyim/kit/audit/d1`

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
| `d1AuditEventsTable(options?)` | Drizzle SQLite table definition for `audit_events` |
| `createD1AuditEventsInstallSql(options?)` | SQL to create the `audit_events` table and indexes |
| `listD1AuditEvents(db, eventsTable, filter?)` | Filtered custom events, newest first, `data` parsed |

Trigger targets accept `onlyColumns`, and the `WithColumns` variants also `ignoreColumns`; see [Update Filters](#update-filters).

### `@willyim/kit/audit/d1-runtime`

| Export | Description |
|---|---|
| `withAudit(db, auditTable, context)` | App-level audit wrapper (no triggers needed) |
| `withAuditEvents(db, eventsTable, catalog, context)` | Custom event recorder: `.record(name, { subject?, data })` |

`withAudit` returns an object with:
- `.insert(table, data)` — Insert + audit log
- `.update(table, where, data)` — Fetch old rows, update, audit log (per row)
- `.delete(table, where)` — Fetch old rows, delete, audit log (per row)
- `.record({ table, operation, rowId?, oldData?, newData? })` — Log one event the wrapper didn't make itself (a write through another library, or an action with no row change). `operation` is free-form (`"invite"`, `"revoke"`…)
- `.db` — Raw Drizzle instance for non-audited operations

`context.userId` may be `null` when no user acted (a machine caller): name it in a context column instead.

## Computing Diffs

The `computeDiff` utility produces field-by-field diffs from the `old_data`/`new_data` captured by audit triggers. It works with any operation type and requires no Drizzle dependency.

```ts
import { computeDiff } from "@willyim/kit/audit"

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

### `audit_events`

```sql
-- Postgres
CREATE TABLE audit_events (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,       -- "member.invite"
  subject_type TEXT,                -- "workspace"
  subject_id   TEXT,
  user_id      TEXT,
  -- + one TEXT column per context column
  data         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Indexes: name, (subject_type, subject_id), user_id, each indexed context column, created_at DESC
```

On D1/SQLite `id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, `data` is a JSON
string in a `TEXT` column, and `created_at` is `TEXT ... DEFAULT (datetime('now'))`.

## Which Approach Should I Use?

| | Postgres Triggers | D1 Runtime (`withAudit`) | D1 Triggers |
|---|---|---|---|
| **Setup** | Migration SQL | Create table only | Migration SQL + context table |
| **Row snapshots** | Automatic (full JSONB) | Automatic (full JSON) | Requires listing columns |
| **User context** | Native session vars | Available in JS | `_audit_context` table |
| **Bypass risk** | Low (DB-level) | Medium (must use wrapper) | Low (DB-level) |
| **Best for** | Postgres apps | D1/Cloudflare Workers | SQLite apps needing DB-level guarantees |

## Migrating from 0.6.x → 0.7.0

The Postgres runtime now takes a single options bag and keys `context` by
**column name** (the library prepends `app.`), matching the D1 runtime and the
`contextColumns` config. The positional `contextKey` argument is gone.

| Before (0.6) | After (0.7) |
|---|---|
| `setAuditContext(db, actorId, "app.user_id", { context: { "app.workspace_id": v } })` | `setAuditContext(db, actorId, { context: { workspace_id: v } })` |
| `withAuditedTransaction(db, actorId, cb, "app.user_id", { context: { "app.workspace_id": v } })` | `withAuditedTransaction(db, actorId, cb, { context: { workspace_id: v } })` |
| `withAuditedTransaction(db, actorId, cb, "myapp.actor")` | `withAuditedTransaction(db, actorId, cb, { actorKey: "myapp.actor" })` |
| `ensureAuditedTx(db, run, "app.user_id")` | `ensureAuditedTx(db, run, { actorKey: "app.user_id" })` |
| `AuditContext.context = { "app.workspace_id": v }` | `AuditContext.context = { workspace_id: v }` |

If a context column uses a custom `sessionKey` (not `app.${column}`), set
`contextPrefix: ""` and pass the fully-qualified GUC name as the key.

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
