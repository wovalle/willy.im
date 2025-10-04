import type { FC } from "react"
import { Link } from "react-router"
import { Time } from "~/components/time"

export const PostCard: FC<{
  url: string
  publishedAt: string | null
  title: string
  summary: string
}> = ({ url, publishedAt, title, summary }) => (
  <article className="justify flex flex-col content-between py-4">
    {publishedAt ? (
      <Time
        className="text-gray-500 dark:text-gray-400 text-xs leading-tight"
        date={publishedAt}
        format="MMMM D, YYYY"
      />
    ) : null}
    <div>
      <Link to={url} className="border-transparent text-xl font-bold" rel="noopener noreferrer">
        {title}
      </Link>
    </div>
    <div className="text-gray-500 dark:text-gray-400">{summary}</div>
  </article>
)
