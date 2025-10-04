import type { Post as PostType } from "content-collections"
import { Link } from "react-router"

export const Post = (post: PostType) => {
  return (
    <article className="space-y-2">
      <Link to={`/posts/${post._meta.path}`}>
        <h3 className="text-2xl font-bold md:text-3xl">{post.title}</h3>
      </Link>

      <p className="text-gray-600">{post.summary}</p>

      <time className="block text-sm text-stone-600" dateTime={post.publishedAt}>
        {post.publishedAt.replace(/-/g, "/")}
      </time>
    </article>
  )
}
