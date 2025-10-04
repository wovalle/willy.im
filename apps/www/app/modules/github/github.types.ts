import type { RestEndpointMethodTypes } from "@octokit/rest"

export type GithubRepository =
  | RestEndpointMethodTypes["repos"]["get"]["response"]["data"]
  | RestEndpointMethodTypes["repos"]["listForUser"]["response"]["data"][0]

export type SimpleRepository = {
  name: string
  description: string | null
  language: string
  stars: number
  forks: number
  url: string
}
