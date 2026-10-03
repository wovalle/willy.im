# @willyim/kit

## 0.5.2

### Patch Changes

- 07fa409: `@willyim/kit/audit/context`: `runWithAuditContext` releases its lazy actor resolver once `fn` settles. On workerd the AsyncLocalStorage store stays reachable from native code after a request ends, so a resolver closing over the request (db client, sockets, auth) kept the whole request alive. An actor already resolved stays available to work that outlives `fn` (a `waitUntil` write); a write that would still need to resolve one now fails with "audit actor unavailable: the scope has ended".
- 361e9c6: A context binds each method the first time it's read, not every method of a service up front, and builds a contract's schemas once for every context. Same behaviour, far less memory and CPU per request.

## 0.5.1

### Patch Changes

- Updated dependencies [01d9a27]
- Updated dependencies [7d335b2]
  - @willyim/idp@0.8.0

## 0.5.0

### Minor Changes

- e4b02ee: The door checks; inside, operations trust each other:

  - A call that enters the app is checked as before: `ctx.services.<service>.<method>(...)` on the context `app.context` returns, `app.handle` (`/api`), `tools()` and MCP.
  - A call one operation makes to another, through the `ctx.services` a service factory closes over (inside a method body or any function of the factory), no longer checks the method's permission, `permission: "*"` included. The method the caller invoked is where access is decided. Such a call still runs `when` (a hidden method is still a 404) and input validation (a 400), and `ctx.caller` is still the caller who entered.
  - `onCall` events carry `internal`: `true` for a call between operations, `false` for one that entered the app. `event.ctx` is the context `app.context` returned in both cases.
  - A factory's `ctx` is a copy of that context whose `services` bind the same methods as trusted; the factory still runs once per context, lazily, and `Object.keys(ctx.services)` lists every service in both. `app.handle`, `tools()` and `toMcpServer()` run the checked services whichever of the two they're handed.

  Upgrading: a method that must hold its permission however it's reached calls `ctx.caller.require(...)` in its body. A second, all-powerful context opened only to make internal calls can go.

## 0.4.0

### Minor Changes

- 662ebee: `@willyim/kit/audit` on D1/SQLite:

  - Fix: `d1AuditLogTable` declared `created_at`'s default as the string `"(datetime('now'))"`, so drizzle-kit emitted `DEFAULT '(datetime(''now''))'` and rows got that literal text instead of a timestamp. It's an SQL default now; regenerate your migrations (drizzle-kit rebuilds `audit_logs`) to fix existing tables.
  - `d1AuditLogTable` declares an index per context column (unless `index: false`), matching the install SQL.
  - `withAudit(...).record({ table, operation, rowId?, oldData?, newData? })` logs an event the wrapper didn't make itself: a write through another library, or an action with no row change.
  - `withAudit`'s `userId` may be `null` for callers that aren't users.

## 0.3.0

### Minor Changes

- 73d1a58: Output validation runs only at the edges, and services build lazily:
  - `/api` (`app.handle`), `tools()` and MCP validate a method's return against its `output` and strip it to the contract, as before. An in-process call (`ctx.services.<service>.<method>(...)`) no longer parses the output: it returns the method's value as is and doesn't throw when the value doesn't match, so `onCall` reports such a call as `ok: true`. `when`, the permission and input validation still run on every call, and the compile-time output check is unchanged.
  - `app.context(...)` no longer runs every service factory. `ctx.services.<name>` builds its service the first time it's read and keeps it for that context; `Object.keys(ctx.services)` still lists every service. A factory that reads its own service while it builds throws, naming it. `createApp` still fails fast on a bad declaration.

## 0.2.0

### Minor Changes

- 19ef601: Adds `@willyim/kit/audit` (`/context`, `/d1`, `/d1-runtime`, `/postgres`) and the `kit-audit` CLI: the Drizzle audit logging from `@willyim/drizzle-audit`, same API. `drizzle-orm` and `drizzle-kit` are optional peers.
- 19ef601: Multi-tenancy is first-class. Breaking:
  - `createApp` takes `auth` (your `definePermissions` result). `app.context(principal, tenantId, ...args)` is the only way to build a context: kit resolves `ctx.caller` from a `Principal` (`{ id, grants, memberships: [{ tenantId, grants }], actor? }`) and adds `ctx.tenantId` and `ctx.actor`. In a tenant the caller holds membership ∪ global grants, with no tenant only global ones; a tenant the principal has nothing in is a 404. A `null` principal is anonymous.
  - The `context` builder receives `{ principal, tenantId, caller, actor }` before your own arguments and must not return `caller`, `tenantId` or `actor`. `Register` gains `auth: typeof auth`.
  - Removed: `system` / `app.systemContext` (use a principal holding `["*"]`), `auth.createChecker` and `CheckerOptions` (expand roles with `auth.roles[role]`).
  - `caller.require(...grants)` takes any grant (wildcards, instances) and ANDs them, via the new `auth.covers(held, wanted)`. New `auth.parseGrants(strings)` validates grants from outside. `permission: "*"` marks superadmin-only methods.
  - New types: `Grant` and `Principal` (typed from the registered catalog), `Caller`, `ContextInput`, `Access`, `Resource`.

  Migrating: build a `Principal` per request, pick the tenant at the surface and call `app.context(principal, tenantId)`; delete custom caller types; scope policies by `caller.tenantId`; replace `systemContext` with a system principal and raw superadmin checks with `permission: "*"`.

  `@willyim/rbac` no longer re-exports `CheckerOptions`.

## 0.1.0

### Minor Changes

- 07352da: First release of `@willyim/kit`: typed methods with contracts (`summary`, `description`, `permission`, `input`, `output`, `when`, `hints`, `name`), served to the UI, an HTTP API with OpenAPI and `llms.txt`, MCP (`@willyim/kit/mcp`) and any agent runtime (`tools(app, ctx)`), with an `onCall` hook, `kitImage` outputs and `discovery: { anonymous: "all" | "none", auth? }` (closed discovery tells unauthenticated callers how to log in). It absorbs `@willyim/rbac` (now with `"*"` superadmin and instance grants for declared `resources`) and re-exports `@willyim/idp` as `@willyim/kit/idp`.

  `@willyim/rbac` is deprecated: this release only re-exports `@willyim/kit`.
