import { z } from "zod"

export const githubRepositorySchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  stars: z.number(),
  forks: z.number(),
  url: z.string(),
})

export const githubDataSchema = z.object({
  repositories: z.array(githubRepositorySchema),
  updatedAt: z.string(),
  totalRepositories: z.number(),
})

export type GithubRepository = z.infer<typeof githubRepositorySchema>
export type GithubData = z.infer<typeof githubDataSchema>
