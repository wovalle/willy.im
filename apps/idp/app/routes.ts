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

  // Management API (Bearer: superadmin ADMIN_API_TOKEN or scoped API key) + docs.
  // Cross-app reads (superadmin only):
  route("api/v1/applications", "routes/api/applications.ts"),
  route("api/v1/users", "routes/api/users.ts"),
  route("api/v1/workspaces", "routes/api/workspaces.ts"),
  // Per-app writes/reads (scoped-key authenticated, permission-checked):
  route("api/v1/apps/:app/members", "routes/api/apps.$app.members.ts"),
  route("api/v1/apps/:app/members/:userId", "routes/api/apps.$app.members.$userId.ts"),
  route("api/v1/apps/:app/workspaces", "routes/api/apps.$app.workspaces.ts"),
  route("api/v1/apps/:app/audit", "routes/api/apps.$app.audit.ts"),
  route("api/openapi.json", "routes/api/openapi.ts"),
  route("api/docs", "routes/api/docs.tsx"),
] satisfies RouteConfig
