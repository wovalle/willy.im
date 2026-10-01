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
import { createApp } from "@willyim/kit"

const context = async (request: Request) => {
  const caller = await callerFrom(request) // see "Callers"
  return { caller, db, scope: policies(caller) }
}
export const services = { notes }
export const app = createApp({ name: "notes", description: "Personal notes.", context, services })

declare module "@willyim/kit" {
  interface Register {
    context: typeof context
    services: typeof services
  }
}
```

Then use it from every surface:

```ts
// a React Router loader
export const loader = async ({ request, params }) =>
  (await app.context(request)).services.notes.get({ id: params.id })

// HTTP: POST /api/notes.get, GET /openapi.json, GET /llms.txt (null for any other path)
const response = await app.handle(request, await app.context(request))

// MCP: you bring the transport
import { toMcpServer } from "@willyim/kit/mcp"
const server = toMcpServer(app, await app.context(request))

// any agent runtime
import { tools } from "@willyim/kit"
for (const t of tools(app, ctx)) runtime.register(t.name, t.description, t.inputZod, t.call)
```

## Concepts

| Concept | What it is |
|---|---|
| **App** | `createApp({ name, description, context, system?, services, onCall?, discovery? })`. Holds every service. |
| **Context** | Built once per request, MCP session, agent turn or cron run: `caller` plus whatever you add (`db`, `scope`, `thread`, `signal`, …). Every service is bound to it. |
| **Register** | The `declare module "@willyim/kit"` block. It gives `ctx`, permissions and `ctx.services` their types everywhere. |
| **Service** | `declareService((ctx) => ({ ... }))`. Plain functions inside stay private; only `method(...)` entries are public. |
| **Method** | `method(contract, fn)`. Each call runs, in order: `when`, the permission, input validation, your function, the output check, then `onCall`. |
| **Caller** | `{ has, require, granted, isSuperadmin, kind? }`, from `auth.createChecker(role)` or `auth.checkerFor(grants)`. `kind: "anonymous"` marks a caller with no credentials. |
| **Policies** | `definePolicies({ note: (caller) => ({ workspaceId: caller.workspaceId }) })`. Row scoping as plain data: `ctx.scope.note({ id })`. |
| **System context** | `app.systemContext(...)`, from the `system` builder, for cron and queues. Give it a superadmin caller. |

### The contract

```ts
method({
  summary: "One line. An agent reads it to choose the method.",
  description: "Optional. Paragraphs: rules, examples, edge cases.",
  permission: "notes:write",           // who may call it
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
- **The output is checked twice.** At compile time, `createApp` fails to type-check if a method
  returns something its `output` rejects. At run time, every call validates the return. In
  process you get the full value; `/api`, `tools()` and MCP strip it to the contract, so an
  internal column never leaves.
- **Tool names** are 1-64 letters, digits, `_` or `-`, and unique. A bad or duplicate name
  throws when the registry is first built.

### Errors

- `fail(400 | 401 | 403 | 404 | 409, message)` throws a JSON `Response`. React Router renders
  it, `/api` returns it as is, `tools()` and MCP turn it into a failure with that message.
- A missing permission throws a 403 `Response`; invalid input a 400 `{ error, fields }`.
- `safe(method, formData)` returns `{ ok: true, value } | { ok: false, errors }` for forms.

### `onCall`

```ts
createApp({ ..., onCall: ({ service, method, ctx, input, ok, error, ms }) => audit.log(...) })
```

Fires once per call, from every surface, with the outcome: denied, invalid, failed or done.
A method hidden by `when` doesn't fire it. If `onCall` throws, the call still succeeds and the
error is logged.

### Images

```ts
import { kitImage } from "@willyim/kit"
output: { url: z.string(), image: kitImage } // { data: base64, mediaType }
```

`/api` returns images as JSON. `tools()` pulls each one out into `images` and leaves a short
reference in the data; MCP sends them as image blocks.

## Surfaces

| Surface | How | Notes |
|---|---|---|
| UI | `ctx.services.notes.get(...)` | In process, fully typed. |
| HTTP | `app.handle(request, ctx)` | `POST /api/<service>.<method>`, `GET /openapi.json`, `GET /llms.txt`. JSON in and out, 204 for no output. |
| Agents | `tools(app, ctx)` | `{ name, title, description, inputSchema, inputZod, outputSchema, hints, call }`. `call` never throws: `{ ok: true, data, images }` or `{ ok: false, message, fields? }`. Write a small adapter per runtime. |
| MCP | `toMcpServer(app, ctx, { instructions? })` from `@willyim/kit/mcp` | A `Server` from `@modelcontextprotocol/sdk` (optional peer). You bring the transport and auth. |
| React | `createPermissionsHook(useData)` from `@willyim/kit/react` | Show or hide UI by the caller's grants. |

**Everything is filtered by the context.** `tools()`, MCP and discovery list only methods that
exist in the context (`when`) and that the caller may call. For a caller with
`kind: "anonymous"`, discovery follows `discovery.anonymous`: `"all"` (the default) lists every
method as documentation, `"none"` lists nothing.

**MCP details.** `tools/list` maps `title`, `description`, JSON Schemas and hints
(`readOnlyHint`, `destructiveHint`, `idempotentHint`). `tools/call` returns
`structuredContent`, the same JSON as a text block, and an image block per `kitImage`. An
output that isn't an object is wrapped as `{ result }`. Failures are `isError` results with
the message and any invalid fields. A tool outside the caller's list, forbidden or
nonexistent, is the same `Unknown tool` error. Build one server per request or session.

## Callers and grants

```ts
const auth = definePermissions({
  permissions: ["notes:read", "notes:write"],
  resources: ["thread"],          // instance grants: "thread:abc"
  roles: { owner: ["notes:read", "notes:write"] },
})

auth.createChecker("owner")                  // a member, by role
auth.createChecker("owner", { superadmin: true })
auth.checkerFor(key.scopes)                  // an API key or a token, by grants
```

What `checkerFor` understands:

- `"notes:read"`: that permission.
- `"notes:*"`: every permission and instance under `notes:`. Not `notesx:`.
- `"*"`: a superadmin. `has` is always true.
- `"thread:abc"`: one instance of a declared resource; `"thread:*"` for all of them. Check it in
  the method body: ``ctx.caller.has(`thread:${id}`)``. The id is one segment (no `:`, `*` or
  whitespace).

Anything else is dropped. `require` throws a 403 `Response`.

## Identity: `@willyim/kit/idp`

`@willyim/kit/idp` re-exports [`@willyim/idp`](https://github.com/wovalle/willy.im/tree/main/packages/idp-client#readme) at the version kit
pins: OIDC login with server sessions (`createIdp`, `/idp/react-router`, `/idp/drizzle`), user
API keys (`createUserKeys`), bearer tokens for MCP (`createResourceServer`), `grants()`, and
the management API (`createManagementApi`) to sync the permission catalog.

```ts
import { createUserKeys } from "@willyim/kit/idp"

const keys = createUserKeys({ baseUrl: "https://idp.willy.im", token: env.IDP_MANAGEMENT_KEY, app: "notes" })
const result = await keys.authenticate(request)
const caller = result.ok ? { kind: "key", ...auth.checkerFor(result.key.scopes) } : anonymousCaller
```

## For agents

Rules for working in a kit app:

- **Anything a route, an API client or an agent calls with input is a `method()`.** Internals
  stay plain functions in the service.
- **Never take tenant ids as input** (`workspaceId`, `userId`). Read them from `ctx.caller` and
  `ctx.scope`.
- **Write `summary` for a model choosing between methods.** Put rules and examples in
  `description`, and describe fields with zod `.describe()`.
- **Declare in `output` only what outside callers need.** Undeclared keys are stripped at the
  edges. `z.unknown()` is a last resort.
- **Failures:** business rules are `fail(409, …)`, not found is `fail(404, …)`. Let kit raise
  permission and input errors.
- **`when` is for where, `permission` for who.** Don't encode a caller check in `when`.
- **A new permission goes in `definePermissions` first**, then sync the catalog to the IdP.
- **Services call each other through `ctx.services` inside method bodies**, never while the
  factory runs: the registry builds factories against an empty context.
- **Tests:** build a context with a fake caller (`auth.checkerFor([...])`) and call
  `ctx.services` directly. Snapshot `/openapi.json` per caller to catch accidental exposure.

## Packages and versions

Install only `@willyim/kit`:

| Entry | What |
|---|---|
| `@willyim/kit` | methods, services, the registry, discovery, HTTP, `tools()`, permissions, policies |
| `@willyim/kit/mcp` | `toMcpServer` (peer: `@modelcontextprotocol/sdk`) |
| `@willyim/kit/react` | `createPermissionsHook` |
| `@willyim/kit/idp` (`/drizzle`, `/react-router`, `/schemas`) | `@willyim/idp` |

kit pins `@willyim/idp` to an exact version, and changesets releases kit whenever idp
releases. `@willyim/rbac` is deprecated; its last release re-exports kit.

## License

MIT
