# @willyim/idp

Login for apps that don't own identity.

The [willy.im IdP](https://idp.willy.im) is the single source of truth for who
someone is and what they may do. An app installing this package runs no auth
framework: it owns one session table, which is a _handle_ to IdP truth rather
than a record of it. No user table, no account table, no `ADMIN_EMAILS` list.

`zod` is the one runtime dependency: every payload the IdP sends — discovery,
tokens, claims, management API responses — is parsed against a schema rather
than cast, so a malformed response is an `IdpError` naming the field instead of
a `TypeError` several frames later. Otherwise it is `fetch`, WebCrypto and
`Request`/`Response` only, so the same build runs on Cloudflare Workers,
Node 20+ and Bun.

```
@willyim/idp                core: OIDC client + server sessions
@willyim/idp/drizzle        the session store, and the `idp_session` table
@willyim/idp/react-router   the auth route and the loader guards
@willyim/idp/schemas        the management API wire shapes, as zod schemas
```

## Install

```sh
npm install @willyim/idp
```

`drizzle-orm` is an optional peer dependency, needed only by the `/drizzle`
subpath. The `/react-router` subpath imports nothing at all — it just produces
`Response`s.

## Standard installation

Four touch-points: a factory, a context wire-up, one route, one migration.

**`app/lib/idp.server.ts`**

```ts
import { createIdp } from "@willyim/idp"
import { drizzleSessions } from "@willyim/idp/drizzle"

import * as schema from "~/db/schema"

export function getIdp(env: AppEnv, db: AppDb) {
  return createIdp({
    issuer: "https://idp.willy.im/auth",
    clientId: env.IDP_CLIENT_ID,
    clientSecret: env.IDP_CLIENT_SECRET,
    sessions: drizzleSessions(db, schema.idpSession),
    session: { secret: env.SESSION_SECRET, expiresIn: "30d" },
  })
}

export type Idp = ReturnType<typeof getIdp>
```

**`app/db/schema.ts`** — re-export the table so `drizzle-kit generate` sees it:

```ts
export { idpSession } from "@willyim/idp/drizzle"
```

**`workers/app.ts`** — built once per request, injected via load context:

```ts
const idp = getIdp(appEnv, db)
const session = await idp.getSession(request)

return requestHandler(request, {
  env,
  cloudflare: { env, ctx },
  db,
  services,
  idp,
  getSession: async () => {
    if (!session) return null
    const local = await db.query.owners.findFirst({ where: { email: session.email } })
    return { sessionUser: session, currentUser: local ?? null, isAdmin: session.can("admin") }
  },
})
```

**`app/routes/auth.$.tsx`** — serves `/auth/login`, `/auth/callback`, `/auth/logout`:

```ts
import { createAuthRoute } from "@willyim/idp/react-router"

const authRoute = createAuthRoute(({ context }) => context.idp)

export const loader = authRoute.loader
export const action = authRoute.action
```

Export the two handlers separately rather than destructuring in the `export`
statement. `export const { loader, action } = …` works in dev but fails the
production build — react-router's route-exports plugin strips server-only
exports from the client bundle and cannot remove a destructured one
("Cannot remove destructured export").

Then guard whatever needs guarding:

```ts
import { requirePermission, requireSession } from "@willyim/idp/react-router"

export async function loader(args: Route.LoaderArgs) {
  const session = await requireSession(args) // redirects to login, preserves ?next=
  const admin = await requirePermission(args, "admin") // 403 without it
}
```

## Env

| Var                                   | Purpose                  |
| ------------------------------------- | ------------------------ |
| `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` | OIDC handshake           |
| `SESSION_SECRET`                      | signs the session cookie |

Register `https://your-app/auth/callback` as a redirect URI in the IdP console.

## How a session works

The cookie holds an **HMAC-signed opaque session id**. The signature is checked
before the store is touched, so a junk cookie never costs a query. Everything
else is in the row.

`getSession`:

```
verify cookie signature      -> invalid/absent: null
load row                     -> missing/expired: null
now - syncedAt < freshness   -> return as-is                  (common path, one read)
otherwise                    -> userinfo(accessToken)
    access token expired     -> refresh first
    401                      -> refresh, retry once
    refresh fails            -> delete row, return null       (revoked at the IdP)
    IdP unreachable          -> serve cached claims, retry next request
    ok                       -> update claims + syncedAt, return
```

Permissions are a TTL-cached projection, not a login-time snapshot. A permission
revoked at the IdP stops granting access within the freshness window — minutes,
not session-lengths. The per-freshness `/userinfo` call doubles as a liveness
ping, which is how revocation reaches the app.

Instant revocation is a row delete: `idp.destroyAllSessions(sub)` logs a subject
out of every browser on their next request.

## Session lifetimes

| Setting             | Default | Meaning                                                          |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `expiresIn`         | `7d`    | idle timeout; slides on use                                      |
| `updateAge`         | `1d`    | how far into its life a session must be before the expiry slides |
| `freshness`         | `5m`    | how long cached claims are trusted                               |
| `absoluteExpiresIn` | —       | hard cap measured from login                                     |

When the IdP advertises a per-app ceiling (`session_max_age` in its discovery
document), a longer `expiresIn` is clamped to it with a warning in development.
No ceiling advertised, no clamp.

Sliding the row past the browser cookie's own `Max-Age` needs one line: when the
expiry moves, `session.renewCookie()` returns the `Set-Cookie` to attach.

```ts
const session = await idp.getSession(request)
const renew = session?.renewCookie()
if (renew) response.headers.append("set-cookie", renew)
```

## API

### `createIdp(options)`

```ts
idp.getSession(request): Promise<Session | null>
idp.startLogin({ redirectUri, next?, prompt?, loginHint? }): Promise<{ url, headers }>
idp.completeLogin(request, { redirectUri }): Promise<{ session, headers, next }>
idp.destroySession(request): Promise<Headers>
idp.destroyAllSessions(sub): Promise<void>
idp.logout(request, { redirectTo?, idpLogout? }): Promise<{ headers, url }>
idp.client: IdpClient
```

`Session` carries claims and never tokens, so it is safe to project into loader
data:

```ts
type Session = {
  id: string
  sub: string
  email: string
  name: string | null
  image: string | null
  permissions: string[]
  workspaces: { id; slug; name; domain; role }[]
  actor: { sub; email? } | null // RFC 8693 `act` — audit only, never authorize on it
  createdAt: Date
  expiresAt: Date
  can(permission: string): boolean
  renewCookie(): string | null
}
```

`can()` matches exactly, and honours `resource:*` and `*` grants.

### `createIdpClient(options)` — the OIDC relying party on its own

```ts
client.authorizationUrl({ redirectUri, state, codeChallenge, scopes?, prompt? }): Promise<string>
client.exchangeCode({ code, redirectUri, codeVerifier }): Promise<Tokens>
client.refresh(refreshToken): Promise<Tokens>
client.userinfo(accessToken): Promise<Claims>
client.logoutUrl({ idToken, redirectTo }): Promise<string | null>
client.discover(): Promise<Discovery>
```

Discovery is derived from `issuer` and memoized per instance. PKCE is not
optional. `Claims` arrive with the `https://willy.im/*` namespace unwrapped —
`claims.permissions`, not `claims["https://willy.im/permissions"]`.

### `@willyim/idp/drizzle`

```ts
idpSession                        // the SQLite/D1 table, named `idp_session`
idpSessionSqliteTable(name?)      // …under another name
idpSessionPgTable(name?)          // the Postgres equivalent
drizzleSessions(db, table)        // -> SessionStore
```

### Session stores

`SessionStore` is five methods, so swapping drizzle out is not a project:

```ts
type SessionStore = {
  get(id): Promise<SessionRecord | null>
  create(record): Promise<SessionRecord>
  update(id, patch): Promise<SessionRecord | null>
  delete(id): Promise<void>
  deleteBySub(sub): Promise<void>
}
```

`memorySessions()` ships for tests and single-process development.

## Logout

`/auth/logout` destroys the local session _first_, then redirects to the IdP's
`end_session_endpoint` (read from discovery, never hardcoded) so the SSO session
ends too. If that endpoint is unavailable the visitor simply lands back on the
app — logout never leaves anyone signed in locally.

RP-initiated logout needs the OAuth client registered for it at the IdP:

- `enable_end_session` must be set, or the IdP answers `401 invalid_client`.
- your post-logout URL must be listed in `post_logout_redirect_uris`, or the IdP
  ends the session and leaves the visitor there.

Until both are configured, pass `idpLogout: false` to `createAuthRoute` to keep
logout app-local.

## Testing

Inject `fetch` and use the in-memory store; nothing needs the network.

```ts
const idp = createIdp({
  issuer: "https://idp.test/auth",
  clientId: "test",
  clientSecret: "test",
  fetch: stubbedFetch,
  sessions: memorySessions(),
  session: { secret: "test", secure: false },
  now: () => clock, // the clock every session decision reads
})
```

## End-user API keys

Keys an app's own users create to call *that app's* API. The IdP is the key
store: the app mints, lists, revokes and validates `wak_…` tokens over the
management API and never persists a plaintext or a hash.

```ts
import { createUserKeys } from "@willyim/idp"

const keys = createUserKeys({
  baseUrl: "https://idp.willy.im", // the API is at the root, not under /auth
  token: env.IDP_MANAGEMENT_KEY, //  the app's own wim_… key
  app: "luchy",
  cache: { ttlMs: 60_000 }, // validation cache; revocation lag is bounded by it
})

// Mint — the plaintext exists exactly once, in this response.
const minted = await keys.create({
  userId: session.userId,
  name: "cli",
  scopes: ["analytics:read"], // must be in the app's product permission catalog
  workspaceId: session.workspaceId,
})

// Check, on the request path.
const auth = await keys.authenticate(request, { scopes: ["analytics:read"] })
if (!auth.ok) return new Response(auth.reason, { status: auth.status })
auth.key // { keyId, userId, workspaceId, scopes, name }
```

`authenticate` reads `Authorization: Bearer …`, then `X-API-Key`, and returns a
result rather than throwing so the caller owns the response shape. Underneath,
`validate` caches verdicts by digest of the token (60s for a hit, 10s for a
miss, never for a failed round trip) and collapses concurrent checks of the same
token into one request. Revoking through some other channel is visible only once
the entry expires; `forget(token)` drops it immediately when you hold the
plaintext.

Filter with `list({ userId, workspaceId })`, revoke with `revoke(id)`. Scope
enforcement is the app's job — the IdP stores the scopes and reports them.

Only for **secret** credentials. A key embedded in a web page — an analytics
ingest token, say — identifies a site rather than a user, cannot be kept secret,
and must not pay a round trip per hit. Keep those in the app's own table and
gate them on `Origin` plus rate limiting.

## Management API types

Endpoints without sugar of their own go through `createManagementApi`, whose
paths, methods, path parameters, bodies and response shapes all come from the
operations table in `@willyim/idp/schemas` — one zod definition per shape,
which also builds `openapi/idp-api.json` (`npm run openapi`) and which the IdP
itself validates incoming requests with. A typo in a path is a compile error,
not a 404 in production, and a response that doesn't match its schema throws
instead of reaching your code as `undefined`.

```ts
const api = createManagementApi({ baseUrl, token })
const { members } = await api.request("get", "/api/v1/apps/{app}/members", {
  params: { app: "luchy" },
})
```

### Admin keys

Most management endpoints take a scoped `wim_` key, which is bound to one
application and carries an explicit permission set. IdP-level work — registering
an application, listing users across apps — needs superadmin instead, and for
that there are **admin keys**: `/api/v1/admin-keys` mints a named, optionally
expiring, revocable credential that holds every permission on every app. Mint
one per agent, so the audit trail records `adminkey:<id>` rather than an
anonymous shared secret, and revoke it when that agent is done.

```ts
const { token } = await api.request("post", "/api/v1/admin-keys", {
  body: { name: "release-bot", expiresAt: "2026-12-31T00:00:00.000Z" },
})
// Shown exactly once. Presented like any other key:
//   Authorization: Bearer wim_…
```

There is no static superadmin secret: every bearer the IdP accepts is a key row
it issued, so every superadmin action names a revocable credential.

**Break-glass.** If every admin key is lost, recover by writing one bootstrap
key straight into D1 — insert an `api_key` row with `application_id` NULL and
`key_hash` set to the SHA-256 hex digest of a token you generate — then use it
to mint a real key via `POST /api/v1/admin-keys` and revoke the bootstrap row
through `DELETE /api/v1/admin-keys/{id}`.

The OIDC endpoints are not in that document and never will be: they are
standards-defined and discovered at runtime from `.well-known`.

## Licence

MIT
