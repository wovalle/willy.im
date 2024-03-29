import { IconStar } from "@tabler/icons-react"
import Link from "next/link"
import React from "react"
import type { SimpleRepository } from "../../lib/github"

export type RepositoryCardProps = {
  repo: SimpleRepository
}

export const RepositoryCard: React.FC<RepositoryCardProps> = ({ repo }) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <Link href={repo.url} target="_blank" className="font-medium" rel="noopener noreferrer">
          {repo.name}
        </Link>
        <div className="text-subtitle flex items-center text-xs font-bold leading-6">
          <div>{repo.stars}</div> <IconStar className="ml-0.5" size="1em" />
        </div>
      </div>
      <div className="mt-1 text-xs">{repo.description}</div>
    </div>
  )
}
