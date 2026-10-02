# @willyim/kit

**Write a capability once. Call it from your UI, your HTTP API, MCP and any agent.**

You declare services made of typed methods. Each method has a contract: what it does, who
may call it, where it exists, what goes in and what comes out. kit binds every method to the
caller of a request and serves the same methods to:

- your React Router loaders and actions, in process
- an HTTP API, with OpenAPI 3.1 and `llms.txt` filtered per caller
- an MCP server
- any agent runtime (Claude Agent SDK, AI SDK, …), through one neutral tool list

Permissions, roles and row scoping are built in, and `@willyim/kit/idp` covers login, API keys
and bearer tokens through the willy.im IdP.

```sh
npm install @willyim/kit zod
```

## Thirty seconds

```ts
// app/permissions.ts
import { definePermissions } from "@willyim/kit"

export const auth = definePermissions({
  permissions: ["notes:read", "notes:write"],
  roles: { owner: ["notes:read", "notes:write"], viewer: ["notes:read"] },
})
```

```ts
// app/services/notes.ts
import { declareService, fail, method } from "@willyim/kit"
import { z } from "zod"

export const notes = declareService((ctx) => ({
  get: method(
    {
      summary: "Get one note by id",
      permission: "notes:read",
      input: { id: z.string() },
      output: { id: z.string(), title: z.string() },
    },
    async ({ id }) => {
      const row = await ctx.db.query.notes.findFirst({ where: ctx.scope.note({ id }) })
      return row ?? fail(404, "no such note")
    },
  ),
}))
```

```ts
// app/app.ts
import { createApp, type ContextInput } from "@willyim/kit"

// kit resolves the caller; you add the rest. Scope rows by the tenant.
const context = ({ caller }: ContextInput) => ({ db, scope: policies(caller) })
export const services = { notes }
export const app = createApp({
  name: "notes",
  description: "Personal notes.",
  auth,
  context,
  services,
})

declare module "@willyim/kit" {
  interface Register {
    auth: typeof auth
    context: typeof context
    services: typeof services
  }
}
```

