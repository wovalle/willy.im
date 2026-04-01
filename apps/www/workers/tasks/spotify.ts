import { kv } from "../../app/db/schema"
import type { ServiceContext } from "../../app/lib/services"

export async function updateSpotify({ db, logger, services }: ServiceContext) {
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

  const totalItems = spotifyData.totalTracks + spotifyData.totalArtists
  logger.info(`[scheduled] [spotify] Done: ${spotifyData.totalTracks} tracks, ${spotifyData.totalArtists} artists stored`)
  return { count: totalItems }
}
