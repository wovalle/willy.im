import { default as Parser } from "rss-parser"

const baseRss =
  "https://www.goodreads.com/review/list_rss/70187794?key=nMuMcqozBM267q8gVxE1lcD5d1nBarjTob0CTAfF3RQrFaly&v=2"

const getHtmlContentField = (html: string | undefined, field: string) => {
  if (!html) {
    return null
  }

  const res = html.match(new RegExp(`  ${field}:(?<field>[^<]*)<br`))
  return res ? res[1].trim() : null
}

const asNumber = (str: string | null) => (str ? Number.parseInt(str.trim()) : null)

export type GoodReadsReview = {
  title: string
  author: string
  rating: number
  url: string
  finishedOn: string | null
}

type ParseFeedOptions = {
  limit: number
  trimTitle: boolean
}

const parseFeed = async (
  shelf: string,
  options: ParseFeedOptions = { limit: 10, trimTitle: false }
): Promise<GoodReadsReview[]> => {
  const parser = new Parser()
  const feed = await parser.parseURL(`${baseRss}&shelf=${shelf}&per_page=${options.limit}`)

  const items = feed.items.length ? feed.items : [feed.item]

  return items.map((i) => {
    const title = (i.title ?? "").trim()

    return {
      title: options.trimTitle && title.length > 40 ? title.slice(0, 37) + "..." : title,
      url: i.link ?? "",
      finishedOn: i.pubDate ? new Date(i.pubDate).toISOString() : null,
      rating: asNumber(getHtmlContentField(i.content, "rating")) ?? 0,
      author: getHtmlContentField(i.content, "author") ?? "<unknown>",
    }
  })
}

export const getReviews = async (opts: ParseFeedOptions): Promise<GoodReadsReview[]> => {
  return parseFeed("read", opts)
}

export const getCurrentlyReading = async (opts: ParseFeedOptions): Promise<GoodReadsReview[]> => {
  return parseFeed("currently-reading", opts)
}
