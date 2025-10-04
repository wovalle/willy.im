import type { Route } from "./+types/route"

import { allPosts } from "../../../.content-collections/generated"
import { Post } from "./post"

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
    <div className="py-10">
      <ul className="space-y-8">
        {posts.map((post) => (
          <li key={post._meta.path}>
            <Post {...post} />
          </li>
        ))}
      </ul>
    </div>
  )
}
