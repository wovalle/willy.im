---
"@willyim/kit": minor
---

Audit: per-table `ignoreColumns` / `onlyColumns` UPDATE filters for Postgres and D1 triggers. UPDATEs that change only ignored columns write no audit row; logged rows keep the full snapshot. Postgres now attaches two triggers per table (`<table>_audit` for INSERT/DELETE, `<table>_audit_update` for UPDATE) and puts the filter in the UPDATE trigger's `WHEN` clause; D1 adds a `WHEN` clause to its UPDATE trigger (`ignoreColumns` needs the `WithColumns` variant).
