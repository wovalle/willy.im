import { Octokit } from "@octokit/rest"
import { declareService, type BaseServiceContext } from "../../lib/services"
import { githubDataSchema, type GithubData } from "./github.schemas"
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

export const createGithubService = declareService("github", (context: BaseServiceContext) => {
  const getRepository = async ({
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

  const getRepositories = async ({
    username,
    count = 100,
  }: {
    username: string
    count?: number
  }): Promise<SimpleRepository[]> => {
    const client = new Octokit()
    const response = await client.repos.listForUser({ username, per_page: count })

    const portfolio = response.data.filter((repo) => repo.topics?.includes("willy-im"))

    return portfolio
      .map((r) => mapGithubRepoToSimpleRepository(r))
      .sort((a, b) => b.stars - a.stars)
  }

  const getFromCache = async (): Promise<GithubData> => {
    const placeholder = {
      repositories: [],
      updatedAt: "",
      totalRepositories: 0,
    }
    try {
      const kvData = await context.db.query.kv.findFirst({
        where: (kv, { eq }) => eq(kv.id, "github.data"),
      })

      if (!kvData?.value) {
        return placeholder
      }

      return githubDataSchema.parse(kvData.value)
    } catch (error) {
      context.logger.error("Error parsing cached GitHub data:", error)
      return placeholder
    }
  }

  return {
    getRepository,
    getRepositories,
    getFromCache,
  }
})

export type GithubService = ReturnType<typeof createGithubService>
