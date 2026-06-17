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
    route("terms", "routes/terms.tsx"),
    route("links/onlyfans", "routes/links.onlyfans.tsx"),
    route("sitemap.xml", "routes/sitemap.xml.ts"),
    route("calendar", "routes/calendar.ts"),
    route("notes", "routes/notes/list.tsx"),
    route("notes/new", "routes/notes/new.tsx"),
    route("notes/:id", "routes/notes/view.tsx"),
    route("notes/:id/edit", "routes/notes/edit.tsx"),
  ]),
  route("links", "routes/links.tsx"),
] satisfies RouteConfig
