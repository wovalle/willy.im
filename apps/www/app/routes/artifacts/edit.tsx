import { data, redirect, Form, useActionData, useNavigation } from "react-router"
import { marked } from "marked"
import { useState } from "react"
import { benderArtifacts } from "~/lib/bender.server"
import { requireAdmin } from "~/lib/admin"
import type { Route } from "./+types/edit"

export const headers = (): HeadersInit => ({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
})

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `Edit: ${loaderData?.artifact?.title ?? "Artifact"}` },
  { name: "robots", content: "noindex, nofollow" },
]

export const loader = async ({ request, params, context }: Route.LoaderArgs) => {
  await requireAdmin(request, context.services.auth)

  const artifact = await benderArtifacts.get(params.id)
  if (!artifact) throw data("Not found", { status: 404 })

  return { artifact }
}

export const action = async ({ request, params, context }: Route.ActionArgs) => {
  await requireAdmin(request, context.services.auth)

  const formData = await request.formData()
  const intent = formData.get("intent")

  try {
    if (intent === "delete") {
      await benderArtifacts.remove(params.id)
      throw redirect("/artifacts")
    }

    const title = (formData.get("title") as string)?.trim()
    const content = (formData.get("content") as string) ?? ""
    const filename = (formData.get("filename") as string) ?? ""

    if (!title) return { error: "Title is required" }
    if (!content) return { error: "Content cannot be empty" }

    // Every save is a new version of the SAME artifact: the public link stays
    // identical, and old versions remain reachable at ?v=N.
    await benderArtifacts.publish({ filename, content, title, supersedes: params.id })
    throw redirect(`/artifacts/${params.id}/edit`)
  } catch (err) {
    if (err instanceof Response) throw err
    return { error: err instanceof Error ? err.message : "Saving failed" }
  }
}

export default function EditArtifact({ loaderData }: Route.ComponentProps) {
  const { artifact } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"
  const isHtml = artifact.contentType === "text/html"

  const [title, setTitle] = useState(artifact.title ?? artifact.filename)
  const [content, setContent] = useState(artifact.content)
  const [tab, setTab] = useState<"write" | "preview">("write")

  return (
    <div className="px-6 py-10 w-full max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Edit artifact</h1>
          <p className="text-xs text-neutral-400 mt-1">
            {artifact.filename} · v{artifact.version}
          </p>
        </div>
        <a
          href={artifact.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-neutral-500 hover:text-black transition-colors"
        >
          View published ↗
        </a>
      </div>

      <Form method="post" className="space-y-4">
        {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
        <input type="hidden" name="filename" value={artifact.filename} />
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
              {isHtml ? (
                // Same isolation the published page gets: scripts may run, but
                // in an opaque origin with no reach into willy.im.
                <iframe
                  title="Preview"
                  sandbox="allow-scripts"
                  srcDoc={content}
                  className="w-full min-h-96 border border-neutral-200 rounded-md bg-white"
                />
              ) : (
                <div
                  className="prose prose-neutral max-w-none min-h-48 border border-neutral-200 rounded-md px-3 py-2"
                  dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
                />
              )}
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
              {isSubmitting ? "Saving…" : "Save new version"}
            </button>
            <a
              href="/artifacts"
              className="px-4 py-2 text-sm text-neutral-600 hover:text-black transition-colors"
            >
              Back
            </a>
          </div>
          <button
            type="submit"
            name="intent"
            value="delete"
            disabled={isSubmitting}
            className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
            onClick={(e) => {
              if (!confirm("Delete this artifact? The public link dies with it.")) e.preventDefault()
            }}
          >
            Delete
          </button>
        </div>
      </Form>
    </div>
  )
}
