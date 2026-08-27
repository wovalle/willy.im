// GET /api/logs/:id — serve back a log uploaded via POST /api/logs.
//
// No auth: the unguessable UUID is the access control (pastebin model), which
// is what makes "send this link to Willy" work for clients. Kept out of search
// engines and caches via headers.
//
// 200 — streams the R2 object; the stored content type is honored only for
//       the inline-safe allowlist below, everything else downloads
// 404 — unknown id, or index row exists but the R2 object is gone
import { data } from "react-router"
import { eq } from "drizzle-orm"
import { logs } from "~/db/schema"
import type { Route } from "./+types/logs.$id"

// Types safe to serve inline on willy.im's own origin. Anything else (html,
// svg, whatever the uploader claimed) downloads as octet-stream: this route is
// public-by-UUID, and rendering uploader-controlled HTML here would be stored
// XSS on the origin that holds the auth cookies.
const INLINE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

export const loader = async ({ params, context }: Route.LoaderArgs) => {
  const rows = await context.db.select().from(logs).where(eq(logs.id, params.id))
  const log = rows[0]
  if (!log) return data({ error: "Not found" }, { status: 404 })

  const object = await context.cloudflare.env.logs_bucket.get(log.id)
  if (!object) return data({ error: "Not found" }, { status: 404 })

  const inline = INLINE_TYPES.has(log.content_type ?? "")
  return new Response(object.body, {
    headers: {
      "Content-Type": inline ? (log.content_type as string) : "application/octet-stream",
      "Content-Length": String(log.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(log.filename ?? `${log.id}.log`).replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "private, no-store",
    },
  })
}
