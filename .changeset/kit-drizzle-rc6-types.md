---
"@willyim/kit": minor
---

The audit table factories (`pgAuditLogTable`, `pgAuditEventsTable`, `d1AuditLogTable`, `d1AuditEventsTable`, `d1AuditContextTable`) now declare their return types from drizzle's builder types, so the published declarations no longer freeze the column configs computed by kit's own drizzle. The app's drizzle builds the table type, which makes `db.select().from(auditLogs)` typecheck on drizzle-orm 1.0.0-rc.6 again (it failed with TS2345) while still working on rc.4. The column and table types are exported as `PgAuditLogColumns`/`PgAuditLogTable`, `PgAuditEventsColumns`/`PgAuditEventsTable`, `D1AuditLogColumns`/`D1AuditLogTable`, `D1AuditEventsColumns`/`D1AuditEventsTable` and `D1AuditContextColumns`/`D1AuditContextTable`. Checked against drizzle-orm 1.0.0-rc.4 and 1.0.0-rc.6.
