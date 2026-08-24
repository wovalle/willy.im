# idp — one identity for all my apps

`idp.willy.im` is a standards-based **OAuth 2.1 / OpenID Connect provider**. Apps
add "Sign in with willy.im" instead of building their own auth, and the IdP owns
the user's identity, profile, and access. The goal: **delete account-handling code
from every other project** and centralize it here.

React Router 7 + Cloudflare Workers + D1 + Better Auth.

## Principles

- **One user store, many apps.** A person has a single willy.im identity across
  every app — never per-app accounts.
- **Authentication is central; authorization is per-app.** Anyone can prove who
  they are; each application decides who gets in and what they can do.
- **The application is the boundary.** Each app owns its admins, members,
  workspaces, settings, branding, and its own domain. No separate
  "organization" tier until a tenant needs to own multiple apps.
- **Permissions, not hardcoded roles.** Apps declare a permission catalog; the IdP
  resolves a user's permissions and emits them as token claims; the app enforces.
- **Tenant resolution by hostname, never query params.**

## Roles

- **Superadmin** — an IdP-level concept (currently a static allowlist: `hey@willy.im`).
  Manages every app.
- **App admin** — created automatically for whoever creates an app; can be granted
  to others. Has all permissions *for that app* (manage workspaces, members,
  settings, OAuth secret) and can impersonate that app's users.
- **App member** — granted specific permissions from the app's catalog.

## Domain model

```
Application (e.g. app1)
├── settings        allowSignup, branding, user-metadata
├── members         (user, role: admin | member, permissions[])
├── workspaces      collaboration boundaries within the app → members
├── oauth client    client_id / secret / redirect_uris
└── domain          idp.app1.com → resolves to this app
User (global)
├── profile         name, avatar, email — edited at the IdP, read by apps
└── app metadata    per-app free-form JSON
```

## What an app gets

- **SSO** via OIDC (`/.well-known/openid-configuration`).
- **Identity + profile**: `id_token` claims + `userinfo`, plus a server-to-server
  profile API. A "Manage profile" link sends users to the IdP and back.
- **An avatar for every user.** `picture` is always populated: the user's own
  image, or a deterministic [blobatar](https://blobatar.dev) the IdP renders at
  `/avatar/:seed`. No app needs a fallback of its own.
- **Per-app workspace + role + permission claims**, scoped to the requesting app.
  A user may belong to multiple workspaces in an app; the token includes *all* of
  them as an array (`https://willy.im/workspaces`), filtered to the requesting app
  only — workspaces from other apps are never visible. The app picks the active
  workspace from the array at request time (by subdomain, URL param, stored
  preference, etc.) without needing a new token.
- **`permissions[]` claim**: a static catalog of permission strings declared by the
  app. The IdP resolves each user's granted permissions and emits them as a
  `permissions` array in the token. Apps enforce access against this list (see
  `@willyim/rbac`).
- **API keys** with scoped permissions — machine-readable keys the IdP issues on
  behalf of a workspace or user. Carry the same `permissions[]` model as tokens,
  so they can fully replace app-managed key systems (e.g. tracker ingestion keys).
- A management API (OpenAPI) so agents can provision users/workspaces on your behalf.

The client side of all this is [`@willyim/idp`](../../packages/idp-client/README.md) —
OIDC client, server sessions, and react-router guards, with no runtime deps.

## Custom domains

`idp.willy.im` is the one canonical IdP. A per-app domain (e.g. `idp.app1.com`) is
not a separate identity store — it's the same IdP served under the app's own
origin so its session cookie is **first-party** (no third-party-cookie blocking).
Setup lives in [`docs/custom-domains.md`](docs/custom-domains.md). Two consequences
to design around:

- **Claim keys are host-independent.** Custom claims use a fixed `willy.im`
  namespace (e.g. `https://willy.im/workspaces`), never the issuer host. The key
  is a unique identifier, not a URL that's fetched, so it must stay constant no
  matter which front served the token. Only `iss` reflects the actual host (clients
  validate JWKS/discovery against it).
- **Cookies are per-domain, so SSO is per-domain.** A session on `idp.app1.com` is
  a separate cookie jar from `idp.willy.im`. The trade is deliberate: first-party
  cookies per app, at the cost of a shared sign-in not carrying across custom
  domains. The OIDC flow itself is unaffected. To get both first-party cookies and
  cross-app SSO later, the custom-domain fronts would silently authorize against a
  canonical `idp.willy.im` session (`prompt=none`) — deferred.

## Status

Built: email (magic-link + OTP) and passkey sign-in · OIDC provider
(authorize/token/userinfo/JWKS, RFC 8414 metadata) · per-app workspaces with
role claims · admin console (apps, users, workspaces, app detail) · read-only
management API + OpenAPI · client-secret rotation · custom domains.

In progress: `rbac`-backed security context · app admins/members + invitations ·
per-app user metadata · API keys with scoped permissions + write management API ·
audit · impersonation.

Later: centralized profile editing · MFA · Organizations tier · SAML / SCIM.

See the [epic](https://github.com/wovalle/willy.im/issues/33).

## Develop

```bash
npm run dev --workspace=idp
npm run test --workspace=idp
npm run db:migrate --workspace=idp     # apply migrations to the local D1
```

Bindings and vars are in `wrangler.jsonc`; `app/lib/env.ts` is the parsed,
validated view of them.
