import { remark } from "remark"
import html from "remark-html"

export async function toHtml(markdown: string) {
  const result = await remark().use(html).process(markdown)
  return result.toString()
}
