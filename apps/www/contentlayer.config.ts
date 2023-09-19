import { defineDocumentType, makeSource } from "contentlayer/source-files"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

export const Post = defineDocumentType(() => ({
  name: "Post",
  filePathPattern: `posts/**/*.mdx`, // Type of file to parse (every mdx in all subfolders)
  contentType: "mdx",
  fields: {
    title: {
      type: "string",
      description: "The title of the post",
      required: true,
    },
    summary: {
      type: "string",
      description: "Summary",
      required: true,
    },
    published: {
      type: "date",
      description: "Publish date",
      required: true,
    },
    updated: {
      type: "date",
      description: "Update date",
      required: false,
    },
    tags: {
      type: "list",
      of: { type: "string" },
      description: "Tags",
      required: false,
    },
  },
  computedFields: {
    path: {
      type: "string",
      resolve: (post) => post._raw.flattenedPath,
    },
    slug: {
      type: "string",
      resolve: (post) => post._raw.flattenedPath.split("/").at(-1),
    },
  },
}))

export const Global = defineDocumentType(() => ({
  name: "Global",
  filePathPattern: `global/**/*.mdx`,
  contentType: "mdx",
  fields: {
    type: {
      type: "string",
      required: false,
    },
  },
  computedFields: {
    path: {
      type: "string",
      resolve: (post) => post._raw.flattenedPath,
    },
  },
}))

export default makeSource({
  contentDirPath: "content",
  documentTypes: [Post, Global],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings]],
  },
})
