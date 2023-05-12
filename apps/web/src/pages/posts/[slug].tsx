import { IconRss } from "@tabler/icons"
import { allPosts } from "contentlayer/generated"
import { GetStaticPaths, GetStaticPropsContext, InferGetStaticPropsType } from "next"
import { useMDXComponent } from "next-contentlayer/hooks"
import Link from "next/link"
import { FC } from "react"
import { Time } from "../../components/Core/Time"
import { DefaultLayout } from "../../components/Layout"
import { PostSeo } from "../../components/PostSeo"
import { usePageViews } from "../../hooks/usePageViews"

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: allPosts.map((p) => ({ params: { slug: p.slug } })),
    fallback: "blocking",
  }
}

export const getStaticProps = async ({ params }: GetStaticPropsContext) => {
  const post = allPosts.find((post) => post.slug === params?.slug)

  if (!post) {
    return {
      notFound: true,
    }
  }

  return {
    props: {
      post,
    },
  }
}

const Divider = () => <span className="px-1">·</span>

export const Post: FC<InferGetStaticPropsType<typeof getStaticProps>> = ({ post }) => {
  const Component = useMDXComponent(post.body.code)

  const tags = post.tags?.map((c) => `#${c} `)
  const views = usePageViews(post.slug)

  const PublishedAt = post.published ? (
    <Time date={post.published} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  const LastEditedAt = post.updated ? (
    <Time date={post.updated} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  return (
    <DefaultLayout title={post.title}>
      <PostSeo
        path={post.path}
        date={post.published}
        updated={post.updated ?? ""}
        description={post.summary}
        title={post.title}
      />
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
    </DefaultLayout>
  )
}

export default Post
