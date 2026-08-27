// /artifacts/:id renders nothing itself — the public rendered page is the
// artifact URL on bender. This route only resolves ids to that URL:
//   - a bender artifact id redirects to its public URL
//   - a pre-migration note id redirects via the `note_redirect:<id>` kv row
//     the migration script wrote (scripts/migrate-notes-to-bender.mjs)
import { data, redirect } from "react-router"
import { eq } from "drizzle-orm"
import { kv } from "~/db/schema"
import { benderArtifacts } from "~/lib/bender.server"
import type { Route } from "./+types/view"

export const loader = async ({ params, context }: Route.LoaderArgs) => {
  const artifact = await benderArtifacts.get(params.id).catch(() => null)
  if (artifact?.url) throw redirect(artifact.url)

  const rows = await context.db
    .select()
    .from(kv)
    .where(eq(kv.id, `note_redirect:${params.id}`))
  const value = rows[0]?.value as { url?: string } | undefined
  if (value?.url) throw redirect(value.url)

  throw data("Not found", { status: 404 })
}
