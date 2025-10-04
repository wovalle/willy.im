import { Octokit } from "@octokit/rest"

import type { GithubRepository, SimpleRepository } from "./github.types"

const mapGithubRepoToSimpleRepository = (repo: GithubRepository): SimpleRepository => {
  return {
    name: repo.name,
    description: repo.description,
    language: repo.language ?? "unknown",
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks ?? 0,
    url: repo.html_url,
  }
}

export const getRepository = async ({
  repo,
  owner,
}: {
  repo: string
  owner: string
}): Promise<SimpleRepository> => {
  const client = new Octokit()
  const response = await client.repos.get({ owner, repo })
  return mapGithubRepoToSimpleRepository(response.data)
}

export const getRepositories = async ({
  username,
  count = 100,
}: {
  username: string
  count?: number
}): Promise<SimpleRepository[]> => {
  const client = new Octokit()
  const response = await client.repos.listForUser({ username, per_page: count })

  const portfolio = response.data.filter((repo) => repo.topics?.includes("willy-im"))

  return portfolio.map((r) => mapGithubRepoToSimpleRepository(r)).sort((a, b) => b.stars - a.stars)
}
