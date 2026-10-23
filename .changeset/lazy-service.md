---
"@willyim/kit": minor
---

`lazyService(() => import("./x.service").then((m) => m.xService))`: a service whose module loads on first use, so a heavy service stays out of the code an app evaluates at startup. Typed as the factory it loads. `loadServices(app)` loads every lazy service; `handle` calls it itself, while `registry`, `tools` and `toMcpServer` throw until it has run.
