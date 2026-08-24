# willy.im

Monorepo for willy.im — the personal website and **idp**, a self-hosted identity
provider that powers sign-in for every willy.im project.

Each app is a Cloudflare Worker; see its own `README` and `wrangler.jsonc`.

## Layout

```
apps/
  www/    the willy.im website (React Router 7 + Cloudflare Workers)
  idp/    the identity provider (React Router 7 + Cloudflare Workers + D1 + Better Auth)
packages/
  idp-client/           @willyim/idp — OIDC client, sessions, react-router guards
  rbac/                 permission catalog + checker (define-permissions, superadmin)
  drizzle_repositories/ generic Drizzle repository layer
  drizzle_audit/        audit logging via DB triggers
  butler/               Telegram / intent utilities
```

## idp

`idp.willy.im` is a standards-based OAuth 2.1 / OpenID Connect provider. Apps add
"Sign in with willy.im" instead of building their own auth, so account-handling
code is deleted from every other project and centralized here.

The design — principles, roles, the domain model, what an app actually gets, and
custom domains — is in **[`apps/idp/README.md`](apps/idp/README.md)**. The client
library apps install is **[`@willyim/idp`](packages/idp-client/README.md)**.

## Develop

```bash
npm install
npm run dev --workspace=www   # the website
npm run dev --workspace=idp   # the identity provider
```
