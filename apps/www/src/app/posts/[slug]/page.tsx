import { IconRss } from "@tabler/icons-react"
import { allPosts } from "contentlayer/generated"
import { Metadata, ResolvingMetadata } from "next"
import { useMDXComponent } from "next-contentlayer/hooks"
import Link from "next/link"
import { notFound } from "next/navigation"

type Props = {
  params: { slug: string }
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const post = allPosts.find((post) => post.slug === params?.slug)

  if (!post) {
    return notFound()
  }

  return {
    title: post.title,
    description: post.summary,
    openGraph: {
      title: post.title,
      description: post.summary,
      url: `https://willy.im/posts/${post.slug}`,
      type: "article",
      authors: ["Willy Ovalle"],
    },
  }
}

import { Time } from "../../components/Time"

const Divider = () => <span className="px-1">·</span>

const Post = ({ params }: Props) => {
  const post = allPosts.find((post) => post.slug === params?.slug)

  if (!post) {
    return notFound()
  }

  const Component = useMDXComponent(post.body.code)

  const tags = post.tags?.map((c) => `#${c} `)
  // TODO: Finish dynamic API for this
  const views = "??"

  const PublishedAt = post.published ? (
    <Time date={post.published} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  const LastEditedAt = post.updated ? (
    <Time date={post.updated} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  return (
    <main>
      <article className="flex flex-col gap-10 p-6  text-xl leading-relaxed">
        <header className="flex flex-col gap-2">
          <h1 className="text-title break-normal text-4xl font-bold tracking-tight">
            {post.title}
          </h1>
          <div className="gap-1">
            <p className="text-subtitle flex text-sm md:text-base">
              {PublishedAt} <Divider />
              {tags} <Divider /> {views} views
              <Link href="/rss.xml" className="self-center border-0 no-underline">
                <IconRss size="1em" className="ml-2 self-center" />
              </Link>
            </p>
            {LastEditedAt ? (
              <p className="text-subtitle flex text-sm">
                <i className="font-extralight">(last updated {LastEditedAt})</i>
              </p>
            ) : null}
          </div>
        </header>

        <section className="prose prose-lg dark:prose-invert">
          <Component />
        </section>
      </article>
    </main>
  )
}

export default Post
