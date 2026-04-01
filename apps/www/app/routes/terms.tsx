import { allSingletons } from "content-collections"
import invariant from "tiny-invariant"
import type { Route } from "./+types/terms"
import { createPageMeta, siteConfig } from "~/static"

export const meta: Route.MetaFunction = () =>
  createPageMeta({
    title: `Terms of Service | ${siteConfig.author}`,
    description: `Terms of service for willy.im.`,
    path: "/terms",
  })

export const loader = async () => {
  const terms = allSingletons.find((singleton) => singleton.name === "terms")
  invariant(terms, "Terms markdown not found")

  return {
    terms,
  }
}

export default function Component({ loaderData }: Route.ComponentProps) {
  const { terms } = loaderData

  return (
    <article className="flex flex-col gap-10 p-6 text-xl leading-relaxed">
      <section
        className="prose prose-lg dark:prose-invert"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown content from content-collections
        dangerouslySetInnerHTML={{ __html: terms.md }}
      />
    </article>
  )
}
