import React from "react"
import { FaBook, FaStar, FaCodeBranch } from "react-icons/fa"
import { SimpleRepository } from "../lib/github"

export type RepositoryCardProps = {
  repo: SimpleRepository
}

export const RepositoryCard: React.FC<RepositoryCardProps> = ({ repo }) => {
  return (
    <div className="flex flex-col h-full max-w-sm p-4 border rounded">
      <div className="flex items-center">
        <FaBook size=".9em" className="mr-1" />
        <a
          href="repository.html_url"
          target="_blank"
          className="font-medium text-purple-800 dark:text-purple-200"
        >
          {repo.name}
        </a>
      </div>
      <div className="mt-2 mb-4 text-xs">{repo.description}</div>
      <div className="flex mt-auto text-xs">
        <div className="flex items-center mr-4">
          <span
            style={{ backgroundColor: repo.langColor ?? "" }}
            className="relative w-3 h-3 rounded-full"
          ></span>
          <span className="pl-2">{repo.language}</span>
        </div>
        <div className="flex items-center mr-4">
          <FaStar />
          <span>{repo.stars}</span>
        </div>
        <div v-if="repository.forks" className="flex items-center">
          <FaCodeBranch />
          <span>{repo.forks}</span>
        </div>
      </div>
    </div>
  )
}
