# willy.im

Monorepo for willy.im — the personal website and **idp**, a self-hosted identity
provider that powers sign-in for every willy.im project.

## idp — one identity for all my apps

`idp.willy.im` is a standards-based **OAuth 2.1 / OpenID Connect provider**. Apps
add "Sign in with willy.im" instead of building their own auth, and the IdP owns
the user's identity, profile, and access. The goal: **delete account-handling code
from every other project** and centralize it here.

### Principles

- **One user store, many apps.** A person has a single willy.im identity across
  every app — never per-app accounts.
- **Authentication is central; authorization is per-app.** Anyone can prove who
  they are; each application decides who gets in and what they can do.
- **The application is the boundary.** Each app owns its admins, members,
  workspaces, settings, branding, and (later) its own domain. No separate
  "organization" tier until a tenant needs to own multiple apps.
- **Permissions, not hardcoded roles.** Apps declare a permission catalog; the IdP
  resolves a user's permissions and emits them as token claims; the app enforces.
- **Tenant resolution by hostname, never query params.**

### Roles

- **Superadmin** — an IdP-level concept (currently a static allowlist: `hey@willy.im`).
  Manages every app.
- **App admin** — created automatically for whoever creates an app; can be granted
  to others. Has all permissions *for that app* (manage workspaces, members,
  settings, OAuth secret) and can impersonate that app's users.
- **App member** — granted specific permissions from the app's catalog.

### Domain model

```
Application (e.g. kasso)
├── settings        allowSignup, branding, user-metadata
├── members         (user, role: admin | member, permissions[])
├── workspaces      collaboration boundaries within the app → members
├── oauth client    client_id / secret / redirect_uris
└── domain          (later) idp.kasso.do → resolves to this app
User (global)
├── profile         name, avatar, email — edited at the IdP, read by apps
└── app metadata    per-app free-form JSON
```

### What an app gets

- **SSO** via OIDC (`/.well-known/openid-configuration`).
- **Identity + profile**: `id_token` claims + `userinfo`, plus a server-to-server
  profile API. A "Manage profile" link sends users to the IdP and back.
- **Per-app workspace + role + permission claims**, scoped to the requesting app.
  A user may belong to multiple workspaces in an app; tokens are always scoped to
  one workspace — the app resolves which (via a `workspace_id` authorize param or
  a post-login selection screen) before requesting the token.
- **`permissions[]` claim**: a static catalog of permission strings declared by the
  app. The IdP resolves each user's granted permissions and emits them as a
  `permissions` array in the token. Apps enforce access against this list (see
  `@willyim/rbac`).
- **API keys** with scoped permissions — machine-readable keys the IdP issues on
  behalf of a workspace or user. Carry the same `permissions[]` model as tokens,
  so they can fully replace app-managed key systems (e.g. tracker ingestion keys).
- A management API (OpenAPI) so agents can provision users/workspaces on your behalf.

## Status

Built: email (magic-link + OTP) and passkey sign-in · OIDC provider
(authorize/token/userinfo/JWKS, RFC 8414 metadata) · per-app workspaces with
role claims · admin console (apps, users, workspaces, app detail) · read-only
management API + OpenAPI · client-secret rotation.

In progress: `rbac`-backed security context · app admins/members + invitations ·
per-app user metadata · API keys with scoped permissions + write management API ·
audit · impersonation.

Later: centralized profile editing · custom domains (`idp.kasso.do`) · MFA ·
Organizations tier · SAML / SCIM.

See the [epic](https://github.com/wovalle/willy.im/issues/33).

## Layout

```
apps/
  www/    the willy.im website (React Router 7 + Cloudflare Workers)
  idp/    the identity provider (React Router 7 + Cloudflare Workers + D1 + Better Auth)
packages/
  rbac/                 permission catalog + checker (define-permissions, superadmin)
  drizzle_repositories/ generic Drizzle repository layer
  drizzle_audit/        audit logging via DB triggers
  butler/               Telegram / intent utilities
```

## Develop

```bash
npm install
npm run dev --workspace=www   # the website
npm run dev --workspace=idp   # the identity provider
```

Each app is a Cloudflare Worker; see its `README` and `wrangler.jsonc`.
