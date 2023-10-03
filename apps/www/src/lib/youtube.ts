import { z } from "zod"
import { refreshAccessToken } from "./google"

const thumbnailDetailsSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
})

export const videoSchema = z.object({
  publishedAt: z.string(),
  channelId: z.string(),
  title: z.string(),
  description: z.string(),
  thumbnails: z.object({
    default: thumbnailDetailsSchema.optional(),
    medium: thumbnailDetailsSchema.optional(),
    high: thumbnailDetailsSchema.optional(),
    standard: thumbnailDetailsSchema.optional(),
    maxres: thumbnailDetailsSchema.optional(),
  }),
  channelTitle: z.string(),
  playlistId: z.string(),
  position: z.number(),
  resourceId: z.object({
    kind: z.string(),
    videoId: z.string(),
  }),
  videoOwnerChannelTitle: z.string().default("(unknown)"),
  videoOwnerChannelId: z.string().default("(unknown)"),
})

export const itemSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  id: z.string(),
  snippet: videoSchema,
})

export const responseSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  items: z.array(itemSchema),
  nextPageToken: z.string(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
})

export type YoutubeVideo = z.infer<typeof videoSchema>

const YOUTUBE_API_HOST = "https://www.googleapis.com/youtube/v3"

export const getLikedVideos = async (opts: {
  maxResults?: number
  pageToken?: string
  userToken: string
  retry?: boolean
  refreshToken: string
}): Promise<YoutubeVideo[]> => {
  const { maxResults, pageToken, userToken } = opts

  const url = new URL(YOUTUBE_API_HOST + "/playlistItems")
  url.searchParams.append("part", "snippet")
  url.searchParams.append("playlistId", "LL")
  url.searchParams.append("maxResults", (maxResults || 50).toString())

  if (pageToken) {
    url.searchParams.append("pageToken", pageToken)
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
  })

  const data = await response.json()

  if (response.status === 401 && !opts.retry) {
    console.log("refreshing access token")
    const r = await refreshAccessToken(opts.refreshToken)

    return getLikedVideos({ ...opts, userToken: r.accessToken, retry: true })
  }

  if (!response.ok) {
    throw { type: "error", data }
  }

  return responseSchema.parse(data).items.map((item) => item.snippet)
}

export const getYouTubeVideoUrlFromVideo = (video: YoutubeVideo) =>
  `https://www.youtube.com/watch?v=${video.resourceId.videoId}`
