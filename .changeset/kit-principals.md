---
"@willyim/kit": minor
"@willyim/rbac": patch
---

Multi-tenancy is first-class. Breaking:

- `createApp` takes `auth` (your `definePermissions` result). `app.context(principal, tenantId, ...args)` is the only way to build a context: kit resolves `ctx.caller` from a `Principal` (`{ id, grants, memberships: [{ tenantId, grants }], actor? }`) and adds `ctx.tenantId` and `ctx.actor`. In a tenant the caller holds membership ∪ global grants, with no tenant only global ones; a tenant the principal has nothing in is a 404. A `null` principal is anonymous.
- The `context` builder receives `{ principal, tenantId, caller, actor }` before your own arguments and must not return `caller`, `tenantId` or `actor`. `Register` gains `auth: typeof auth`.
- Removed: `system` / `app.systemContext` (use a principal holding `["*"]`), `auth.createChecker` and `CheckerOptions` (expand roles with `auth.roles[role]`).
- `caller.require(...grants)` takes any grant (wildcards, instances) and ANDs them, via the new `auth.covers(held, wanted)`. New `auth.parseGrants(strings)` validates grants from outside. `permission: "*"` marks superadmin-only methods.
- New types: `Grant` and `Principal` (typed from the registered catalog), `Caller`, `ContextInput`, `Access`, `Resource`.

Migrating: build a `Principal` per request, pick the tenant at the surface and call `app.context(principal, tenantId)`; delete custom caller types; scope policies by `caller.tenantId`; replace `systemContext` with a system principal and raw superadmin checks with `permission: "*"`.

`@willyim/rbac` no longer re-exports `CheckerOptions`.
