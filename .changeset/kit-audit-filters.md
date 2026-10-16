---
"@willyim/kit": minor
---

Audit: per-table `ignoreColumns` / `onlyColumns` UPDATE filters for Postgres and D1 triggers, and `recordAuditEvent` (plus `recordAudit` in `audit/context`) to log custom events on Postgres. The audit table no longer CHECKs `operation`; `createAuditDropOperationCheckSql` drops it on existing Postgres installs. Postgres now attaches two triggers per table (`<table>_audit` for INSERT/DELETE, `<table>_audit_update` for UPDATE).
