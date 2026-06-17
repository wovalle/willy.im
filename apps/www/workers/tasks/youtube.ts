import { kv } from "../../app/db/schema"
import type { BaseServiceContext } from "../../app/lib/services"
import { createAuthService } from "../../app/lib/auth.server"
import { createYoutubeService } from "../../app/modules/youtube/youtube.server"

export async function updateYoutube(ctx: BaseServiceContext) {
  const { db, logger, getAppEnv } = ctx
  const auth = createAuthService(ctx)
  const youtube = createYoutubeService(ctx)

  logger.info("[scheduled] [youtube] Fetching access token...")

  const { accessToken } = await auth.api.getAccessToken({
    body: {
      providerId: "google",
      userId: getAppEnv("STATIC_ACCOUNT_ID"),
    },
  })

  if (!accessToken) {
    throw new Error("No valid access token found")
  }

  logger.info("[scheduled] [youtube] Access token obtained, fetching liked videos...")

  const videos = await youtube.getLikedVideos({ userToken: accessToken, maxResults: 30 })

  const youtubeData = {
    videos,
    updatedAt: new Date().toISOString(),
    totalVideos: videos.length,
  }

  await db
    .insert(kv)
    .values({ id: "youtube.liked-videos", value: youtubeData })
    .onConflictDoUpdate({ target: kv.id, set: { value: youtubeData } })

  logger.info(`[scheduled] [youtube] Done: ${videos.length} videos stored`)
  return { count: videos.length }
}
