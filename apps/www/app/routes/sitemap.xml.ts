import { allPosts } from "content-collections"
import type { Route } from "./+types/sitemap.xml"
import { siteConfig } from "~/static"

export const loader = async ({ request }: Route.LoaderArgs) => {
  const baseUrl = siteConfig.url

  const staticPages = [
    { path: "/", priority: "1.0", changefreq: "weekly" as const },
    { path: "/posts", priority: "0.9", changefreq: "weekly" as const },
    { path: "/about", priority: "0.8", changefreq: "monthly" as const },
    { path: "/privacy", priority: "0.5", changefreq: "yearly" as const },
  ]

  const postPages = allPosts.map((post) => ({
    path: `/posts/${post._meta.path}`,
    priority: "0.7",
    changefreq: "monthly" as const,
    lastmod: post.updatedAt ?? post.publishedAt,
  }))

  const urls = [
    ...staticPages.map(
      (p) =>
        `  <url><loc>${baseUrl}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
    ),
    ...postPages.map(
      (p) =>
        `  <url><loc>${baseUrl}${p.path}</loc><lastmod>${p.lastmod}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
    ),
  ].join("\n")

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
