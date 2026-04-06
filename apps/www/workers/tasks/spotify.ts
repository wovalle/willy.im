import { kv } from "../../app/db/schema"
import type { BaseServiceContext } from "../../app/lib/services"
import { createSpotifyService } from "../../app/modules/spotify/spotify.server"

export async function updateSpotify(ctx: BaseServiceContext) {
  const { db, logger } = ctx
  const spotify = createSpotifyService(ctx)

  logger.info("[scheduled] [spotify] Fetching top tracks, artists, and now playing...")

  const [topTracks, topArtists, nowPlaying] = await Promise.all([
    spotify.getTopTracks(30),
    spotify.getTopArtists(30),
    spotify.getNowPlaying().catch(() => null),
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

  const totalItems = spotifyData.totalTracks + spotifyData.totalArtists
  logger.info(`[scheduled] [spotify] Done: ${spotifyData.totalTracks} tracks, ${spotifyData.totalArtists} artists stored`)
  return { count: totalItems }
}
