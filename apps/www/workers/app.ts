import { createRequestHandler } from "react-router"

import { createDrizzleClient, type DrizzleClient } from "../app/db/drizzle"
import { kv } from "../app/db/schema"
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

function createServiceContext(env: Env) {
  const db = createDrizzleClient(env.db)
  const logger = createConsoleLogger()

  const baseContext = { getAppEnv, db, logger }

  const services = {
    auth: createAuthService(baseContext),
    github: createGithubService(baseContext),
    youtube: createYoutubeService(baseContext),
    spotify: createSpotifyService(baseContext),
    goodreads: createGoodreadsService(baseContext),
  }

  return { db, logger, services }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    const { db, logger, services } = createServiceContext(env)

    return requestHandler(request, {
      cloudflare: { env, ctx },
      db,
      logger,
      getAppEnv,
      services,
    })
  },

  async scheduled(event, env, ctx) {
    const startTime = Date.now()
    const { db, logger, services } = createServiceContext(env)

    logger.info(`[scheduled] Cron triggered: "${event.cron}" at ${new Date(event.scheduledTime).toISOString()}`)

    const results: Record<string, { success: boolean; count: number; error: string | null; durationMs: number }> = {}

    // GitHub
    try {
      const svcStart = Date.now()
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

      const durationMs = Date.now() - svcStart
      results.github = { success: true, count: repositories.length, error: null, durationMs }
      logger.info(`[scheduled] [github] Done: ${repositories.length} repositories stored in ${durationMs}ms`)
    } catch (error) {
      const durationMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : "Unknown error"
      results.github = { success: false, count: 0, error: message, durationMs }
      logger.error(`[scheduled] [github] Failed after ${durationMs}ms: ${message}`, error)
    }

    // YouTube
    try {
      const svcStart = Date.now()
      logger.info("[scheduled] [youtube] Fetching access token...")

      const { accessToken } = await services.auth.api.getAccessToken({
        body: {
          providerId: "google",
          userId: getAppEnv("STATIC_ACCOUNT_ID"),
        },
      })

      if (!accessToken) {
        const durationMs = Date.now() - svcStart
        results.youtube = { success: false, count: 0, error: "No valid access token found", durationMs }
        logger.warn(`[scheduled] [youtube] Skipped: No valid access token found (${durationMs}ms)`)
      } else {
        logger.info("[scheduled] [youtube] Access token obtained, fetching liked videos...")

        const videos = await services.youtube.getLikedVideos({ userToken: accessToken, maxResults: 30 })

        const youtubeData = {
          videos,
          updatedAt: new Date().toISOString(),
          totalVideos: videos.length,
        }

        await db
          .insert(kv)
          .values({ id: "youtube.liked-videos", value: youtubeData })
          .onConflictDoUpdate({ target: kv.id, set: { value: youtubeData } })

        const durationMs = Date.now() - svcStart
        results.youtube = { success: true, count: videos.length, error: null, durationMs }
        logger.info(`[scheduled] [youtube] Done: ${videos.length} videos stored in ${durationMs}ms`)
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : "Unknown error"
      results.youtube = { success: false, count: 0, error: message, durationMs }
      logger.error(`[scheduled] [youtube] Failed after ${durationMs}ms: ${message}`, error)
    }

    // Spotify
    try {
      const svcStart = Date.now()
      logger.info("[scheduled] [spotify] Fetching top tracks, artists, and now playing...")

      const [topTracks, topArtists, nowPlaying] = await Promise.all([
        services.spotify.getTopTracks(30),
        services.spotify.getTopArtists(30),
        services.spotify.getNowPlaying().catch(() => null),
      ])

      const spotifyData = {
        topTracks,
        topArtists,
        nowPlaying: nowPlaying || undefined,
        updatedAt: new Date().toISOString(),
        totalTracks: topTracks.days.length + topTracks.months.length + topTracks.years.length,
        totalArtists: topArtists.days.length + topArtists.months.length + topArtists.years.length,
      }

      await db
        .insert(kv)
        .values({ id: "spotify.data", value: spotifyData })
        .onConflictDoUpdate({ target: kv.id, set: { value: spotifyData } })

      const durationMs = Date.now() - svcStart
      results.spotify = { success: true, count: spotifyData.totalTracks + spotifyData.totalArtists, error: null, durationMs }
      logger.info(`[scheduled] [spotify] Done: ${spotifyData.totalTracks} tracks, ${spotifyData.totalArtists} artists stored in ${durationMs}ms`)
    } catch (error) {
      const durationMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : "Unknown error"
      results.spotify = { success: false, count: 0, error: message, durationMs }
      logger.error(`[scheduled] [spotify] Failed after ${durationMs}ms: ${message}`, error)
    }

    // Goodreads
    try {
      const svcStart = Date.now()
      logger.info("[scheduled] [goodreads] Fetching reviews, currently reading, want to read, and stats...")

      const [reviews, currentlyReading, wantToRead, readingStats] = await Promise.all([
        services.goodreads.getReviews({ limit: 30, trimTitle: false }),
        services.goodreads.getCurrentlyReading({ limit: 100, trimTitle: false }),
        services.goodreads.getWantToRead({ limit: 30, trimTitle: false }),
        services.goodreads.getReadingStats(),
      ])

      const goodreadsData = {
        reviews,
        currentlyReading,
        wantToRead,
        readingStats,
        updatedAt: new Date().toISOString(),
        totalReviews: reviews.length,
        totalCurrentlyReading: currentlyReading.length,
        totalWantToRead: wantToRead.length,
      }

      await db
        .insert(kv)
        .values({ id: "goodreads.data", value: goodreadsData })
        .onConflictDoUpdate({ target: kv.id, set: { value: goodreadsData } })

      const durationMs = Date.now() - svcStart
      const totalItems = reviews.length + currentlyReading.length + wantToRead.length
      results.goodreads = { success: true, count: totalItems, error: null, durationMs }
      logger.info(`[scheduled] [goodreads] Done: ${reviews.length} reviews, ${currentlyReading.length} reading, ${wantToRead.length} want-to-read in ${durationMs}ms`)
    } catch (error) {
      const durationMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : "Unknown error"
      results.goodreads = { success: false, count: 0, error: message, durationMs }
      logger.error(`[scheduled] [goodreads] Failed after ${durationMs}ms: ${message}`, error)
    }

    // Summary
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
