import { defineDocumentType, makeSource } from "contentlayer/source-files"

export const Post = defineDocumentType(() => ({
  name: "Post",
  filePathPattern: `**/*.mdx`, // Type of file to parse (every mdx in all subfolders)
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
  },
}))

export default makeSource({
  contentDirPath: "content", // Source directory where the content is located
  documentTypes: [Post],
})
