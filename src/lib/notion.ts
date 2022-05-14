import {
  databaseFilterBuilder,
  databaseSortBuilder,
  getAllProperties,
  getChildBlocksWithChildrenRecursively,
  inferDatabaseSchema,
  isFullPage,
  Page,
  propertyFilterBuilder,
  richTextAsPlainText,
} from "@jitl/notion-api"
import { Client } from "@notionhq/client"
import { ListBlockChildrenResponse } from "@notionhq/client/build/src/api-endpoints"
import { respond, respondError } from "./operation"

export type ListBlockResults = ListBlockChildrenResponse["results"]
export type NotionBlock = ListBlockResults[number]

// TODO: infer from schema
export type PageProperties = {
  slug: string
  title: string
  publishedAt: string | null
  createdAt: string | null
  editedAt: string | null
  categories: string[]
  showEdited: boolean
}

const notionClient = new Client({ auth: process.env.NOTION_TOKEN })
const dbId = process.env.NOTION_DATABASE_ID ?? ""

const postSchema = inferDatabaseSchema({
  title: { type: "title", name: "Title" },
  slug: { type: "rich_text", name: "Slug" },
  publishedAt: { type: "date", name: "Published At" },
  category: { type: "multi_select", name: "Category" },
  editedAt: { type: "last_edited_time", name: "Edited At" },
  createdAt: { type: "created_time", name: "Created At" },
  showEdited: { type: "checkbox", name: "Show Edited" },
})

const transformPageProperties = (page: Page): PageProperties => {
  const props = getAllProperties(page, postSchema)

  return {
    slug: richTextAsPlainText(props.slug),
    title: richTextAsPlainText(props.title),
    publishedAt: props.publishedAt ? props.publishedAt.start : null,
    categories: props.category ? props.category.map((c) => c.name) : [],
    showEdited: props.showEdited ?? false,
    editedAt: props.editedAt ? props.editedAt : null,
    createdAt: props.createdAt ? props.createdAt : null,
  }
}

export const getNotionPageBySlug = async (slug: string) => {
  const response = await notionClient.databases.query({
    database_id: dbId,
    filter: databaseFilterBuilder(postSchema).and(
      propertyFilterBuilder(postSchema.publishedAt).is_not_empty(true),
      propertyFilterBuilder(postSchema.slug).equals(slug)
    ),
  })

  if (response.results.length === 0) {
    return null
  }

  return response.results[0]
}

export const getFullPageBySlug = async (slug: string | string[] | undefined) => {
  if (typeof slug !== "string") {
    return respondError(`Invalid slug: ${slug}`)
  }

  const page = await getNotionPageBySlug(slug)

  if (!page) {
    return respondError("Page not found")
  }

  const blocks = await getChildBlocksWithChildrenRecursively(notionClient, page.id)

  return respond({ blocks, properties: transformPageProperties(page as Page) })
}

export const getPublicPosts = async () => {
  const response = await notionClient.databases.query({
    database_id: dbId,
    filter: databaseFilterBuilder(postSchema).and(
      propertyFilterBuilder(postSchema.publishedAt).is_not_empty(true)
    ),
    sorts: [databaseSortBuilder(postSchema).publishedAt.descending],
  })

  return response.results
    .filter((p) => isFullPage(p))
    .map((p) => transformPageProperties(p as Page))
}