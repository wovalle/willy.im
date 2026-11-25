---
"@willyim/kit": minor
---

`collection()`: a list method with one grammar for every kit app. It takes `where` (the app's typed filters, search included as a `q`), `select` (field names or `"*"`), `sort`/`dir`, `limit` (clamped), and `cursor` or `page`, all optional, and returns `{ rows, query, next, total? }`: `query` is the input as applied (defaults, `normalize`, the clamp) and `next` the whole input for the following page, which a caller sends back unchanged. kit generates the input and output schemas, appends how paging works to the description so MCP, `/llms.txt` and `/openapi.json` teach it, encodes an opaque keyset cursor bound to its sort and direction, and picks rows to the selection on every surface. Fields can be hidden (never returned) or gated per caller. In process, rows are typed by `select`. The app writes `load`, which applies the tenant and row scope and the `(key, id)` comparison in its own SQL. README → Collections documents it, and "For agents" now says every list is a collection.

At run time, an object input whose fields are all optional may now be omitted in process (it parses as `{}`), as it already could over `/api` and MCP. A plain method's types still ask for the argument; a collection types its input as optional.
