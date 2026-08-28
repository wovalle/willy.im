import { Form, redirect, useActionData } from "react-router"
import { benderArtifacts } from "~/lib/bender.server"
import { requireAdmin } from "~/lib/admin"
import type { Route } from "./+types/new"

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note"

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  await requireAdmin(request, context.services.auth)
  return null
}

export const action = async ({ request, context }: Route.ActionArgs) => {
  await requireAdmin(request, context.services.auth)

  const formData = await request.formData()
  const title = (formData.get("title") as string)?.trim()
  const content = (formData.get("content") as string) ?? ""
  const format = formData.get("format") === "html" ? "html" : "md"

  if (!title) return { error: "Title is required" }

  try {
    const published = await benderArtifacts.publish({
      filename: `${slugify(title)}.${format}`,
      // An empty first save still needs a body: bender refuses empty files.
      content: content || (format === "html" ? "<!doctype html>\n" : `# ${title}\n`),
      title,
    })
    throw redirect(`/artifacts/${published.id}/edit`)
  } catch (err) {
    if (err instanceof Response) throw err
    return { error: err instanceof Error ? err.message : "Publishing failed" }
  }
}

export default function NewArtifact() {
  const actionData = useActionData<typeof action>()

  return (
    <div className="px-6 py-10 w-full max-w-2xl">
      <h1 className="text-2xl font-bold mb-8">New artifact</h1>
      <Form method="post" className="space-y-4">
        {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
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
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="format" value="md" defaultChecked /> Markdown
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="format" value="html" /> HTML
          </label>
        </div>
        <div>
          <textarea
            name="content"
            placeholder="Write in markdown or html..."
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
            href="/artifacts"
            className="px-4 py-2 text-sm text-neutral-600 hover:text-black transition-colors"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  )
}
