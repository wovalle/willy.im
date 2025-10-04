import { parseURL } from "~/lib/rss"
import { declareService, type BaseServiceContext } from "~/lib/services"
import type { GoodreadsReview } from "./goodreads.schemas"
import { goodreadsDataSchema, type GoodreadsData } from "./goodreads.schemas"

type ParseFeedOptions = {
  limit: number
  trimTitle: boolean
}

export const createGoodreadsService = declareService("goodreads", (context: BaseServiceContext) => {
  const getHtmlContentField = (html: string | undefined, field: string) => {
    if (!html) {
      return null
    }

    const res = html.match(new RegExp(`  ${field}:(?<field>[^<]*)<br`))
    return res ? res[1].trim() : null
  }

  const asNumber = (str: string | null) => (str ? Number.parseInt(str.trim()) : null)

  const parseDate = (dateString: string | null | undefined): string | null => {
    if (!dateString) return null

    try {
      const date = new Date(dateString)
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        context.logger.warn(`Invalid date: "${dateString}"`)
        return null
      }
      return date.toISOString()
    } catch (error) {
      context.logger.warn(`Date parsing error for "${dateString}":`, error)
      return null
    }
  }

  const parseFeed = async (
    shelf: string,
    options: ParseFeedOptions = { limit: 10, trimTitle: false },
  ): Promise<GoodreadsReview[]> => {
    try {
      const baseRss = `https://www.goodreads.com/review/list_rss/70187794`
      const rssKey = context.getAppEnv("GOODREADS_KEY")

      const feed = await parseURL(
        `${baseRss}?key=${rssKey}&shelf=${shelf}&per_page=${options.limit}`,
      )

      return feed.items.map((i) => {
        const title = (i.title ?? "").trim()

        return {
          title: options.trimTitle && title.length > 40 ? title.slice(0, 37) + "..." : title,
          url: i.link ?? "",
          finishedOn: parseDate(i.pubDate),
          rating: asNumber(getHtmlContentField(i.content, "rating")) ?? 0,
          author: getHtmlContentField(i.content, "author") ?? "<unknown>",
        }
      })
    } catch (error) {
      context.logger.error("Error parsing Goodreads feed:", error)
      throw error
    }
  }

  const getReviews = async (opts: ParseFeedOptions): Promise<GoodreadsReview[]> => {
    return parseFeed("read", opts)
  }

  const getCurrentlyReading = async (opts: ParseFeedOptions): Promise<GoodreadsReview[]> => {
    return parseFeed("currently-reading", opts)
  }

  const getWantToRead = async (opts: ParseFeedOptions): Promise<GoodreadsReview[]> => {
    return parseFeed("to-read", opts)
  }

  const getReadingStats = async () => {
    try {
      const [reviews, currentlyReading, wantToRead] = await Promise.all([
        getReviews({ limit: 1, trimTitle: false }),
        getCurrentlyReading({ limit: 1, trimTitle: false }),
        getWantToRead({ limit: 1, trimTitle: false }),
      ])

      return {
        totalRead: reviews.length > 0 ? reviews[0] : null,
        currentlyReading: currentlyReading.length > 0 ? currentlyReading[0] : null,
        wantToRead: wantToRead.length > 0 ? wantToRead[0] : null,
      }
    } catch (error) {
      context.logger.error("Error fetching reading stats:", error)
      throw error
    }
  }

  const getFromCache = async (): Promise<GoodreadsData> => {
    const placeholder = {
      reviews: [],
      currentlyReading: [],
      wantToRead: [],
      readingStats: {
        totalRead: null,
        currentlyReading: null,
        wantToRead: null,
      },
      updatedAt: "",
      totalReviews: 0,
      totalCurrentlyReading: 0,
      totalWantToRead: 0,
    }
    try {
      const kvData = await context.db.query.kv.findFirst({
        where: (kv, { eq }) => eq(kv.id, "goodreads.data"),
      })

      if (!kvData?.value) {
        return placeholder
      }

      return goodreadsDataSchema.parse(kvData.value)
    } catch (error) {
      context.logger.error("Error parsing cached Goodreads data:", error)
      return placeholder
    }
  }

  return {
    getReviews,
    getCurrentlyReading,
    getWantToRead,
    getReadingStats,
    getFromCache,
  }
})

export type GoodreadsService = ReturnType<typeof createGoodreadsService>
