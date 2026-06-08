import { data } from "react-router"
import { eq } from "drizzle-orm"
import { marked } from "marked"
import { notes } from "~/db/schema"
import type { Route } from "./+types/view"

export const headers = (): HeadersInit => ({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
})

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: loaderData?.note?.title ?? "Note" },
  { name: "robots", content: "noindex, nofollow" },
]

export const loader = async ({ params, context }: Route.LoaderArgs) => {
  const rows = await context.db.select().from(notes).where(eq(notes.id, params.id))
  const note = rows[0]
  if (!note) throw data("Not found", { status: 404 })

  const renderedContent = marked.parse(note.content) as string
  return { note, renderedContent }
}

export default function NoteView({ loaderData }: Route.ComponentProps) {
  const { note, renderedContent } = loaderData

  return (
    <div className="px-6 py-10 w-full max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">{note.title}</h1>
      <p className="text-xs text-neutral-400 mb-8">
        {note.updated_at.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <div
        className="prose prose-neutral max-w-none"
        dangerouslySetInnerHTML={{ __html: renderedContent }}
      />
    </div>
  )
}
