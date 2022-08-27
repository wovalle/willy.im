import { GetServerSideProps } from "next"
import RSS from "rss"
import { getPublicPosts } from "../lib/notion"

// TODO: static site_url
export const getServerSideProps: GetServerSideProps = async (context) => {
  const res = context.res
  if (!res) {
    return { props: {} }
  }

  const feed = new RSS({
    title: "Willy Ovalle",
    site_url: "https://willy.im",
    feed_url: "https://willy.im/feed.xml",
  })

  const posts = await getPublicPosts()

  posts.map((post) => {
    feed.item({
      title: post.title,
      url: `https://willy.im/posts/${post.slug}`,
      date: post.publishedAt ?? "",
      description: post.summary,
      categories: post.categories,
    })
  })

  res.setHeader("Content-Type", "text/xml")
  res.write(feed.xml())
  res.end()

  return { props: {} }
}

export default () => null
