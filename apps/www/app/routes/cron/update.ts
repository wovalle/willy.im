import { data } from "react-router"
import { z } from "zod"
import { kv } from "../../db/schema"
import type { Route } from "./+types/update"

const updateSchema = z.object({
  services: z
    .array(z.enum(["github", "youtube", "spotify", "goodreads"]))
    .optional()
    .default(["github", "youtube", "spotify", "goodreads"]),
})

export const action = async ({ context, request }: Route.ActionArgs) => {
  try {
    let requestedServices: string[] = ["github", "youtube", "spotify", "goodreads"] // Default to all

    if (request.method === "POST") {
      const body = await request.json()
      const result = updateSchema.safeParse(body)

      if (!result.success) {
        return data(
          {
            success: false,
            error: "Invalid request body",
            fieldErrors: result.error.flatten().fieldErrors,
            formErrors: result.error.flatten().formErrors,
          },
          { status: 400 },
        )
      }

      requestedServices = result.data.services
    }

    const results = {
      github: { success: false, count: 0, error: null as string | null },
      youtube: { success: false, count: 0, error: null as string | null },
      spotify: { success: false, count: 0, error: null as string | null },
      goodreads: { success: false, count: 0, error: null as string | null },
    }

    // Update GitHub repositories
    if (requestedServices.includes("github")) {
      try {
        const repositories = await context.services.github.getRepositories({
          username: "wovalle",
        })

        const githubData = {
          repositories,
          updatedAt: new Date().toISOString(),
          totalRepositories: repositories.length,
        }

        await context.db
          .insert(kv)
          .values({
            id: "github.data",
            value: githubData,
          })
          .onConflictDoUpdate({
            target: kv.id,
            set: {
              value: githubData,
            },
          })

        results.github = { success: true, count: repositories.length, error: null }
        context.logger.info(
          `Updated GitHub repositories: ${repositories.length} repositories stored`,
        )
      } catch (error) {
        results.github.error = error instanceof Error ? error.message : "Unknown error"
        context.logger.error("Error updating GitHub repositories:", error)
      }
    }

    // Update YouTube liked videos (last 30)
    if (requestedServices.includes("youtube")) {
      try {
        let { accessToken } = await context.services.auth.api.getAccessToken({
          body: {
            providerId: "google",
            userId: context.getAppEnv("STATIC_ACCOUNT_ID"),
          },
        })

        if (!accessToken) {
          results.youtube.error = "No valid access token found"
          context.logger.warn("YouTube update skipped: No valid access token found")
          return
        }

        const videos = await context.services.youtube.getLikedVideos({
          userToken: accessToken,
          maxResults: 30,
        })

        const youtubeData = {
          videos,
          updatedAt: new Date().toISOString(),
          totalVideos: videos.length,
        }

        await context.db
          .insert(kv)
          .values({
            id: "youtube.liked-videos",
            value: youtubeData,
          })
          .onConflictDoUpdate({
            target: kv.id,
            set: {
              value: youtubeData,
            },
          })

        results.youtube = { success: true, count: videos.length, error: null }
        context.logger.info(`Updated YouTube liked videos: ${videos.length} videos stored`)
      } catch (error) {
        results.youtube.error = error instanceof Error ? error.message : "Unknown error"
        context.logger.error("Error updating YouTube liked videos:", error)
      }
    }

    // Update Spotify data (last 30 top tracks for each time range)
    if (requestedServices.includes("spotify")) {
      try {
        const [topTracks, topArtists, nowPlaying] = await Promise.all([
          context.services.spotify.getTopTracks(30),
          context.services.spotify.getTopArtists(30),
          context.services.spotify.getNowPlaying().catch(() => null), // Optional
        ])

        const spotifyData = {
          topTracks,
          topArtists,
          nowPlaying: nowPlaying || undefined,
          updatedAt: new Date().toISOString(),
          totalTracks: topTracks.days.length + topTracks.months.length + topTracks.years.length,
          totalArtists: topArtists.days.length + topArtists.months.length + topArtists.years.length,
        }

        await context.db
          .insert(kv)
          .values({
            id: "spotify.data",
            value: spotifyData,
          })
          .onConflictDoUpdate({
            target: kv.id,
            set: {
              value: spotifyData,
            },
          })

        results.spotify = {
          success: true,
          count: spotifyData.totalTracks + spotifyData.totalArtists,
          error: null,
        }
        context.logger.info(
          `Updated Spotify data: ${spotifyData.totalTracks} tracks, ${spotifyData.totalArtists} artists stored`,
        )
      } catch (error) {
        results.spotify.error = error instanceof Error ? error.message : "Unknown error"
        context.logger.error("Error updating Spotify data:", error)
      }
    }

    // Update Goodreads data (last 30 reviews + all currently reading)
    if (requestedServices.includes("goodreads")) {
      try {
        const [reviews, currentlyReading, wantToRead, readingStats] = await Promise.all([
          context.services.goodreads.getReviews({ limit: 30, trimTitle: false }),
          context.services.goodreads.getCurrentlyReading({ limit: 100, trimTitle: false }), // Get all currently reading
          context.services.goodreads.getWantToRead({ limit: 30, trimTitle: false }),
          context.services.goodreads.getReadingStats(),
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

        await context.db
          .insert(kv)
          .values({
            id: "goodreads.data",
            value: goodreadsData,
          })
          .onConflictDoUpdate({
            target: kv.id,
            set: {
              value: goodreadsData,
            },
          })

        results.goodreads = {
          success: true,
          count: reviews.length + currentlyReading.length + wantToRead.length,
          error: null,
        }
        context.logger.info(
          `Updated Goodreads data: ${reviews.length} reviews, ${currentlyReading.length} currently reading, ${wantToRead.length} want to read stored`,
        )
      } catch (error) {
        results.goodreads.error = error instanceof Error ? error.message : "Unknown error"
        context.logger.error("Error updating Goodreads data:", error)
      }
    }

    const successCount = Object.values(results).filter((r) => r.success).length
    const totalItems = Object.values(results).reduce((sum, r) => sum + r.count, 0)

    return data({
      success: successCount > 0,
      message: `Updated ${successCount}/${requestedServices.length} requested services successfully`,
      requestedServices,
      results,
      totalItems,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    context.logger.error("Error in cron update:", error)

    return data(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    )
  }
}
