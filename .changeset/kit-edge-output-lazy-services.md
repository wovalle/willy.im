---
"@willyim/kit": minor
---

Output validation runs only at the edges, and services build lazily:

- `/api` (`app.handle`), `tools()` and MCP validate a method's return against its `output` and strip it to the contract, as before. An in-process call (`ctx.services.<service>.<method>(...)`) no longer parses the output: it returns the method's value as is and doesn't throw when the value doesn't match, so `onCall` reports such a call as `ok: true`. `when`, the permission and input validation still run on every call, and the compile-time output check is unchanged.
- `app.context(...)` no longer runs every service factory. `ctx.services.<name>` builds its service the first time it's read and keeps it for that context; `Object.keys(ctx.services)` still lists every service. A factory that reads its own service while it builds throws, naming it. `createApp` still fails fast on a bad declaration.
