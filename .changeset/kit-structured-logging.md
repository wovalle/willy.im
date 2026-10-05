---
"@willyim/kit": minor
---

Add `@willyim/kit/log`: structured JSON logs on LogTape for Bun, Node and Workers (`configureLog`, `getLogger`, `withLogContext`), with `LOG_LEVEL`, redaction and error serialization. An app without `onCall` now logs one `call` line per method call, and `CallEvent` gains `surface` (`api`, `tools`, `direct`, `internal`).
