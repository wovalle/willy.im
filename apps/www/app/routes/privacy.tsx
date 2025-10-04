import { allSingletons } from "content-collections"
import invariant from "tiny-invariant"
import type { Route } from "./+types/privacy"

export const loader = async () => {
  const privacy = allSingletons.find((singleton) => singleton.name === "privacy")
  invariant(privacy, "Privacy markdown not found")

  return {
    privacy,
  }
}

export default function Component({ loaderData }: Route.ComponentProps) {
  const { privacy } = loaderData

  return (
    <article className="flex flex-col gap-10 p-6 text-xl leading-relaxed">
      <section
        className="prose prose-lg dark:prose-invert"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown content from content-collections
        dangerouslySetInnerHTML={{ __html: privacy.md }}
      />
    </article>
  )
}
