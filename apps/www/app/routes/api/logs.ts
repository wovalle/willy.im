// POST /api/logs — pastebin-style log ingestion for scripts I send to clients.
//
// The raw body lands in R2 (`logs_bucket`) and an index row lands in the
// `logs` table; the returned url serves it back via GET /api/logs/:id.
// Auth is a bearer key checked against the `logs_allowed_keys` kv row (a JSON
// array of keys), so keys can be added or rotated with a DB update instead of
// a deploy.
//
// 201 { id, size, url } — stored
// 400 — empty body
// 403 — missing/unknown key (not 401: the cloudflare vite plugin turns 401
//       responses into a dev-server crash, and 403 fits a bad key anyway)
// 405 — non-POST
// 413 — body over MAX_SIZE
import { data } from "react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { kv, logs } from "~/db/schema"
import type { DrizzleClient } from "~/db/drizzle"
import type { Route } from "./+types/logs"

const MAX_SIZE = 25 * 1024 * 1024 // 25MB

const allowedKeysSchema = z.array(z.string())

// A missing or malformed `logs_allowed_keys` row means nobody gets in.
async function isAllowedKey(db: DrizzleClient, request: Request): Promise<boolean> {
  const header = request.headers.get("authorization")
  if (!header?.toLowerCase().startsWith("bearer ")) return false

  const key = header.slice("bearer ".length).trim()
  if (!key) return false

  const rows = await db.select().from(kv).where(eq(kv.id, "logs_allowed_keys"))
  const parsed = allowedKeysSchema.safeParse(rows[0]?.value ?? [])
  return parsed.success && parsed.data.includes(key)
}

export const action = async ({ request, context }: Route.ActionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 })
  }

  if (!(await isAllowedKey(context.db, request))) {
    return data({ error: "Unauthorized" }, { status: 403 })
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > MAX_SIZE) {
    return data({ error: `Payload too large (max ${MAX_SIZE} bytes)` }, { status: 413 })
  }

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) {
    return data({ error: "Empty body" }, { status: 400 })
  }
  if (body.byteLength > MAX_SIZE) {
    return data({ error: `Payload too large (max ${MAX_SIZE} bytes)` }, { status: 413 })
  }

  const url = new URL(request.url)
  const id = crypto.randomUUID()
  const filename = url.searchParams.get("filename")
  const client = url.searchParams.get("client")

  // curl sends x-www-form-urlencoded by default; these are log files, not forms
  const rawContentType = request.headers.get("content-type")
  const contentType =
    !rawContentType || rawContentType === "application/x-www-form-urlencoded"
      ? "text/plain"
      : rawContentType

  await context.cloudflare.env.logs_bucket.put(id, body, {
    httpMetadata: { contentType },
    customMetadata: {
      ...(filename ? { filename } : {}),
      ...(client ? { client } : {}),
    },
  })

  await context.db.insert(logs).values({
    id,
    filename,
    client,
    content_type: contentType,
    size: body.byteLength,
    created_at: new Date(),
  })

  context.logger.info(`[logs] Stored log ${id} (${body.byteLength} bytes, client=${client ?? "unknown"})`)

  return data({ id, size: body.byteLength, url: `${url.origin}/api/logs/${id}` }, { status: 201 })
}
