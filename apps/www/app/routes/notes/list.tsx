import { Link, redirect } from "react-router"
import { desc } from "drizzle-orm"
import { notes } from "~/db/schema"
import type { Route } from "./+types/list"

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")

  const allNotes = await context.db.select().from(notes).orderBy(desc(notes.created_at))
  return { notes: allNotes }
}

export default function NotesList({ loaderData }: Route.ComponentProps) {
  const { notes } = loaderData

  return (
    <div className="px-6 py-10 w-full">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Notes</h1>
        <Link
          to="/notes/new"
          className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-neutral-800 transition-colors"
        >
          New note
        </Link>
      </div>

      {notes.length === 0 ? (
        <p className="text-neutral-500 text-sm">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="flex items-center justify-between gap-4 py-3 border-b border-neutral-100">
              <div className="min-w-0">
                <Link
                  to={`/notes/${note.id}`}
                  className="font-medium hover:underline truncate block"
                >
                  {note.title}
                </Link>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {note.updated_at.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <Link
                to={`/notes/${note.id}/edit`}
                className="text-xs text-neutral-500 hover:text-black transition-colors shrink-0"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
