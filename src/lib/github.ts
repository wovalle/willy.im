import { RestEndpointMethodTypes, Octokit } from "@octokit/rest"
import getColor from "github-lang-colors"

export type GithubRepository = RestEndpointMethodTypes["repos"]["get"]["response"]["data"]

export type SimpleRepository = {
  name: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  langColor: string | null
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
    color = getColor(response.data.language || "") || null
  } catch (error) {}

  return {
    name: response.data.name,
    description: response.data.description,
    language: response.data.language,
    stars: response.data.stargazers_count,
    forks: response.data.forks,
    langColor: color,
  }
}
