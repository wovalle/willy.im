import z from "zod"

import { required } from "@willyim/common"
import { endpoint } from "next-better-api"
import Parser from "rss-parser"
import { directus } from "./lib/directus"

const rssItemSchema = z.object({
  title: z.string(),
  author: z.string(),
  url: z.string(),
  content: z.string(),
  publication_date: z.string().datetime(),
  tags: z.array(z.string()),
  raw: z.object({}).optional(),
})

// TODO: add support for iso dates
const bodySchema = z.object({
  secret: z.string(),
  since: z.string().datetime().optional(),
  feeds: z.array(
    z.object({
      id: z.string(),
      urls: z.array(z.string()),
      fieldsConfig: z
        .object({
          publicationDate: z.string(),
          urlField: z.string(),
          content: z.string(),
          categories: z.string(),
          title: z.string(),
          author: z.string(),
        })
        .optional(),
    })
  ),
})

const responseSchema = z.object({
  result: z.array(
    z.object({
      items: z.array(rssItemSchema),
      id: z.string(),
    })
  ),
  errors: z
    .array(
      z.object({
        id: z.string(),
        error: z.string(),
      })
    )
    .optional(),
})

export const handleRSS = endpoint(
  {
    method: "post",
    bodySchema,
    responseSchema,
  },
  async ({ body }) => {
    const parser = new Parser()

    const secret = await directus.getKVItem("directus_secret_value")
    const since = body.since ? new Date(body.since) : undefined

    const result: z.infer<typeof responseSchema>["result"] = []
    const errors: z.infer<typeof responseSchema>["errors"] = []

    if (secret !== body.secret) {
      return {
        body: {
          result: [],
        },
      }
    }

    for (const feed of body.feeds) {
      const fields = {
        ...feed.fieldsConfig,
        publicationDate: "isoDate",
        urlField: "link",
        content: "content:encodedSnippet",
        categories: "categories",
        title: "title",
        author: "creator",
      }

      const feedsSettled = await Promise.allSettled(feed.urls.map((u) => parser.parseURL(u)))

      feedsSettled.forEach((settled) => {
        if (settled.status === "rejected") {
          errors.push({
            id: feed.id,
            error: JSON.stringify({ type: "promise_rejected", error: settled.reason }),
          })
        } else {
          const filteredFeeds = settled.value.items.filter((feed) => {
            return since
              ? feed.items.filter((item: any) => {
                  const dateField = item[fields.publicationDate]

                  if (!dateField) {
                    return false
                  }

                  return new Date(dateField) > since
                })
              : settled.value.items
          })

          const rssItems: z.infer<typeof rssItemSchema>[] = []

          filteredFeeds.forEach((item) => {
            const url = new URL(
              required(item[fields.urlField], `item.link is missing from item: ${item}`)
            )

            const rssItem = {
              title: item[fields.title],
              author: item[fields.author],
              url: url.toString(),
              publication_date: item[fields.publicationDate],
              content: item[fields.content],
              tags: item[fields.categories],
            }

            const parsed = rssItemSchema.safeParse(rssItem)

            if (parsed.success) {
              rssItems.push(parsed.data)
            } else {
              errors.push({
                id: feed.id,
                error: JSON.stringify({ url: url.toString(), error: parsed.error.message }),
              })
            }
          })

          result.push({
            id: feed.id,
            items: rssItems,
          })
        }
      })
    }

    return { body: { result, errors } }
  }
)

export const config = {
  runtime: "nodejs",
}
