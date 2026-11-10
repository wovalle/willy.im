---
"@willyim/kit": minor
---

MCP sends less. `tools/list` no longer carries `outputSchema` (it was most of the list's bytes, paid by every session). `tools/call` returns the output once, as compact JSON in a text block, instead of `structuredContent` plus the same JSON as text; only a tool with a view still returns `structuredContent`, the data its view is fed. An absent optional output is `null`. Generated JSON Schemas drop `z.int()`'s safe-integer bounds (`type: integer` already says it), in `/openapi.json` too.
