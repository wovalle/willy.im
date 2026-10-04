import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/login.verify.tsx"),
  route("invite/accept", "routes/invite.accept.tsx"),
  // Self-service identity linking. Public entry point (it bounces to /login),
  // because the whole point is that bender can hand the URL to someone it does
  // not know yet.
  route("link/discord", "routes/link.discord.tsx"),
  route("impersonation/stop", "routes/impersonation.stop.ts"),
  route("consent", "routes/consent.tsx"),
  route("auth/*", "routes/auth/auth.$.ts"),

  // Every user's avatar, seeded on their id. Public and database-free — see the
  // route. This is what the `picture` claim points at when nobody uploaded one.
  route("avatar/:seed", "routes/avatar.$seed.ts"),

  // RFC 8414 root-level metadata (issuer path suffixed), proxied to basePath.
  route(".well-known/oauth-authorization-server/auth", "routes/well-known/oauth-as.ts"),
  route(".well-known/openid-configuration/auth", "routes/well-known/openid.ts"),

  // Authenticated console at the root. Admins see Applications + Users;
  // everyone gets Account. Logged-out visitors are redirected to /login.
  route("", "routes/app/layout.tsx", [
    index("routes/app/applications.tsx"),
    route("apps/:clientId", "routes/app/app-detail.tsx"),
    // JSON: the instances of one declared resource type, read live from the app.
    // Backs the console's per-instance grant picker.
    route("apps/:clientId/resources", "routes/app/app-resources.ts"),
    route("users", "routes/app/users.tsx"),
    route("users/:userId", "routes/app/user-detail.tsx"),
    route("account", "routes/app/account.tsx"),
  ]),
] satisfies RouteConfig
