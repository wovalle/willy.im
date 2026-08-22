import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/login.verify.tsx"),
  route("invite/accept", "routes/invite.accept.tsx"),
  route("impersonation/stop", "routes/impersonation.stop.ts"),
  route("consent", "routes/consent.tsx"),
  route("auth/*", "routes/auth/auth.$.ts"),

  // RFC 8414 root-level metadata (issuer path suffixed), proxied to basePath.
  route(".well-known/oauth-authorization-server/auth", "routes/well-known/oauth-as.ts"),
  route(".well-known/openid-configuration/auth", "routes/well-known/openid.ts"),

  // Authenticated console at the root. Admins see Applications + Users;
  // everyone gets Account. Logged-out visitors are redirected to /login.
  route("", "routes/app/layout.tsx", [
    index("routes/app/applications.tsx"),
    route("apps/:clientId", "routes/app/app-detail.tsx"),
    route("users", "routes/app/users.tsx"),
    route("account", "routes/app/account.tsx"),
  ]),

  // Management API (Bearer: an IdP-level admin key or a per-app scoped key) + docs.
  // Cross-app reads (superadmin only):
  route("api/v1/applications", "routes/api/applications.ts"),
  // Application lifecycle — registration, patch, delete, secret rotation. Every
  // one is bearer-drivable, so an agent can stand an app up without a browser.
  route("api/v1/applications/:clientId", "routes/api/applications.$clientId.ts"),
  route(
    "api/v1/applications/:clientId/rotate-secret",
    "routes/api/applications.$clientId.rotate-secret.ts",
  ),
  // IdP-level admin keys — named, expiring, revocable superadmin credentials.
  // One per agent, so the audit log names who acted. These are the only way to
  // reach a cross-app endpoint.
  route("api/v1/admin-keys", "routes/api/admin-keys.ts"),
  route("api/v1/admin-keys/:id", "routes/api/admin-keys.$id.ts"),
  route("api/v1/users", "routes/api/users.ts"),
  // Linked identities — a user's ids on other systems (Slack, WhatsApp…).
  // Linking is superadmin-only; resolving is app-scoped, below.
  route("api/v1/users/:userId/identities", "routes/api/users.$userId.identities.ts"),
  route("api/v1/users/:userId/identities/:id", "routes/api/users.$userId.identities.$id.ts"),
  route("api/v1/workspaces", "routes/api/workspaces.ts"),
  // Per-app writes/reads (scoped-key authenticated, permission-checked):
  route("api/v1/apps/:app/members", "routes/api/apps.$app.members.ts"),
  route("api/v1/apps/:app/members/:userId", "routes/api/apps.$app.members.$userId.ts"),
  route("api/v1/apps/:app/workspaces", "routes/api/apps.$app.workspaces.ts"),
  route("api/v1/apps/:app/audit", "routes/api/apps.$app.audit.ts"),
  route("api/v1/apps/:app/permissions", "routes/api/apps.$app.permissions.ts"),
  // Scoped management keys for this app:
  route("api/v1/apps/:app/keys", "routes/api/apps.$app.keys.ts"),
  route("api/v1/apps/:app/keys/:id", "routes/api/apps.$app.keys.$id.ts"),
  // End-user API keys for the app's own API (minted + validated by the IdP):
  route("api/v1/apps/:app/user-keys", "routes/api/apps.$app.user-keys.ts"),
  route("api/v1/apps/:app/user-keys/validate", "routes/api/apps.$app.user-keys.validate.ts"),
  route("api/v1/apps/:app/user-keys/:id", "routes/api/apps.$app.user-keys.$id.ts"),
  // "Who is <slack id>, and what may they do in this app?" (identity:resolve)
  route(
    "api/v1/apps/:app/identities/:provider/:externalId",
    "routes/api/apps.$app.identities.$provider.$externalId.ts",
  ),
  route("api/openapi.json", "routes/api/openapi.ts"),
  route("api/docs", "routes/api/docs.tsx"),
] satisfies RouteConfig
