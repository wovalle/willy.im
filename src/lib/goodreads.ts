import cheerio from "cheerio"

const publicGoodReadsProfile =
  "https://www.goodreads.com/review/list/70187794-willy-ovalle?sort=date_read&order=d&shelf=read&per_page=10"

const baseGoodReadsUrl = "https://goodreads.com"

export type GoodReadsReview = {
  id: string
  title: string
  author: string | null
  rating: number
  url: string
  finishedOn: string | null
}

export const getReviews = async ({ limit }: { limit: number }): Promise<GoodReadsReview[]> => {
  const goodreadsHtml = await (await fetch(publicGoodReadsProfile)).text()
  const $ = cheerio.load(goodreadsHtml, {
    normalizeWhitespace: true,
  })

  const $rows = $("table#books tbody tr").toArray()

  const books = $rows.map((el) => {
    const $fields = $(el).find("td")

    const titleField = $($fields.get(3)).find(".value a")

    const title = titleField.contents().text().trim()
    const url = titleField.attr("href")
    const author = $($fields.get(4)).contents().last().text().trim()

    const rating = $($fields.get(13)).find("span.p10").length
    const dateRead = $($fields.get(22)).find("span.date_read_value").text()

    const id = el.attribs["id"]

    const [lastName, name] = author
      .replace(/.*\s\*$/, "")
      .split(",")
      .map((v) => v.trim())

    return {
      id,
      title,
      author: `${name} ${lastName}`,
      finishedOn: dateRead ? new Date(dateRead).toISOString() : null,
      rating,
      url: url ? `${baseGoodReadsUrl}/${url}` : "",
    }
  })

  return books
    .sort((a, b) => {
      if (!a.finishedOn) return 1
      else if (!b.finishedOn) return -1
      else return b.finishedOn > a.finishedOn ? 1 : -1
    })
    .slice(0, limit)
}
