import { z } from "zod"

const IMAGE: unique symbol = Symbol.for("kit.image")

export type KitImage = {
  /** Base64, no `data:` prefix. */
  data: string
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
}

/**
 * An image in a method's output. `/api` returns it as JSON; MCP and agent
 * adapters send it as a real image block.
 *
 *   output: { url: z.string(), image: kitImage }
 *
 * Parsing tags the parsed object (a hidden symbol), which is how `tools()`
 * finds images in a value without walking the schema.
 */
export const kitImage = z
  .object({
    data: z.string().describe("Base64-encoded image bytes."),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  })
  .overwrite((image) => {
    Object.defineProperty(image, IMAGE, { value: true })
    return image
  })

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Pulls every tagged image out of a parsed output. Each one stays in the data
 * with its `data` replaced by a short reference, so the value still fits the
 * output schema and a model never reads the base64 as text.
 */
export function splitImages(value: unknown): { data: unknown; images: KitImage[] } {
  const images: KitImage[] = []
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v === null || typeof v !== "object" || !isPlain(v)) return v
    if (IMAGE in v) {
      const image = v as unknown as KitImage
      images.push({ data: image.data, mediaType: image.mediaType })
      return { ...image, data: `(image ${images.length}, attached as an image block)` }
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
  }
  return { data: walk(value), images }
}
