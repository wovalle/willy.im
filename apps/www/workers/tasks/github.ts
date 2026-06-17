import { kv } from "../../app/db/schema"
import type { BaseServiceContext } from "../../app/lib/services"
import { createGithubService } from "../../app/modules/github/github.server"

export async function updateGithub(ctx: BaseServiceContext) {
  const { db, logger } = ctx
  const github = createGithubService(ctx)

  logger.info("[scheduled] [github] Fetching repositories...")

  const repositories = await github.getRepositories({ username: "wovalle" })

  const githubData = {
    repositories,
    updatedAt: new Date().toISOString(),
    totalRepositories: repositories.length,
  }

  await db
    .insert(kv)
    .values({ id: "github.data", value: githubData })
    .onConflictDoUpdate({ target: kv.id, set: { value: githubData } })

  logger.info(`[scheduled] [github] Done: ${repositories.length} repositories stored`)
  return { count: repositories.length }
}
