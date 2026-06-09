import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/login.verify.tsx"),
  route("consent", "routes/consent.tsx"),
  route("auth/*", "routes/auth/auth.$.ts"),
] satisfies RouteConfig
