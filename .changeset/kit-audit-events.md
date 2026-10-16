---
"@willyim/kit": minor
---

Audit: custom events get their own `audit_events` table (Postgres and D1) with a dotted name, subject, actor, context columns and a JSON payload. `defineAuditEvents` (`@willyim/kit/audit/events`) builds a zod-validated catalog; `recordAuditEvent` (Postgres, atomic with `withAuditedTransaction`), `recordEvent` (`audit/context`) and `withAuditEvents` (D1) record through it; `listAuditEvents` / `listD1AuditEvents` filter by name or family (`"api_key.*"`), subject, actor, context, time window and cursor. Install the table with `createAuditEventsInstallSql` / `createD1AuditEventsInstallSql`; Drizzle tables are `pgAuditEventsTable` / `d1AuditEventsTable`.