Then use it from every surface. Build the principal from the request (see "Principals and
tenants") and pick the tenant there:

```ts
// a React Router loader
export const loader = async ({ request, params }) =>
  (await app.context(await principalFrom(request), params.workspace)).services.notes.get({
    id: params.id,
  })

// HTTP: POST /api/notes.get, GET /openapi.json, GET /llms.txt (null for any other path)
const response = await app.handle(request, await app.context(principal, tenantId))

// MCP: you bring the transport
import { toMcpServer } from "@willyim/kit/mcp"
const server = toMcpServer(app, await app.context(principal, tenantId))

// any agent runtime
import { tools } from "@willyim/kit"
for (const t of tools(app, ctx)) runtime.register(t.name, t.description, t.inputZod, t.call)
```

## Concepts

| Concept       | What it is                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**       | `createApp({ name, description, auth, context, services, onCall?, discovery?: { anonymous?, auth? } })`. Holds every service.                                                                              |
| **Principal** | `{ id, grants, memberships: [{ tenantId, grants }], actor? }`: who is calling, as plain data you build per request. Cron and queues are a principal too.                                                   |
| **Context**   | `app.context(principal, tenantId, ...args)`, once per request, MCP session, agent turn or cron run: `caller`, `tenantId`, `actor`, whatever your builder adds, and its services, each built on first read. |
| **Register**  | The `declare module "@willyim/kit"` block. It gives `ctx`, grants and `ctx.services` their types everywhere.                                                                                               |
| **Service**   | `declareService((ctx) => ({ ... }))`. Plain functions inside stay private; only `method(...)` entries are public. The factory runs the first time `ctx.services.<name>` is read, once per context.         |
| **Method**    | `method(contract, fn)`. Each call runs, in order: `when`, the permission, input validation, your function, the output check (edges only), then `onCall`.                                                   |
| **Caller**    | `ctx.caller`: `{ has, require, granted, grants, isSuperadmin, principal, tenantId, kind? }`. `kind: "anonymous"` marks a caller with no credentials.                                                       |
| **Policies**  | `definePolicies({ note: (caller) => ({ workspaceId: caller.tenantId }) })`. Row scoping as plain data: `ctx.scope.note({ id })`.                                                                           |

### The contract

```ts
method({
  summary: "One line. An agent reads it to choose the method.",
  description: "Optional. Paragraphs: rules, examples, edge cases.",
  permission: "notes:write",           // who may call it; "*" or { resource: "thread" }
  input: { title: z.string() },        // a zod schema or a plain shape; omit for no input
  output: { id: z.string() },          // required if it returns a value; omit for none
  when: (ctx) => ctx.thread !== null,  // optional: where it exists; omit for everywhere
  hints: { readOnly: false, destructive: false, idempotent: true }, // optional, MCP annotations
  name: "note_create",                 // optional tool name; default service_method
}, async (input) => { ... })
```

- **`permission` is about who; `when` is about where.** When `when` is false the method
  doesn't exist in that context: it's missing from discovery, `tools()` and MCP, and a direct
  call gets the same 404 "no method" error as a typo. It's checked before the permission, so a
  hidden method never reveals that it exists.
- **`permission: { resource: "thread" }`** lets in anyone holding at least one `thread:<id>`
  grant (or `thread:*`, or `*`), so such callers see the method. The body then checks the id:
  ``ctx.caller.require(`thread:${id}`)``.
- **`permission: "*"`** is for superadmins only: holding every permission isn't enough.
  Discovery shows it as `superadmin`, and only to superadmins. Use it instead of checking
  `isSuperadmin` by hand.
- **The output is checked at compile time and at the edges.** `createApp` fails to type-check
  if a method returns something its `output` rejects. At run time, `/api`, `tools()` and MCP
  validate the return and strip it to the contract, so an internal column never leaves; a
  return the contract rejects is an error there. In process (`ctx.services`) the output isn't
  parsed: you get the method's value as is.
- **`createApp` fails fast:** it builds the registry right away, so a bad or duplicate tool name
  (1-64 letters, digits, `_` or `-`) or a factory that touches `ctx` while building throws at
  startup.
- **Dates:** outputs send `z.date()` as an ISO string. Inputs arrive as JSON, so take dates as
  `z.coerce.date()` or `z.iso.datetime()`; a plain `z.date()` input accepts no JSON value.

### Errors

- `fail(400 | 401 | 403 | 404 | 409, message)` throws a JSON `Response`. React Router renders
  it, `/api` returns it as is, `tools()` and MCP turn it into a failure with that message.
- A missing permission throws a 403 `Response`; invalid input a 400 `{ error, fields }`, with
  errors on the input as a whole under `fields._`.
- Any other thrown error is a bug, not a message: `/api` rethrows it, and `tools()` and MCP
  answer `internal error (<id>)` and log the error with that id. Only `Response`s reach callers.
- `safe(method, formData)` returns `{ ok: true, value } | { ok: false, errors }` for forms.

### `onCall`

```ts
createApp({ ..., onCall: ({ service, method, ctx, input, ok, error, ms }) => audit.log(...) })
```

Fires once per call, from every surface, with the outcome: denied, invalid, failed or done.
It's awaited before the call returns, so an audit write isn't lost when a Worker's response
ends. A method hidden by `when` doesn't fire it. If `onCall` throws, the call still succeeds
and the error is logged.

### Images

```ts
import { kitImage } from "@willyim/kit"
output: { url: z.string(), image: kitImage } // { data: base64, mediaType }
```

`/api` returns images as JSON. `tools()` pulls each one out into `images` and leaves a short
reference in the data; MCP sends them as image blocks.

## Surfaces

| Surface | How                                                                | Notes                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI      | `ctx.services.notes.get(...)`                                      | In process, fully typed; the output comes back as the method returned it.                                                                                                                                                                                                                                 |
| HTTP    | `app.handle(request, ctx)`                                         | `POST /api/<service>.<method>`, `GET /openapi.json`, `GET /llms.txt`. JSON in and out, 204 for no output.                                                                                                                                                                                                 |
| Agents  | `tools(app, ctx)`                                                  | `{ name, title, description, inputSchema, inputZod, outputSchema, outputZod, hints, call }`. `inputZod` is always a `z.object` (a non-object input is wrapped as `{ input }`). `call` never throws: `{ ok: true, data, images }` or `{ ok: false, message, fields? }`. Write a small adapter per runtime. |
| MCP     | `toMcpServer(app, ctx, { instructions? })` from `@willyim/kit/mcp` | A `Server` from `@modelcontextprotocol/sdk` (optional peer). You bring the transport and auth. To mix kit tools with your own, use `toMcpTool(t)` and `toCallToolResult(t, result)`.                                                                                                                      |
| React   | `createPermissionsHook(useData)` from `@willyim/kit/react`         | Show or hide UI by the caller's grants.                                                                                                                                                                                                                                                                   |

**Everything is filtered by the context.** `tools()`, MCP and discovery list only methods that
exist in the context (`when`) and that the caller may call. For a caller with
`kind: "anonymous"`, discovery follows `discovery.anonymous`: `"all"` (the default) lists every
method as documentation, `"none"` lists none.

**Discovery when closed.** With `anonymous: "none"`, a caller with no credentials learns why
it sees nothing and how to fix it, never a method name: `/llms.txt` and `/openapi.json`
answer 200 with the app's name, a note that methods are listed only for authenticated callers,
and `discovery.auth` (`instructions`, `keysUrl`, `oauth.resourceMetadataUrl`; OpenAPI also
gets the security schemes and `paths: {}`). `/api/*` answers 401 with
`WWW-Authenticate: Bearer` (plus `resource_metadata="…"` with OAuth) and the same
instructions, before any method is looked up: anonymous callers can't call anything.

**Wording.** `discovery.docs` sets the token placeholder (`key`), the bearer scheme's
description and the error descriptions in `/openapi.json` and `/llms.txt`. The defaults are
neutral.

**MCP details.** `tools/list` maps `title`, `description`, JSON Schemas and hints
(`readOnlyHint`, `destructiveHint`, `idempotentHint`). `tools/call` returns
`structuredContent`, the same JSON as a text block, and an image block per `kitImage`. An
output that isn't always an object (an array, a string, an optional or nullable object) is
wrapped as `{ result }`. Failures are `isError` results with
the message and any invalid fields. A tool outside the caller's list, forbidden or
nonexistent, is the same `Unknown tool` error. Build one server per request or session.
Unauthenticated MCP never reaches kit: your transport answers 401 + `WWW-Authenticate` first.

## Principals and tenants

```ts
const auth = definePermissions({
  permissions: ["notes:read", "notes:write"],
  resources: ["thread"], // instance grants: "thread:abc"
  roles: { owner: ["notes:read", "notes:write"], viewer: ["notes:read"] },
})

// Built per request from live data: a session, a key row, the IdP.
const principal: Principal = {
  id: `user:${user.id}`, // the app's choice; also the audit identity
  grants: user.staff ? ["notes:read"] : [], // global: every tenant, and the null tenant
  memberships: rows.map((m) => ({ tenantId: m.workspaceId, grants: auth.roles[m.role] })),
}
const ctx = await app.context(principal, workspaceId)
```

`app.context(principal | null, tenantId | null, ...args)` is the only door:

- **In a tenant**, the caller holds `membership.grants ∪ principal.grants`.
- **No tenant** (`null`: person-level or install-wide methods): `principal.grants` only.
- **A tenant the principal has nothing in** (no membership, no global grants) throws a 404
  `Response` before your builder runs, so tenants don't leak.
- **`null` principal**: an anonymous caller (`kind: "anonymous"`, no grants). Never a 404.
- Your `context` builder receives `{ principal, tenantId, caller, actor }` plus your own
  arguments, and returns the rest (`db`, `scope`, `logger`…). kit sets `ctx.caller`,
  `ctx.tenantId` and `ctx.actor` (`principal.actor?.id ?? principal.id`: the impersonator when
  impersonating). Returning one of them doesn't compile.
- Tenant ids are strings: convert numeric ids with `String()` at the edge.
- **Cron and queues** are a principal: `app.context({ id: "system:cron", grants: ["*"], memberships: [] }, ws)`.
- **API keys**: one membership with the key's scopes. Refuse the key unless its owner is still
  a member and `auth.covers(ownerGrants, scopes)`: never silently shrink it.
- **Single-tenant apps**: `memberships: []`, global grants, a `null` tenant.

### Grants

`Grant` is typed from your catalog (`Register.auth`), so a typo in a literal doesn't compile:

- `"notes:read"`: that permission.
- `"notes:*"`: every permission and instance under `notes:`. Not `notesx:`.
- `"*"`: a superadmin. `has` is always true.
- `"thread:abc"`: one instance of a declared resource; `"thread:*"` for all of them. Check it in
  the method body: ``ctx.caller.has(`thread:${id}`)``. The id is one segment (no `:`, `*` or
  whitespace).

A resource may not prefix a catalog permission (`thread` and `thread:read` together throw), so
a grant always means one thing.

- **`auth.parseGrants(strings)`** → `{ grants, rejected }`: the runtime boundary for grants
  from the DB, a request or the IdP. It rejects unknown permissions, wildcards over namespaces
  the catalog doesn't have, and bad instance ids. Run it on write (membership grants, key
  scopes) and on load. `app.context` drops anything it rejects.
