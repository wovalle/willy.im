import { Client, Episode, TimeRange, Track } from "spotify-api.js"

const clientId = process.env.SPOTIFY_CLIENT_ID
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN

export interface SimpleSpotifySong {
  songName: string
  artistName: string
  url: string
  thumbnailUrl?: string
  previewUrl?: string
}

export type SimpleNowPlaying = Partial<SimpleSpotifySong> & { isPlaying: boolean }

function isEpisode(item: any | null): item is Episode {
  return item?.type === "episode"
}

function isTrack(item: any | null): item is Track {
  return item?.type === "track"
}

const createSpotifyClient = async (): Promise<Client> => {
  const client = await Client.create({
    token: {
      clientID: clientId!,
      clientSecret: clientSecret!,
      refreshToken: refreshToken,
      redirectURL: "url",
    },
  })

  return client
}

export const getNowPlaying = async (): Promise<SimpleNowPlaying> => {
  const client = await createSpotifyClient()
  const nowPlaying = await client.user.player.getCurrentlyPlaying("episode")

  if (!nowPlaying) {
    return {
      isPlaying: false,
    }
  }

  const { item, isPlaying } = nowPlaying

  if (isEpisode(item)) {
    return {
      isPlaying,
      artistName: item.show?.name ?? "",
      songName: item.name,
      url: item.externalURL["spotify"],
    }
  } else if (isTrack(item)) {
    return {
      isPlaying,
      artistName: item.artists.map((a) => a.name).join(", "),
      songName: item.name,
      url: item.externalURL["spotify"],
    }
  } else {
    return {
      isPlaying: false,
    }
  }
}

export const SpotifyTimeRanges = ["days", "months", "years"] as const
export type SpotifyTimeRange = (typeof SpotifyTimeRanges)[number]

export const SpotifyLimitOptions = [10, 25, 50] as const
export type SpotifyLimitOption = (typeof SpotifyLimitOptions)[number]

export type ValidTimeframe = "days" | "months" | "years"

export const getTopTracks = async ({ limit }) => {
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
      previewUrl: t.previewURL ?? "",
      url: t.externalURL["spotify"],
      thumbnailUrl: t.album?.images[1]?.url,
    }))
  )

  return {
    days,
    months,
    years,
  }
}

export type GetTopTracksResult = Awaited<ReturnType<typeof getTopTracks>>
