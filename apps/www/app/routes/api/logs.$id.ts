// GET /api/logs/:id — serve back a log uploaded via POST /api/logs.
//
// No auth: the unguessable UUID is the access control (pastebin model), which
// is what makes "send this link to Willy" work for clients. Kept out of search
// engines and caches via headers.
//
// 200 — streams the R2 object with the original content type and filename
// 404 — unknown id, or index row exists but the R2 object is gone
import { data } from "react-router"
import { eq } from "drizzle-orm"
import { logs } from "~/db/schema"
import type { Route } from "./+types/logs.$id"

export const loader = async ({ params, context }: Route.LoaderArgs) => {
  const rows = await context.db.select().from(logs).where(eq(logs.id, params.id))
  const log = rows[0]
  if (!log) return data({ error: "Not found" }, { status: 404 })

  const object = await context.cloudflare.env.logs_bucket.get(log.id)
  if (!object) return data({ error: "Not found" }, { status: 404 })

  return new Response(object.body, {
    headers: {
      "Content-Type": log.content_type ?? "text/plain",
      "Content-Length": String(log.size),
      "Content-Disposition": `inline; filename="${(log.filename ?? `${log.id}.log`).replace(/"/g, "")}"`,
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "private, no-store",
    },
  })
}
