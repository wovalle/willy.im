export const SpotifyTimeRanges = ["days", "months", "years"] as const
export type SpotifyTimeRange = (typeof SpotifyTimeRanges)[number]

export const SpotifyLimitOptions = [10, 25, 50] as const
export type SpotifyLimitOption = (typeof SpotifyLimitOptions)[number]

export type GetTopTracksResult = {
  [K in SpotifyTimeRange]: {
    songName: string
    artistName: string
    url: string
    thumbnailUrl?: string | undefined
  }[]
}

export type GetTopArtistsResult = {
  [K in SpotifyTimeRange]: {
    name: string
    genres: string
    thumbnailUrl?: string
    url: string
  }[]
}

export type SpotifyClientInitOpts = {
  clientId: string
  clientSecret: string
}
