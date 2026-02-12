import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  route("", "routes/_layout.tsx", [
    index("routes/index/index.page.tsx"),
    route("posts", "routes/posts/route.tsx"),
    route("posts/:slug", "routes/posts/posts.$slug.tsx"),
    route("login", "routes/auth/login.tsx"),
    route("auth/*", "routes/auth/auth.$.ts"),
    route("cron/update", "routes/cron/update.ts"),
    route("about", "routes/about.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("links/onlyfans", "routes/links.onlyfans.tsx"),
    route("sitemap.xml", "routes/sitemap.xml.ts"),
  ]),
  route("33", "routes/33/route.tsx"),
  route("axs", "routes/axs/route.tsx"),
  route("links", "routes/links.tsx"),
] satisfies RouteConfig
