import z from "zod"

import { required } from "@willyim/common"
import { endpoint } from "next-better-api"
import Parser from "rss-parser"
import { ArticleSchema, directus } from "./lib/directus"

const querySchema = z.object({
  secret: z.string(),
  since: z.string().datetime().optional(),
  category: z.string().optional(),
})

// TODO: handle iso dates

export const handleListin = endpoint(
  {
    method: "get",
    querySchema,
    responseSchema: z.object({
      articles: z.array(ArticleSchema),
      count: z.number(),
    }),
  },
  async ({ query }) => {
    const parser = new Parser()

    const secret = await directus.getKVItem("directus_secret_value")

    if (secret !== query.secret) {
      return {
        body: {
          articles: [],
          count: 0,
        },
      }
    }

    const getUrl = (category: string) => `https://listindiario.com/rss/${category}/`

    const feed = await parser.parseURL(getUrl(query.category ?? "portada"))
    const since = query.since ? new Date(query.since) : undefined

    const filteredFeed = since
      ? feed.items.filter((item) => {
          if (!item.isoDate) {
            return false
          }

          return new Date(item.isoDate) > since
        })
      : feed.items

    const articles = filteredFeed.map((item) => {
      const link = new URL(required(item.link, `item.link is missing from item: ${item}`))

      const article = {
        newspaper: "listin_diario",
        slug: link.pathname.slice(1),
        title: item.title,
        author: item.creator,
        link: link.toString(),
        publication_date: item.isoDate,
        content: item["content:encodedSnippet"]
          .replaceAll(`\n\r`, `\n`)
          .replaceAll(`\n\n`, `\n`)
          .replaceAll(`\n\n`, `\n`), // TODO: magic-regexp
        tags: item.categories?.map((c) => c.trim()) ?? [],
      }

      return ArticleSchema.parse(article)
    })

    return { body: { articles, count: articles.length } }
  }
)

export const config = {
  runtime: "nodejs",
}
