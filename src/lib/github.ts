import { RestEndpointMethodTypes, Octokit } from "@octokit/rest"
import getColor from "github-lang-colors"

export type GithubRepository = RestEndpointMethodTypes["repos"]["get"]["response"]["data"]

export type SimpleRepository = {
  name: string
  description: string | null
  language: string
  stars: number
  forks: number
  langColor: string | null
  url: string
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

  let color: string | null = ""

  try {
    color = getColor(response.data.language ?? "") ?? null
  } catch (error) {}

  return {
    name: response.data.name,
    description: response.data.description,
    language: response.data.language ?? "unknown",
    stars: response.data.stargazers_count,
    forks: response.data.forks,
    langColor: color,
    url: response.data.html_url,
  }
}

export const getRepositories = async ({
  owner,
}: {
  repo: string
  owner: string
}): Promise<SimpleRepository[]> => {
  const client = new Octokit()
  const response = await client.repos.listPublic({ owner })

  return response.data.map((r) => {
    let color: string | null = ""

    try {
      color = getColor(r.language ?? "") ?? null
    } catch (error) {}

    return {
      name: r.name,
      description: r.description,
      language: r.language ?? "unknown",
      stars: r.stargazers_count ?? 0,
      forks: r.forks ?? 0,
      langColor: color,
      url: r.html_url,
    }
  })
}
