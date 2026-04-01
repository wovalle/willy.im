import { createRequestHandler } from "react-router"

import type { DrizzleClient } from "../app/db/drizzle"
import { getAppEnv } from "../app/lib/env"
import { createAuthService, type AuthService } from "../app/lib/auth.server"
import { createBaseContext, type BaseServiceContext, type ILogger } from "../app/lib/services"
import { createGithubService, type GithubService } from "../app/modules/github/github.server"
import {
  createGoodreadsService,
  type GoodreadsService,
} from "../app/modules/goodreads/goodreads.server"
import { createSpotifyService, type SpotifyService } from "../app/modules/spotify/spotify.server"
import { createYoutubeService, type YoutubeService } from "../app/modules/youtube/youtube.server"

import { updateGithub } from "./tasks/github"
import { updateYoutube } from "./tasks/youtube"
import { updateSpotify } from "./tasks/spotify"
import { updateGoodreads } from "./tasks/goodreads"
import { runTasks } from "./tasks/runner"

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
    db: DrizzleClient
    logger: ILogger
    getAppEnv: typeof getAppEnv
    services: {
      auth: AuthService
      github: GithubService
      youtube: YoutubeService
      spotify: SpotifyService
      goodreads: GoodreadsService
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    const baseCtx = createBaseContext(env.db)

    return requestHandler(request, {
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
