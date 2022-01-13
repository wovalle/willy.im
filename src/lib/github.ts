import { RestEndpointMethodTypes, Octokit } from "@octokit/rest"
import getColor from "github-lang-colors"

export type GithubRepository =
  | RestEndpointMethodTypes["repos"]["get"]["response"]["data"]
  | RestEndpointMethodTypes["repos"]["listForUser"]["response"]["data"][0]

export type SimpleRepository = {
  name: string
  description: string | null
  language: string
  stars: number
  forks: number
  langColor: string | null
  url: string
}

const mapGithubRepoToSimpleRepository = (repo: GithubRepository): SimpleRepository => {
  let color: string | null = ""

  try {
    color = getColor(repo.language ?? "") ?? null
  } catch (error) {}
  return {
    name: repo.name,
    description: repo.description,
    language: repo.language ?? "unknown",
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks ?? 0,
    langColor: color,
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