- **`auth.covers(held, wanted)`**: is every grant in `wanted` covered by `held`? `"*"` covers
  all; `"ns:*"` covers `"ns:x"` and `"ns:*"`; `"thread:*"` covers `"thread:abc"`. Holding every
  concrete `ns:` permission does not cover `"ns:*"`. Check it when minting a key, inviting or
  changing a role (the minter must cover what they hand out), and when using a key or a stored
  delegation (the owner must still cover it).
- **`ctx.caller.require(...grants)`** throws a 403 `Response` unless the caller covers every
  argument (AND; no arguments passes). Always run it in the **target** tenant's context:
  minting a key for `w2` checks `w2`'s grants, not the current tenant's.
- `ctx.caller.grants` are the grants as held in this tenant; `granted` expands them to the
  catalog permissions and instances, for `@willyim/kit/react`.

`auth.callerFor` and `auth.checkerFor` are the low-level pieces `app.context` uses. Grants must
come from a trusted source: never let a user hand out grants they don't cover.

`Register` is global: one kit app per TypeScript program.

### From 0.1

- `createApp` takes `auth` (your `definePermissions` result); `context` receives
  `{ principal, tenantId, caller, actor }` first and no longer returns `caller`.
- `app.context(request)` → `app.context(principal, tenantId, request)`. Delete custom `Caller`
  types and hand-built checkers; policies scope by `caller.tenantId`.
