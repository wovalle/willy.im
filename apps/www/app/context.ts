import { createContext } from "react-router"

import type { DrizzleClient } from "./db/drizzle"
import type { AuthService } from "./lib/auth.server"
import type { getAppEnv } from "./lib/env"
import type { ILogger } from "./lib/services"
import type { GithubService } from "./modules/github/github.server"
import type { GoodreadsService } from "./modules/goodreads/goodreads.server"
import type { SpotifyService } from "./modules/spotify/spotify.server"
import type { YoutubeService } from "./modules/youtube/youtube.server"

/** What the worker hands every loader/action: bindings, db, logger, services. */
export type AppContext = {
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

/** Set once per request in workers/app.ts; read with `context.get(appContext)`. */
export const appContext = createContext<AppContext>()
