import { BlockWithChildren } from "@jitl/notion-api"
import { IconRss } from "@tabler/icons"
import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next"
import Link from "next/link"
import { FC } from "react"
import { Time } from "../../components/Core/Time"
import { DefaultLayout } from "../../components/Layout"
import { PostSeo } from "../../components/PostSeo"
import { usePageViews } from "../../hooks/usePageViews"
import { getFullPageBySlug, getPublicPosts, PageProperties } from "../../lib/notion"
import { notionBlockToDOM } from "../../renderNotionValues"

type GetStaticPropsOpts = {
  blocks: BlockWithChildren[]
  pageProperties: PageProperties
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getPublicPosts()

  return {
    paths: posts.map((p) => ({ params: { slug: p.slug } })),
    fallback: "blocking",
  }
}

export const getStaticProps: GetStaticProps<GetStaticPropsOpts> = async ({ params }) => {
  const fullPage = await getFullPageBySlug(params?.slug)

  if (fullPage.status === "error") {
    return {
      notFound: true,
    }
  }

  return {
    props: {
      blocks: fullPage.data.blocks,
      pageProperties: fullPage.data.properties,
    },
  }
}

const Divider = () => <span className="px-1">·</span>

export const Post: FC<InferGetStaticPropsType<typeof getStaticProps>> = ({
  blocks,
  pageProperties,
}) => {
  const tags = pageProperties.categories.join(", ")
  const BlockComponents = blocks.map((b) => notionBlockToDOM(b))
  const views = usePageViews(pageProperties.slug)

  const PublishedAt = pageProperties.publishedAt ? (
    <Time date={pageProperties.publishedAt} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  const LastEditedAt = pageProperties.editedAt ? (
    <Time date={pageProperties.editedAt} className="lowercase" format="MMMM D, YYYY" />
  ) : null

  return (
    <DefaultLayout title={pageProperties.title}>
      <PostSeo
        path={`/posts/${pageProperties.slug}`}
        date={pageProperties.publishedAt ?? ""}
        updated={pageProperties.editedAt ?? ""}
        description={pageProperties.summary}
        title={pageProperties.title}
      />
      <main>
        <article className="flex flex-col gap-10 p-6  text-xl leading-relaxed">
          <header className="flex flex-col gap-2">
            <h1 className="text-title break-normal text-4xl font-bold tracking-tight">
              {pageProperties.title}
            </h1>
            <div className="gap-1">
              <p className="text-subtitle flex text-sm md:text-base">
                {PublishedAt} <Divider />
                {tags} <Divider /> {views} views
                <Link href="/rss.xml" className="self-center border-0 no-underline">
                  <IconRss size="1em" className="ml-2 self-center" />
                </Link>
              </p>
              <p className="text-subtitle flex text-sm">
                <i className="font-extralight">(last updated {LastEditedAt})</i>
              </p>
            </div>
          </header>

          <section className="notion flex flex-col gap-3">{BlockComponents}</section>
        </article>
      </main>
    </DefaultLayout>
  )
}

export default Post