- `system` / `app.systemContext` are gone: pass a system principal holding `["*"]`.
- `auth.createChecker(role)` is gone: expand roles with `auth.roles[role]` into membership
  grants. `{ superadmin: true }` is the grant `"*"`.
- `Register` gains `auth: typeof auth`.
- Raw `isSuperadmin` checks become `permission: "*"`.

## Identity: `@willyim/kit/idp`

`@willyim/kit/idp` re-exports [`@willyim/idp`](https://github.com/wovalle/willy.im/tree/main/packages/idp-client#readme) at the version kit
pins: OIDC login with server sessions (`createIdp`, `/idp/react-router`, `/idp/drizzle`), user
API keys (`createUserKeys`), bearer tokens for MCP (`createResourceServer`), `grants()`, and
the management API (`createManagementApi`) to sync the permission catalog.

```ts
import { createUserKeys } from "@willyim/kit/idp"

const keys = createUserKeys({
  baseUrl: "https://idp.willy.im",
  token: env.IDP_MANAGEMENT_KEY,
  app: "notes",
})
const result = await keys.authenticate(request)
// A key is one membership with its scopes, in the key's workspace.
const principal: Principal | null = result.ok
  ? {
      id: `apikey:${result.key.keyId}`,
      grants: [],
      memberships: [
        {
          tenantId: result.key.workspaceId ?? "",
          grants: auth.parseGrants(result.key.scopes).grants,
        },
      ],
    }
  : null
const ctx = await app.context(principal, result.ok ? result.key.workspaceId : null)
```

## For agents

Rules for working in a kit app:

- **Anything a route, an API client or an agent calls with input is a `method()`.** Internals
  stay plain functions in the service.
- **Never take tenant ids as input** (`workspaceId`, `userId`). The surface picks the tenant
  (hostname, path, cookie, key) and passes it to `app.context`; methods read `ctx.tenantId` and
  scope rows through `ctx.scope`.
- **Never build callers by hand.** Build a `Principal` and go through `app.context`; check
  extra grants with `ctx.caller.require(...)` in the target tenant's context.
- **Write `summary` for a model choosing between methods.** Put rules and examples in
  `description`, and describe fields with zod `.describe()`.
- **Declare in `output` only what outside callers need.** Undeclared keys are stripped at the
  edges. `z.unknown()` is a last resort.
- **Failures:** business rules are `fail(409, …)`, not found is `fail(404, …)`. Let kit raise
  permission and input errors.
- **`when` is for where, `permission` for who.** Don't encode a caller check in `when`.
- **A new permission goes in `definePermissions` first**, then sync the catalog to the IdP.
- **Services call each other through `ctx.services` inside method bodies**, never while the
  factory runs: the registry builds factories against an empty context, and a context builds
  each service lazily, so a factory must not depend on another one having run.
- **Superadmin-only methods** use `permission: "*"`, not an `isSuperadmin` check.
- **Grants from outside** (DB, request, IdP) go through `auth.parseGrants`; anything handed
  out (keys, invites, roles) must be `auth.covers`ed by the one handing it out.
- **Tests:** build a context from a fake principal
  (`app.context({ id: "user:t", grants: [], memberships: [{ tenantId: "w1", grants: [...] }] }, "w1")`)
  and call `ctx.services` directly. In process the output isn't checked, so test an output
  contract through `tools()` or `app.handle`. Snapshot `/openapi.json` per caller to catch accidental exposure.

## Audit: `@willyim/kit/audit`

Audit logging for Drizzle (formerly `@willyim/drizzle-audit`, same API). Needs `drizzle-orm >= 1`
(optional peer; kit's root entry never imports it). Postgres records changes with triggers; D1 and
SQLite use triggers or the `withAudit` wrapper. Full reference (schemas, diffs, CLI, every
export): [AUDIT.md](AUDIT.md).

| Entry                           | What                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@willyim/kit/audit/postgres`   | `pgAuditLogTable`, `createAuditInstallSql`, `createAttachAuditTriggersSql`, `withAuditedTransaction`       |
| `@willyim/kit/audit/d1`         | `d1AuditLogTable`, `createD1AuditInstallSql`, `createAttachD1AuditTriggersSql`, `withD1AuditedTransaction` |
| `@willyim/kit/audit/d1-runtime` | `withAudit(db, auditTable, { userId, context? })`: audited `insert` / `update` / `delete`                  |
| `@willyim/kit/audit/context`    | `runWithAuditContext` / `ensureAuditedTx`: ambient actor over `AsyncLocalStorage` (Postgres)               |
| `@willyim/kit/audit`            | all of the above plus `computeDiff`                                                                        |

Kit hands your `context` builder `actor` (the impersonator when impersonating, else the
principal) and `tenantId`. Kit itself does no auditing; you attach it with one of two patterns.

D1 / SQLite: bind `withAudit` once in `context`. Every service and nested `ctx.services` call
shares that `ctx.db`, so every write carries the right actor. Writes through a db handle outside
`ctx.db` are not audited.

```ts
import { d1AuditLogTable } from "@willyim/kit/audit/d1"
import { withAudit } from "@willyim/kit/audit/d1-runtime"

const auditLogs = d1AuditLogTable({ contextColumns: [{ column: "workspace_id" }] })

const app = createApp({
  // ...
  context: ({ actor, tenantId }) => ({
    db: withAudit(drizzle(env.DB), auditLogs, {
      userId: actor,
      context: { workspace_id: tenantId ?? "" }, // empty values leave the column NULL
    }),
  }),
})

// in a method: await ctx.db.insert(notes, { id, body }); ctx.db.db is the raw, unaudited handle
```

Postgres (triggers read the actor from transaction settings, so there is no wrapper). Set the
ambient actor once at the surface (request, agent turn, cron run) with `runWithAuditContext`;
services write through `ensureAuditedTx`, which opens one audited transaction lazily on the first
write and reuses it for nested writes. Reads never open one. A write outside a context throws.

```ts
import { ensureAuditedTx, runWithAuditContext } from "@willyim/kit/audit/context"

// at the surface, once ctx is built
return runWithAuditContext(
  { actorId: ctx.actor, context: { workspace_id: ctx.tenantId ?? "" } },
  () => app.handle(request, ctx),
)

// in a method
await ensureAuditedTx(ctx.db, (tx) => tx.insert(notes).values({ id, body }))
```

`runWithAuditContext` also takes a thunk, resolved only on the first write. The explicit
`withAuditedTransaction(db, actorId, fn, { context })` and `setAuditContext` from
`@willyim/kit/audit/postgres` still work without `AsyncLocalStorage` (Workers need
`nodejs_compat` for `/audit/context`).

Kit never records method input (it can hold secrets, e.g. a key being validated); the audit log
holds row changes only. Use `onCall` for logs, metrics and tracing.

Migrations: `kit-audit generate --config audit.config.ts` runs `drizzle-kit generate` (optional
peer) and appends the audit SQL from your config (`createAuditSql()` or `createWebAuditSql()`) to
the new migration only when it changed. Flags: `--drizzle-config`, `--migrations-dir`, `--cwd`;
anything else (or after `--`) goes to drizzle-kit.

## Packages and versions

Install only `@willyim/kit`:

| Entry                                                                                 | What                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@willyim/kit`                                                                        | methods, services, the registry, discovery, HTTP, `tools()`, permissions, policies |
| `@willyim/kit/mcp`                                                                    | `toMcpServer` (peer: `@modelcontextprotocol/sdk`)                                  |
| `@willyim/kit/react`                                                                  | `createPermissionsHook`                                                            |
| `@willyim/kit/idp` (`/drizzle`, `/react-router`, `/schemas`)                          | `@willyim/idp`                                                                     |
| `@willyim/kit/audit` (`/context`, `/d1`, `/d1-runtime`, `/postgres`), bin `kit-audit` | Drizzle audit logging (peers: `drizzle-orm`, `drizzle-kit` for the CLI)            |

kit pins `@willyim/idp` to an exact version, and changesets releases kit whenever idp
releases. `@willyim/rbac` is deprecated; its last release re-exports kit.
`@willyim/drizzle-audit` is deprecated: use `@willyim/kit/audit`.

## License

MIT
