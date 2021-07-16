import { Client, Episode, Track } from "spotify-api.js"

const clientId = process.env.SPOTIFY_CLIENT_ID
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN

export interface SimpleSpotifySong {
  songName: string
  artistName: string
  url: string
}

export type SimpleNowPlaying = Partial<SimpleSpotifySong> & { isPlaying: boolean }

function isEpisode(item: Track | Episode | null): item is Episode {
  return item?.type === "episode"
}

function isTrack(item: Track | Episode | null): item is Track {
  return item?.type === "track"
}

const createSpotifyClient = async (): Promise<Client> => {
  const client = new Client()

  await client.login({
    clientID: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken,
    redirectURL: "url",
  })

  return client
}

export const getNowPlaying = async (): Promise<SimpleNowPlaying> => {
  const client = await createSpotifyClient()
  const nowPlaying = await client.user.player.getCurrentlyPlaying({ additionalTypes: "episode" })

  if (!nowPlaying) {
    return {
      isPlaying: false,
    }
  }

  const { item, playing } = nowPlaying
  let artistName = ""

  if (isEpisode(item)) {
    artistName = item.show?.name || ""
  } else if (isTrack(item)) {
    artistName = item.artists.map((a) => a.name).join(", ")
  }

  return {
    isPlaying: playing,
    artistName,
    songName: item?.name,
    url: item?.externalUrls["spotify"],
  }
}

export const getTopTracks = async (): Promise<SimpleSpotifySong[]> => {
  const client = await createSpotifyClient()

  const tracks = await client.user.getTopTracks({ limit: 10 })

  return tracks.items.map((t) => ({
    songName: t.name,
    artistName: t.artists.map((m) => m.name).join(", "),
    url: t.previewUrl || "",
  }))
}
