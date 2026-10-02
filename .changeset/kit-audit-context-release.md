---
"@willyim/kit": patch
---

`@willyim/kit/audit/context`: `runWithAuditContext` releases its lazy actor resolver once `fn` settles. On workerd the AsyncLocalStorage store stays reachable from native code after a request ends, so a resolver closing over the request (db client, sockets, auth) kept the whole request alive. An actor already resolved stays available to work that outlives `fn` (a `waitUntil` write); a write that would still need to resolve one now fails with "audit actor unavailable: the scope has ended".
