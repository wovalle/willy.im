import { defineCollection, defineConfig } from "@content-collections/core"
import { compileMarkdown } from "@content-collections/markdown"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"
import { z } from "zod"

const posts = defineCollection({
  name: "posts",
  directory: "app/mdx/posts",
  include: "**/*.md",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    publishedAt: z.string(),
    updatedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  transform: async (document, context) => {
    const md = await compileMarkdown(context, document, {
      rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
      remarkPlugins: [remarkGfm],
    })

    return {
      ...document,
      md,
    }
  },
})

const singletons = defineCollection({
  name: "singletons",
  directory: "app/mdx",
  include: "*.md",
  schema: z.object({
    name: z.string(),
    createdAt: z.string(),
  }),
  transform: async (document, context) => {
    const md = await compileMarkdown(context, document, {
      rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
      remarkPlugins: [remarkGfm],
    })

    return {
      ...document,
      md,
    }
  },
})

export default defineConfig({
  collections: [posts, singletons],
})
