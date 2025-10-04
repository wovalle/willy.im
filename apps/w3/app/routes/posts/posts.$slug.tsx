import { IconRss } from "@tabler/icons-react"
import { Link } from "react-router"
import { allPosts } from "../../../.content-collections/generated"
import type { Route } from "./+types/posts.$slug"

import { Time } from "~/components/time"

export const loader = async ({ params }: Route.LoaderArgs) => {
  const post = allPosts.find((post) => post._meta.path === params.slug)

  if (!post) {
    throw new Error("Post not found")
  }

  return {
    post,
  }
}

const Divider = () => <span className="px-1">·</span>

export default function Component({ loaderData }: Route.ComponentProps) {
  const { post } = loaderData

  const tags = post.tags?.map((c) => `#${c} `)
  // TODO: Finish dynamic API for this
  const views = "??"

  const PublishedAt = post.publishedAt ? (
    <Time date={post.publishedAt} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  const LastEditedAt = post.updatedAt ? (
    <Time date={post.updatedAt} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  return (
    <article className="flex flex-col gap-10 p-6 text-xl leading-relaxed">
      <header className="flex flex-col gap-2">
        <h1 className="text-title break-normal text-4xl font-bold tracking-tight">{post.title}</h1>

        <div className="gap-1">
          <p className="text-gray-500 flex text-sm md:text-base">
            {PublishedAt} <Divider />
            {tags} <Divider /> {views} views
            <Link to="/rss.xml" className="self-center border-0 no-underline">
              <IconRss size="1em" className="ml-2 self-center" />
            </Link>
          </p>

          {LastEditedAt ? (
            <p className="text-gray-500 flex text-sm">
              <i>(last updated {LastEditedAt})</i>
            </p>
          ) : null}
        </div>
      </header>

      <section
        className="prose prose-neutral prose-lg"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown content e
        dangerouslySetInnerHTML={{ __html: post.md }}
      />
    </article>
  )
}

// .prose blockquote {
//   font-size: var(--text-base);
//   line-height: var(--text-base--line-height);
//   padding: calc(var(--spacing) * 2);
//   font-style: italic;
//   color: var(--color-gray-600);

//   @media (prefers-color-scheme: dark) {
//     color: var(--color-gray-300);
//   }

//   p {
//     margin-top: calc(var(--spacing) * 1);
//     margin-bottom: calc(var(--spacing) * 1);
//   }
// }

// .prose a {
//   text-decoration-color: var(--color-gray-300);
//   transition-property:
//     color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow,
//     transform, filter, backdrop-filter;
//   transition-timing-function: var(--ease-in-out);
//   transition-duration: var(--duration-normal);

//   &:hover {
//     text-decoration-color: var(--color-gray-600);
//     color: color-mix(in oklab, currentColor 60%, black);
//   }
// }
