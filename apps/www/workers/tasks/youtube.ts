import { kv } from "../../app/db/schema"
import type { ServiceContext } from "../../app/lib/services"

export async function updateYoutube({ db, logger, services, getAppEnv }: ServiceContext) {
  logger.info("[scheduled] [youtube] Fetching access token...")

  const { accessToken } = await services.auth.api.getAccessToken({
    body: {
      providerId: "google",
      userId: getAppEnv("STATIC_ACCOUNT_ID"),
    },
  })

  if (!accessToken) {
    throw new Error("No valid access token found")
  }

  logger.info("[scheduled] [youtube] Access token obtained, fetching liked videos...")

  const videos = await services.youtube.getLikedVideos({ userToken: accessToken, maxResults: 30 })

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
