// Compile-time only: a collection's load built on the drizzle helpers, imported by name.
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { collection } from "@willyim/kit"
import { cursorWhere, orderFor } from "@willyim/kit/collection/drizzle"
import { z } from "zod"

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  createdAt: text("created_at").notNull(),
})
const db = drizzle(async () => ({ rows: [] }))

export const list = collection({
  summary: "List notes.",
  permission: "todos:read",
  row: z.object({ id: z.string(), workspaceId: z.string(), createdAt: z.string() }),
  fields: { default: ["id", "createdAt"] },
  sorts: { created: { dir: "desc", key: (r) => r.createdAt } },
  defaultSort: "created",
  limit: { default: 50, max: 200 },
  meta: { workspace: z.string() },
  load: async ({ after, dir, limit }) => {
    const columns = [notes.createdAt, notes.id]
    if (after) after.key satisfies string
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.workspaceId, "w1"), cursorWhere(columns, after, dir)))
      .orderBy(...orderFor(columns, dir))
      .limit(limit)
    return { rows, meta: { workspace: "w1" } }
  },
})

export async function page() {
  const p = await list()
  p.meta?.workspace satisfies string | undefined
}
