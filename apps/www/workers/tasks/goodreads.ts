import { kv } from "../../app/db/schema"
import type { BaseServiceContext } from "../../app/lib/services"
import { createGoodreadsService } from "../../app/modules/goodreads/goodreads.server"

export async function updateGoodreads(ctx: BaseServiceContext) {
  const { db, logger } = ctx
  const goodreads = createGoodreadsService(ctx)

  logger.info("[scheduled] [goodreads] Fetching reviews, currently reading, want to read, and stats...")

  const [reviews, currentlyReading, wantToRead, readingStats] = await Promise.all([
    goodreads.getReviews({ limit: 30, trimTitle: false }),
    goodreads.getCurrentlyReading({ limit: 100, trimTitle: false }),
    goodreads.getWantToRead({ limit: 30, trimTitle: false }),
    goodreads.getReadingStats(),
  ])

  const goodreadsData = {
    reviews,
    currentlyReading,
    wantToRead,
    readingStats,
    updatedAt: new Date().toISOString(),
    totalReviews: reviews.length,
    totalCurrentlyReading: currentlyReading.length,
    totalWantToRead: wantToRead.length,
  }

  await db
    .insert(kv)
    .values({ id: "goodreads.data", value: goodreadsData })
    .onConflictDoUpdate({ target: kv.id, set: { value: goodreadsData } })

  const totalItems = reviews.length + currentlyReading.length + wantToRead.length
  logger.info(`[scheduled] [goodreads] Done: ${reviews.length} reviews, ${currentlyReading.length} reading, ${wantToRead.length} want-to-read`)
  return { count: totalItems }
}
