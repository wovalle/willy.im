---
"@willyim/kit": patch
---

A context binds each method the first time it's read, not every method of a service up front, and builds a contract's schemas once for every context. Same behaviour, far less memory and CPU per request.
