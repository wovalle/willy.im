import { redirect, Form, useActionData } from "react-router"
import { notes } from "~/db/schema"
import type { Route } from "./+types/new"

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")
  return null
}

export const action = async ({ request, context }: Route.ActionArgs) => {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")

  const formData = await request.formData()
  const title = (formData.get("title") as string)?.trim()
  const content = (formData.get("content") as string) ?? ""

  if (!title) return { error: "Title is required" }

  const id = crypto.randomUUID()
  const now = new Date()

  await context.db.insert(notes).values({ id, title, content, created_at: now, updated_at: now })

  throw redirect(`/notes/${id}`)
}

export default function NewNote() {
  const actionData = useActionData<typeof action>()

  return (
    <div className="px-6 py-10 w-full max-w-2xl">
      <h1 className="text-2xl font-bold mb-8">New note</h1>
      <Form method="post" className="space-y-4">
        {actionData?.error && (
          <p className="text-sm text-red-600">{actionData.error}</p>
        )}
        <div>
          <input
            type="text"
            name="title"
            placeholder="Title"
            autoFocus
            required
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div>
          <textarea
            name="content"
            placeholder="Write in markdown..."
            rows={16}
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-y"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-neutral-800 transition-colors"
          >
            Create note
          </button>
          <a
            href="/notes"
            className="px-4 py-2 text-sm text-neutral-600 hover:text-black transition-colors"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  )
}
