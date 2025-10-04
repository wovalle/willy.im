import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/index/index.page.tsx"),
  route("posts", "routes/posts/route.tsx"),
  route("posts/:slug", "routes/posts/posts.$slug.tsx"),
  route("auth/login", "routes/auth/login.tsx"),
  route("auth/*", "routes/auth/auth.$.ts"),
  route("cron/update", "routes/cron/update.ts"),
  route("about", "routes/about.tsx"),
  route("privacy", "routes/privacy.tsx"),
] satisfies RouteConfig
