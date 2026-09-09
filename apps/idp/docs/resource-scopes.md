# Resource-scoped permissions

A permission names a surface: `kirby:read` is the whole archive. Sometimes the
honest grant is one thing inside it — one WhatsApp conversation, one published
document, one invoices workspace. This is how the IdP mints that grant without
learning what the thing is.

## The shape

The resource goes in the permission string, as its last segment:

```
kirby:read                  the archive               a flat permission
kirby:thread:t_14f451b6     one conversation          <type>:<id>
artifacts:8f3a…             one published document    <type>:<id>
invoices:workspace:acme     one workspace             <type>:<id>
```

Nothing downstream changes shape. The composed string is what lands on a
`wak_` key's `scopes`, in the `https://willy.im/permissions` claim, and in an
identity resolution. `grants()` in `@willyim/idp` is untouched: `kirby:*` covers
`kirby:thread:t_14f451b6` exactly as it covers `kirby:read`, and `*` covers
everything. Every consumer keeps the check it already has — that is the reason
this lives in the IdP and not in each app.

## Who holds what

The IdP holds the **grant**. The app holds the **resources**. Neither keeps a
copy of the other's list.

An app declares a resource **type** in its catalog, once, at boot. A type is a
permission prefix plus the URL the IdP can ask for instances:

```json
PUT /api/v1/apps/bender/permissions
{
  "permissions": ["kirby:read", "kirby:write", "dexter:read", "dexter:write"],
  "resourceTypes": [
    {
      "type": "kirby:thread",
      "label": "WhatsApp conversation",
      "list": "https://bender.romo.fyi/idp/resources/kirby-thread"
    }
  ]
}
```

- `permissions` — today's flat catalog, unchanged. Wholesale replace.
- `resourceTypes[].type` — lowercase colon-separated segments
  (`/^[a-z0-9_-]+(:[a-z0-9_-]+)*$/`). A grant composes as `<type>:<id>`. One
  segment is fine: `artifacts` declares `artifacts:<id>`.
- `resourceTypes[].label` — what the console calls one instance. Optional;
  defaults to the type.
- `resourceTypes[].list` — absolute `https` URL (`http` only on `localhost`,
  `127.0.0.1`, `[::1]`). Anything else is `422 {"error":"invalid_resource_type",
  "detail":"<the url>"}`.
- Omitting `resourceTypes` clears them, the same way omitting a permission
  removes it. An app that declares no types is exactly as it was.

The response is the stored catalog: `{"permissions":[…],"resourceTypes":[{type,
label,list}]}`. `GET /api/v1/applications[/{clientId}]` carries `resourceTypes`
too.

The catalog is stored where it always was — `oauth_client.metadata`, now with a
`resource_types` array beside `permissions`. No table, no migration.

## Asking the app

Whenever the IdP needs the instances of a type — a human picking one in the
console, a key being minted for one — it does

```
GET <list>
Authorization: Bearer <jwt>
Accept: application/json
```

and expects

```json
{
  "resources": [
    { "id": "t_14f451b6", "label": "Familia", "description": "group · 1,204 messages · 2026-09-08" }
  ]
}
```

- `id` is the stable, opaque identifier the grant will name — a handle, never
  an alias or a display name. One segment: no colon, no `*`, no whitespace
  (`/^[^\s:*]+$/`). Rows that fail this are dropped with a warning; the rest
  are kept.
- `label` is required; `description` is optional and shows as a second line.
- The whole list, every time. There is no paging or search parameter: the IdP
  filters in the console and checks membership at mint. If a type ever has
  more instances than one response should carry, that is the moment to add
  `?q=`, not before.

The schema is `ResourceListSchema` in `@willyim/idp/schemas`; the app can
`parse` its own response against it in a test.

### The bearer

The JWT is signed by the IdP with its OIDC key — the same key behind `/auth/jwks`
that signs access tokens. Its claims:

| claim | value |
|---|---|
| `iss` | `https://idp.willy.im/auth` (the canonical issuer, whichever host served the request) |
| `aud` | the `list` URL, exactly as declared |
| `sub` | `idp` |
| `exp` | `iat` + 60s |
| `https://willy.im/app` | the app key (`bender`) |
| `https://willy.im/permissions` | `["idp:resources:list"]` |

