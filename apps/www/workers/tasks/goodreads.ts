import { kv } from "../../app/db/schema"
import type { ServiceContext } from "../../app/lib/services"

export async function updateGoodreads({ db, logger, services }: ServiceContext) {
  logger.info("[scheduled] [goodreads] Fetching reviews, currently reading, want to read, and stats...")

  const [reviews, currentlyReading, wantToRead, readingStats] = await Promise.all([
    services.goodreads.getReviews({ limit: 30, trimTitle: false }),
    services.goodreads.getCurrentlyReading({ limit: 100, trimTitle: false }),
    services.goodreads.getWantToRead({ limit: 30, trimTitle: false }),
    services.goodreads.getReadingStats(),
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
