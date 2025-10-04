import { createRequestHandler } from "react-router"

import { createDrizzleClient, type DrizzleClient } from "../app/db/drizzle"
import { createAuthService, type AuthService } from "../app/lib/auth.server"
import { getAppEnv } from "../app/lib/env"
import { createConsoleLogger, type ILogger } from "../app/lib/services"
import { createGithubService, type GithubService } from "../app/modules/github/github.server"
import {
  createGoodreadsService,
  type GoodreadsService,
} from "../app/modules/goodreads/goodreads.server"
import { createSpotifyService, type SpotifyService } from "../app/modules/spotify/spotify.server"
import { createYoutubeService, type YoutubeService } from "../app/modules/youtube/youtube.server"

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
    db: DrizzleClient
    logger: ILogger
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
    const db = createDrizzleClient(env.db)

    const serviceBaseContext = {
      getAppEnv,
      db,
      logger: createConsoleLogger(),
    }

    const auth = createAuthService(serviceBaseContext)
    const github = createGithubService(serviceBaseContext)
    const youtube = createYoutubeService(serviceBaseContext)
    const spotify = createSpotifyService(serviceBaseContext)
    const goodreads = createGoodreadsService(serviceBaseContext)

    return requestHandler(request, {
      cloudflare: { env, ctx },
      db,
      logger: createConsoleLogger(),
      services: {
        auth,
        github,
        youtube,
        spotify,
        goodreads,
      },
    })
  },
} satisfies ExportedHandler<Env>
