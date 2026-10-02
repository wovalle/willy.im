---
"@willyim/kit": minor
---

The door checks; inside, operations trust each other:

- A call that enters the app is checked as before: `ctx.services.<service>.<method>(...)` on the context `app.context` returns, `app.handle` (`/api`), `tools()` and MCP.
- A call one operation makes to another, through the `ctx.services` a service factory closes over (inside a method body or any function of the factory), no longer checks the method's permission, `permission: "*"` included. The method the caller invoked is where access is decided. Such a call still runs `when` (a hidden method is still a 404) and input validation (a 400), and `ctx.caller` is still the caller who entered.
- `onCall` events carry `internal`: `true` for a call between operations, `false` for one that entered the app. `event.ctx` is the context `app.context` returned in both cases.
- A factory's `ctx` is a copy of that context whose `services` bind the same methods as trusted; the factory still runs once per context, lazily, and `Object.keys(ctx.services)` lists every service in both. `app.handle`, `tools()` and `toMcpServer()` run the checked services whichever of the two they're handed.

Upgrading: a method that must hold its permission however it's reached calls `ctx.caller.require(...)` in its body. A second, all-powerful context opened only to make internal calls can go.
