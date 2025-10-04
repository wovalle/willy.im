import { IconStar } from "@tabler/icons-react"
import type { FC } from "react"
import { Link } from "react-router"
import type { SimpleRepository } from "~/modules/github/github.types"

export const RepositoryCard: FC<{
  repo: SimpleRepository
}> = ({ repo }) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <Link to={repo.url} target="_blank" className="font-medium" rel="noopener noreferrer">
          {repo.name}
        </Link>
        <div className="text-gray-500 dark:text-gray-400 flex items-center text-xs font-bold leading-6">
          <div>{repo.stars}</div> <IconStar className="ml-0.5" size="1em" />
        </div>
      </div>
      <div className="mt-1 text-xs">{repo.description}</div>
    </div>
  )
}
