import { Link } from "react-router"
import { benderArtifacts } from "~/lib/bender.server"
import { requireAdmin } from "~/lib/admin"
import type { Route } from "./+types/list"

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  await requireAdmin(request, context.services.auth)
  return { artifacts: await benderArtifacts.list() }
}

export default function ArtifactsList({ loaderData }: Route.ComponentProps) {
  const { artifacts } = loaderData

  return (
    <div className="px-6 py-10 w-full">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Artifacts</h1>
        <Link
          to="/artifacts/new"
          className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-neutral-800 transition-colors"
        >
          New artifact
        </Link>
      </div>

      {artifacts.length === 0 ? (
        <p className="text-neutral-500 text-sm">Nothing published yet.</p>
      ) : (
        <ul className="space-y-3">
          {artifacts.map((artifact) => (
            <li
              key={artifact.id}
              className="flex items-center justify-between gap-4 py-3 border-b border-neutral-100"
            >
              <div className="min-w-0">
                <a
                  href={artifact.url ?? `/artifacts/${artifact.id}`}
                  className="font-medium hover:underline truncate block"
                >
                  {artifact.title ?? artifact.filename}
                </a>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {artifact.filename} · v{artifact.version} ·{" "}
                  {new Date(artifact.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <Link
                to={`/artifacts/${artifact.id}/edit`}
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
