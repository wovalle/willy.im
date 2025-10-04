import { Client, TimeRange } from "spotify-api.js"
import { declareService, type BaseServiceContext } from "../../lib/services"
import { spotifyDataSchema, type SpotifyData } from "./spotify.schemas"

export interface SimpleSpotifySong {
  songName: string
  artistName: string
  url: string
  thumbnailUrl?: string
}

export type SimpleNowPlaying = Partial<SimpleSpotifySong> & { isPlaying: boolean }

export const createSpotifyService = declareService("spotify", (context: BaseServiceContext) => {
  const createSpotifyClient = async () => {
    const client = await Client.create({
      token: {
        clientID: context.getAppEnv("SPOTIFY_CLIENT_ID"),
        clientSecret: context.getAppEnv("SPOTIFY_CLIENT_SECRET"),
        refreshToken: context.getAppEnv("SPOTIFY_REFRESH_TOKEN"),
        redirectURL: "url",
      },
    })

    return client
  }

  const getNowPlaying = async () => {
    try {
      const client = await createSpotifyClient()
      const nowPlaying = await client.user.player.getCurrentlyPlaying("episode")

      if (!nowPlaying || !nowPlaying.item) {
        return {
          isPlaying: false,
        }
      }

      const { item, isPlaying } = nowPlaying

      if (item.type === "episode") {
        return {
          isPlaying,
          artistName:
            "show" in item ? (item.show?.name ?? "") : item.artists.map((a) => a.name).join(", "),
          songName: item.name,
          url: "externalURL" in item ? item.externalURL["spotify"] : "",
        }
      } else if (item.type === "track") {
        return {
          isPlaying,
          artistName: "artists" in item ? item.artists.map((a) => a.name).join(", ") : "",
          songName: item.name,
          url: "externalURL" in item ? item.externalURL["spotify"] : "",
        }
      } else {
        return {
          isPlaying: false,
        }
      }
    } catch (error) {
      context.logger.error("Error fetching now playing:", error)
      return {
        isPlaying: false,
      }
    }
  }

  const getTopTracks = async (limit: number = 10) => {
    try {
      const client = await createSpotifyClient()

      const topTracks = await Promise.all([
        client.user.getTopTracks({ limit, timeRange: TimeRange.Short }),
        client.user.getTopTracks({ limit, timeRange: TimeRange.Medium }),
        client.user.getTopTracks({ limit, timeRange: TimeRange.Long }),
      ])

      const [days, months, years] = topTracks.map((timeframe) =>
        timeframe.map((t) => ({
          songName: t.name,
          artistName: t.artists.map((m) => m.name).join(", "),
          url: t.externalURL["spotify"],
          thumbnailUrl: t.album?.images[0]?.url,
        })),
      )

      return {
        days,
        months,
        years,
      }
    } catch (error) {
      context.logger.error("Error fetching top tracks:", error)
      throw error
    }
  }

  const getTopArtists = async (limit: number = 10) => {
    try {
      const client = await createSpotifyClient()

      const topArtists = await Promise.all([
        client.user.getTopArtists({ limit, timeRange: TimeRange.Short }),
        client.user.getTopArtists({ limit, timeRange: TimeRange.Medium }),
        client.user.getTopArtists({ limit, timeRange: TimeRange.Long }),
      ])

      const [days, months, years] = topArtists.map((timeframe) =>
        timeframe.map((t) => ({
          name: t.name,
          genres: t.genres?.join(", ") ?? "",
          thumbnailUrl: t.images?.[0].url ?? "",
          url: t.externalURL["spotify"],
        })),
      )

      return {
        days,
        months,
        years,
      }
    } catch (error) {
      context.logger.error("Error fetching top artists:", error)
      throw error
    }
  }

  const getFromCache = async (): Promise<SpotifyData> => {
    const placeholder = {
      topTracks: {
        days: [],
        months: [],
        years: [],
      },
      topArtists: {
        days: [],
        months: [],
        years: [],
      },
      nowPlaying: undefined,
      updatedAt: "",
      totalTracks: 0,
      totalArtists: 0,
    }
    try {
      const kvData = await context.db.query.kv.findFirst({
        where: (kv, { eq }) => eq(kv.id, "spotify.data"),
      })

      if (!kvData?.value) {
        return placeholder
      }

      return spotifyDataSchema.parse(kvData.value)
    } catch (error) {
      context.logger.error("Error parsing cached Spotify data:", error)
      return placeholder
    }
  }

  return {
    getNowPlaying,
    getTopTracks,
    getTopArtists,
    getFromCache,
  }
})

export type SpotifyService = ReturnType<typeof createSpotifyService>
