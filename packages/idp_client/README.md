# @willyim/idp-client

Client for the willy.im IdP. Zero dependencies, web standards only — runs on
Cloudflare Workers, Node ≥20, Bun. Until the package is published, vendor
`src/index.ts` into your app as a single file.

## Setup

Register your app in the IdP admin console (https://idp.willy.im), note the
client id/secret, and — if you use end-user API keys — mint a scoped `wim_`
management key with the `userkey:*` permissions.

```ts
import { createIdpClient } from "@willyim/idp-client"

const idp = createIdpClient({
  issuer: "https://idp.willy.im",        // or a vanity domain: https://idp.kasso.do
  clientId: env.IDP_CLIENT_ID,
  clientSecret: env.IDP_CLIENT_SECRET,
  app: "invoices",                       // your app key
  managementKey: env.IDP_MANAGEMENT_KEY, // only for userKeys.*
})
```

## Login (plain web-standards flow)

```ts
// /auth/login — redirect to the IdP
const { url, state, codeVerifier } = await idp.authorizationUrl({
  redirectUri: "https://app.example.com/auth/callback",
})
// persist state + codeVerifier in an HttpOnly cookie, then redirect to url

// /auth/callback — exchange the code
const { tokens, claims } = await idp.exchangeCode({ code, redirectUri, codeVerifier })
// claims.sub / claims.email / claims.workspaces / claims.permissions / claims.act
// set your own session cookie; you own sessions, the IdP owns identity
```

### Better Auth apps

If your app already uses Better Auth, point its `genericOAuth` plugin at the
IdP instead of using the manual flow:

```ts
genericOAuth({
  config: [{
    providerId: "willyim",
    clientId: env.IDP_CLIENT_ID,
    clientSecret: env.IDP_CLIENT_SECRET,
    discoveryUrl: "https://idp.willy.im/.well-known/openid-configuration",
    scopes: ["openid", "profile", "email"],
  }],
})
```

Then use `idp.decodeIdToken(...)` / `idp.userinfo(...)` for the typed claims.

## Claims

- `claims.workspaces` — the user's workspaces in *your* app: `{ id, slug, name, domain, role }`.
- `claims.permissions` — product permissions from your app's catalog.
- `claims.act` — set while an IdP admin is impersonating the user. **Log it,
  don't act on it**: `logger.info("action", { actor: claims.act?.sub })`.
  The id_token carries the login-time value; `idp.userinfo(accessToken)`
  reports it live per-request.

Multi-domain apps resolve the active tenant by host:

```ts
const ws = idp.workspaceForHost(claims, new URL(request.url).host)
```

## End-user API keys

Your users' keys for *your* API, stored and validated by the IdP:

```ts
// settings page: mint (plaintext shown once)
const { token } = await idp.userKeys.create({ userId, name: "CI key", scopes: ["invoices:read"] })

// your API middleware: validate (cache hits briefly — it's a network call)
const v = await idp.userKeys.validate(bearerToken)
if (!v.valid) return new Response("unauthorized", { status: 401 })
// v.userId, v.workspaceId, v.scopes
```

## Notes

- `exchangeCode` decodes the id_token without a JWKS signature check: the
  token arrives over TLS directly from the token endpoint, authenticated with
  the client secret, where OIDC core makes verification optional. If you pass
  id_tokens across trust boundaries, verify against
  `{issuer}/auth/oauth/jwks` first.
- Sessions stay yours. The IdP authenticates; your app authorizes and keeps
  its own cookie.
