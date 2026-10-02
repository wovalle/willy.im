---
"@willyim/kit": minor
---

`@willyim/kit/audit` on D1/SQLite:

- Fix: `d1AuditLogTable` declared `created_at`'s default as the string `"(datetime('now'))"`, so drizzle-kit emitted `DEFAULT '(datetime(''now''))'` and rows got that literal text instead of a timestamp. It's an SQL default now; regenerate your migrations (drizzle-kit rebuilds `audit_logs`) to fix existing tables.
- `d1AuditLogTable` declares an index per context column (unless `index: false`), matching the install SQL.
- `withAudit(...).record({ table, operation, rowId?, oldData?, newData? })` logs an event the wrapper didn't make itself: a write through another library, or an action with no row change.
- `withAudit`'s `userId` may be `null` for callers that aren't users.
