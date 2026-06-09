import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/login.verify.tsx"),
  route("consent", "routes/consent.tsx"),
  route("auth/*", "routes/auth/auth.$.ts"),

  // RFC 8414 root-level metadata (issuer path suffixed), proxied to basePath.
  route(".well-known/oauth-authorization-server/auth", "routes/well-known/oauth-as.ts"),
  route(".well-known/openid-configuration/auth", "routes/well-known/openid.ts"),

  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/applications.tsx"),
    route("users", "routes/admin/users.tsx"),
    route("workspaces", "routes/admin/workspaces.tsx"),
  ]),

  // Management API (Bearer ADMIN_API_TOKEN) + OpenAPI docs.
  route("api/v1/applications", "routes/api/applications.ts"),
  route("api/v1/users", "routes/api/users.ts"),
  route("api/v1/workspaces", "routes/api/workspaces.ts"),
  route("api/openapi.json", "routes/api/openapi.ts"),
  route("api/docs", "routes/api/docs.tsx"),
] satisfies RouteConfig
