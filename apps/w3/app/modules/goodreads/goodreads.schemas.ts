import { z } from "zod"

export const goodreadsReviewSchema = z.object({
  title: z.string(),
  author: z.string(),
  rating: z.number(),
  url: z.string(),
  finishedOn: z.string().nullable(),
})

export const goodreadsReadingStatsSchema = z.object({
  totalRead: goodreadsReviewSchema.nullable(),
  currentlyReading: goodreadsReviewSchema.nullable(),
  wantToRead: goodreadsReviewSchema.nullable(),
})

export const goodreadsDataSchema = z.object({
  reviews: z.array(goodreadsReviewSchema),
  currentlyReading: z.array(goodreadsReviewSchema),
  wantToRead: z.array(goodreadsReviewSchema),
  readingStats: goodreadsReadingStatsSchema,
  updatedAt: z.string(),
  totalReviews: z.number(),
  totalCurrentlyReading: z.number(),
  totalWantToRead: z.number(),
})

export type GoodreadsReview = z.infer<typeof goodreadsReviewSchema>
export type GoodreadsReadingStats = z.infer<typeof goodreadsReadingStatsSchema>
export type GoodreadsData = z.infer<typeof goodreadsDataSchema>
