import { kv } from "../../app/db/schema"
import type { ServiceContext } from "../../app/lib/services"

export async function updateGithub({ db, logger, services }: ServiceContext) {
  logger.info("[scheduled] [github] Fetching repositories...")

  const repositories = await services.github.getRepositories({ username: "wovalle" })

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
