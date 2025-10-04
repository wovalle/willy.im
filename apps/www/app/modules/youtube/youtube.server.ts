import { declareService, type BaseServiceContext } from "../../lib/services"
import {
  responseSchema,
  youtubeLikedVideosSchema,
  type YoutubeLikedVideos,
  type YoutubeVideo,
} from "./youtube.schemas"

const YOUTUBE_API_HOST = "https://www.googleapis.com/youtube/v3"

export const createYoutubeService = declareService("youtube", (context: BaseServiceContext) => {
  const getLikedVideos = async (opts: {
    maxResults?: number
    pageToken?: string
    userToken: string
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

    if (!response.ok) {
      context.logger.error("YouTube API error:", data)
      throw { type: "error", data }
    }

    return responseSchema.parse(data).items.map((item) => item.snippet)
  }

  const getYouTubeVideoUrlFromVideo = (video: YoutubeVideo) =>
    `https://www.youtube.com/watch?v=${video.resourceId.videoId}`

  const getFromCache = async (): Promise<YoutubeLikedVideos> => {
    const placeholder = {
      videos: [],
      updatedAt: "",
      accountId: "",
      totalVideos: 0,
    }

    try {
      const kvData = await context.db.query.kv.findFirst({
        where: (kv, { eq }) => eq(kv.id, "youtube.liked-videos"),
      })

      if (!kvData?.value) {
        return placeholder
      }

      return youtubeLikedVideosSchema.parse(kvData.value)
    } catch (error) {
      context.logger.error("Error parsing cached YouTube data:", error)
      return placeholder
    }
  }

  return {
    getLikedVideos,
    getYouTubeVideoUrlFromVideo,
    getFromCache,
  }
})

export type YoutubeService = ReturnType<typeof createYoutubeService>
