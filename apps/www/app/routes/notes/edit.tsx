import { data, redirect, Form, useActionData, useNavigation } from "react-router"
import { eq } from "drizzle-orm"
import { marked } from "marked"
import { useState } from "react"
import { notes } from "~/db/schema"
import type { Route } from "./+types/edit"

export const headers = (): HeadersInit => ({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
})

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `Edit: ${loaderData?.note?.title ?? "Note"}` },
  { name: "robots", content: "noindex, nofollow" },
]

export const loader = async ({ request, params, context }: Route.LoaderArgs) => {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")

  const rows = await context.db.select().from(notes).where(eq(notes.id, params.id))
  const note = rows[0]
  if (!note) throw data("Not found", { status: 404 })

  return { note }
}

export const action = async ({ request, params, context }: Route.ActionArgs) => {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")

  const formData = await request.formData()
  const intent = formData.get("intent")

  if (intent === "delete") {
    await context.db.delete(notes).where(eq(notes.id, params.id))
    throw redirect("/notes")
  }

  const title = (formData.get("title") as string)?.trim()
  const content = (formData.get("content") as string) ?? ""

  if (!title) return { error: "Title is required" }

  await context.db
    .update(notes)
    .set({ title, content, updated_at: new Date() })
    .where(eq(notes.id, params.id))

  throw redirect(`/notes/${params.id}`)
}

export default function EditNote({ loaderData }: Route.ComponentProps) {
  const { note } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [tab, setTab] = useState<"write" | "preview">("write")

  const previewHtml = marked.parse(content) as string

  return (
    <div className="px-6 py-10 w-full max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Edit note</h1>
        <a href={`/notes/${note.id}`} className="text-sm text-neutral-500 hover:text-black transition-colors">
          View
        </a>
      </div>

      <Form method="post" className="space-y-4">
        {actionData?.error && (
          <p className="text-sm text-red-600">{actionData.error}</p>
        )}
        <div>
          <input
            type="text"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            required
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <div>
          <div className="flex gap-1 mb-2">
            <button
              type="button"
              onClick={() => setTab("write")}
              className={`px-3 py-1 text-xs rounded ${tab === "write" ? "bg-black text-white" : "text-neutral-500 hover:text-black"}`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={`px-3 py-1 text-xs rounded ${tab === "preview" ? "bg-black text-white" : "text-neutral-500 hover:text-black"}`}
            >
              Preview
            </button>
          </div>

          {tab === "write" ? (
            <textarea
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={20}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-y"
            />
          ) : (
            <>
              <input type="hidden" name="content" value={content} />
              <div
                className="prose prose-neutral max-w-none min-h-48 border border-neutral-200 rounded-md px-3 py-2"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Saving…" : "Save"}
            </button>
            <a
              href="/notes"
              className="px-4 py-2 text-sm text-neutral-600 hover:text-black transition-colors"
            >
              Cancel
            </a>
          </div>
          <button
            type="submit"
            name="intent"
            value="delete"
            disabled={isSubmitting}
            className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
            onClick={(e) => {
              if (!confirm("Delete this note?")) e.preventDefault()
            }}
          >
            Delete
          </button>
        </div>
      </Form>
    </div>
  )
}
