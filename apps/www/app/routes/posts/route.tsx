import { allPosts } from "content-collections"

import { createPageMeta, siteConfig } from "~/static"
import type { Route } from "./+types/route"
import { Post } from "./post"

export const meta: Route.MetaFunction = () =>
  createPageMeta({
    title: `Posts | ${siteConfig.author}`,
    description: `Blog posts and articles by ${siteConfig.author} about software development, React, TypeScript, and more.`,
    path: "/posts",
  })

export const loader = () => {
  return {
    posts: allPosts.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    ),
  }
}

export default function Component({ loaderData }: Route.ComponentProps) {
  const { posts } = loaderData

  return (
    <div className="px-6 py-10">
      <ul className="space-y-6">
        {posts.map((post) => (
          <li key={post._meta.path}>
            <Post {...post} />
          </li>
        ))}
      </ul>
    </div>
  )
}
