# @willyim/kit

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
