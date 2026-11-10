---
"@willyim/kit": minor
---

`/openapi.json` carries a method's `hints` as `x-hints` (`readOnly`, `destructive`, `idempotent`), the same ones MCP sends as annotations, so a client reaching methods over HTTP (bender's `describe`/`call`) knows which change nothing and which may delete or overwrite. README "For agents" gains two rules: a list returns rows and a get returns the record, and every method declares `hints`.
