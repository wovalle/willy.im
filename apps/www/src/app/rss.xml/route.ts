import { allPosts } from "contentlayer/generated"
import RSS from "rss"
import { siteConfig } from "../../lib/static"

export async function GET() {
  const feed = new RSS({
    title: "Willy Ovalle",
    description: siteConfig.description,
    site_url: siteConfig.url,
    feed_url: `${siteConfig.url}/feed.xml`,
  })

  allPosts.map((post) => {
    feed.item({
      title: post.title,
      url: `${siteConfig.url}/posts/${post.slug}`,
      date: post.published ?? "",
      description: post.summary,
      categories: post.tags,
    })
  })

  return new Response(feed.xml(), {
    headers: {
      "Content-Type": "application/xml",
    },
  })
}
