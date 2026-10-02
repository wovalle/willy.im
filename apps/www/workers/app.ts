import { createRequestHandler, RouterContextProvider } from "react-router"

import { appContext } from "../app/context"
import { getAppEnv } from "../app/lib/env"
import { createAuthService } from "../app/lib/auth.server"
import { createBaseContext, type BaseServiceContext } from "../app/lib/services"
import { createGithubService } from "../app/modules/github/github.server"
import { createGoodreadsService } from "../app/modules/goodreads/goodreads.server"
import { createSpotifyService } from "../app/modules/spotify/spotify.server"
import { createYoutubeService } from "../app/modules/youtube/youtube.server"

import { updateGithub } from "./tasks/github"
import { updateYoutube } from "./tasks/youtube"
import { updateSpotify } from "./tasks/spotify"
import { updateGoodreads } from "./tasks/goodreads"
import { runTasks } from "./tasks/runner"

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    const baseCtx = createBaseContext(env.db)

    const context = new RouterContextProvider()
    context.set(appContext, {
      cloudflare: { env, ctx },
      ...baseCtx,
      services: {
        auth: createAuthService(baseCtx),
        github: createGithubService(baseCtx),
        youtube: createYoutubeService(baseCtx),
        spotify: createSpotifyService(baseCtx),
        goodreads: createGoodreadsService(baseCtx),
      },
    })
    return requestHandler(request, context)
  },

  async scheduled(event, env, ctx) {
    const startTime = Date.now()
    const baseCtx = createBaseContext(env.db)
    const { logger } = baseCtx

    logger.info(`[scheduled] Cron triggered: "${event.cron}" at ${new Date(event.scheduledTime).toISOString()}`)

    const results = await runTasks(
      {
        github: updateGithub,
        youtube: updateYoutube,
        spotify: updateSpotify,
        goodreads: updateGoodreads,
      },
      baseCtx,
      logger,
    )

    const totalDuration = Date.now() - startTime
    const successCount = Object.values(results).filter((r) => r.success).length
    const failedCount = Object.values(results).filter((r) => !r.success).length
    const totalItems = Object.values(results).reduce((sum, r) => sum + r.count, 0)

    logger.info(
      `[scheduled] Completed in ${totalDuration}ms — ${successCount}/4 services succeeded, ${failedCount} failed, ${totalItems} total items updated`,
    )

    for (const [service, result] of Object.entries(results)) {
      const status = result.success ? "OK" : `FAILED: ${result.error}`
      logger.info(`[scheduled]   ${service}: ${status} (${result.count} items, ${result.durationMs}ms)`)
    }
  },
} satisfies ExportedHandler<Env>