The app verifies it with what it already uses for MCP:

```ts
import { createResourceServer, RESOURCE_LIST_PERMISSION } from "@willyim/idp"

const listing = createResourceServer({
  issuer: "https://idp.willy.im/auth",
  resource: "https://bender.romo.fyi/idp/resources/kirby-thread", // = the declared `list`
})

// on GET /idp/resources/kirby-thread
const auth = await listing.authenticate(request, { permissions: [RESOURCE_LIST_PERMISSION] })
if (!auth.ok) return new Response(auth.error, { status: auth.status })
return Response.json({ resources: threads.map(t => ({ id: t.handle, label: t.title, description: … })) })
```

Why a signed token and not a shared secret: there is nothing to store. An
app-supplied bearer would have to sit in plaintext in D1 (the IdP must present
it, so it cannot be hashed) and again in the app's env, and the two would rot
apart. A JWT bound to one `aud` and one minute cannot be replayed against the
app's MCP endpoint or anyone else's list URL, and the app's verification path
already exists. `idp:` is reserved as a namespace no app catalog should use.

## Minting

`POST /api/v1/apps/{app}/user-keys` with `scopes` validates every scope:

| scope | outcome |
|---|---|
| in `permissions` | minted |
| `<declared type>:<id>` and the app's list contains `id` | minted, stored as the composed string |
| `<declared type>:<id>` and the list does not contain `id` | `422 {"error":"unknown_resource","detail":["kirby:thread:t_nope"]}` |
| anything else | `422 {"error":"unknown_scopes","detail":["artifacts:abc"]}` |
| the list URL unreachable, non-2xx, or not `{resources:[…]}` | `502 {"error":"resource_lookup_failed","detail":["kirby:thread"]}` |

Structure is checked first, with no network; the list is fetched once per type
that appears in the request, and only then. Scopes are trimmed and deduplicated,
never silently dropped — a grant that quietly lost a scope is worse than one
that failed loudly.

Member grants from the console go through the same check: the picker offers
only what the app listed, and the action re-validates before writing.
`POST/PATCH /api/v1/apps/{app}/members…` carries IdP-management permissions
only, as before; product grants over the API are not a thing this change adds.

## What an admin holds

An app admin's claim is the flat catalog plus `<type>:*` for every declared
type — `["kirby:read", …, "kirby:thread:*"]`. Instances are the app's to
enumerate, so the wildcard is the honest value: an admin is never handed a
list that silently misses the conversation created five minutes ago, and
`grants()` already expands it.

## When an instance disappears

The grant stays. `productPermissionsFor` — the function behind every claim and
every identity resolution — checks that a stored grant is still **declared**
(a flat entry that is still in the catalog, or `<type>:<id>` under a type that
is still declared). It does not ask the app whether `id` still exists: that
would make every token mint depend on a third party being up, which is the
one dependency an IdP must not have.

So a key holding `kirby:thread:t_gone` keeps holding it, and on the app's side
the ref no longer resolves to that handle, so the grant matches nothing.
Revoking it is the IdP's job and the console's: the picker shows such grants
as checked with "(no longer listed)", and unchecking them is the removal.
Undeclaring the type is the bulk version — every grant under it drops out of
the claim at once, exactly as a removed flat permission does today.

## Where the code is

| | |
|---|---|
| Catalog storage and the one serializer | `app/lib/metadata.ts` |
| Classifying a scope, resolving a grant | `app/lib/scopes.server.ts` |
| Asking the app, and the listing token | `app/lib/resources.server.ts` |
| The claim (admins → `type:*`, members filtered by declaration) | `app/lib/claims.server.ts` `productPermissionsFor` |
| Minting | `app/lib/user-api-keys.server.ts` `createUserApiKey` |
| The catalog PUT | `app/routes/api/apps.$app.permissions.ts` |
| The console picker and its JSON route | `app/routes/app/app-detail.tsx`, `app/routes/app/app-resources.ts` |
| The wire schemas every consumer imports | `packages/idp-client/src/schemas/index.ts` |
