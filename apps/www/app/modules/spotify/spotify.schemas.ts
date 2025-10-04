import { z } from "zod"

export const spotifyTrackSchema = z.object({
  songName: z.string(),
  artistName: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().optional(),
})

export const spotifyArtistSchema = z.object({
  name: z.string(),
  genres: z.string(),
  thumbnailUrl: z.string(),
  url: z.string(),
})

export const spotifyNowPlayingSchema = z.object({
  isPlaying: z.boolean(),
  songName: z.string().optional(),
  artistName: z.string().optional(),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
})

export const spotifyTopTracksSchema = z.object({
  days: z.array(spotifyTrackSchema),
  months: z.array(spotifyTrackSchema),
  years: z.array(spotifyTrackSchema),
})

export const spotifyTopArtistsSchema = z.object({
  days: z.array(spotifyArtistSchema),
  months: z.array(spotifyArtistSchema),
  years: z.array(spotifyArtistSchema),
})

export const spotifyDataSchema = z.object({
  topTracks: spotifyTopTracksSchema,
  topArtists: spotifyTopArtistsSchema,
  nowPlaying: spotifyNowPlayingSchema.optional(),
  updatedAt: z.string(),
  totalTracks: z.number(),
  totalArtists: z.number(),
})

export type SpotifyTrack = z.infer<typeof spotifyTrackSchema>
export type SpotifyArtist = z.infer<typeof spotifyArtistSchema>
export type SpotifyNowPlaying = z.infer<typeof spotifyNowPlayingSchema>
export type SpotifyTopTracks = z.infer<typeof spotifyTopTracksSchema>
export type SpotifyTopArtists = z.infer<typeof spotifyTopArtistsSchema>
export type SpotifyData = z.infer<typeof spotifyDataSchema>
