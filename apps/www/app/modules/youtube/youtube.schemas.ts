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
  nextPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
})

export const youtubeLikedVideosSchema = z.object({
  videos: z.array(videoSchema),
  updatedAt: z.string(),
  totalVideos: z.number(),
})

export type YoutubeVideo = z.infer<typeof videoSchema>
export type YoutubeLikedVideos = z.infer<typeof youtubeLikedVideosSchema>
