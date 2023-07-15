import { z } from "zod"

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
    default: thumbnailDetailsSchema,
    medium: thumbnailDetailsSchema,
    high: thumbnailDetailsSchema,
    standard: thumbnailDetailsSchema,
    maxres: thumbnailDetailsSchema.optional(),
  }),
  channelTitle: z.string(),
  playlistId: z.string(),
  position: z.number(),
  resourceId: z.object({
    kind: z.string(),
    videoId: z.string(),
  }),
  videoOwnerChannelTitle: z.string(),
  videoOwnerChannelId: z.string(),
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
}) => {
  const { maxResults, pageToken, userToken } = opts

  const url = new URL(YOUTUBE_API_HOST + "/playlistItems")
  url.searchParams.append("part", "snippet")
  url.searchParams.append("playlistId", "LL")
  url.searchParams.append("maxResults", maxResults?.toString() ?? "50")

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

  return responseSchema.parse(data).items.map((i) => i.snippet)
}

export const getYouTubeVideoUrlFromVideo = (video: YoutubeVideo) =>
  `https://www.youtube.com/watch?v=${video.resourceId.videoId}`
