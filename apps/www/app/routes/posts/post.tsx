import type { Post as PostType } from "content-collections/generated"
import { Link } from "react-router"

export const Post = (post: PostType) => {
  return (
    <article className="space-y-2">
      <Link to={`/posts/${post._meta.path}`}>
        <h3 className="text-3xl font-bold">{post.title}</h3>
      </Link>

      <p className="text-gray-600">{post.summary}</p>

      <time className="block text-sm text-cyan-700" dateTime={post.publishedAt}>
        {post.publishedAt.replace(/-/g, "/")}
      </time>
    </article>
  )
}
