import { BlockWithChildren } from "@jitl/notion-api"
import { IconRss } from "@tabler/icons"
import dayjs from "dayjs"
import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next"
import Link from "next/link"
import { FC } from "react"
import useSWR from "swr/immutable"
import Layout from "../../components/layouts/Default"
import { PostSeo } from "../../components/PostSeo"
import { fetcher } from "../../lib/fetcher"
import { getFullPageBySlug, getPublicPosts, PageProperties } from "../../lib/notion"
import { notionBlockToDOM } from "../../renderNotionValues"
import { PostViewsApiSuccess } from "../api/luchy/post_views"

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

  // TODO: typesafe swr?
  const { data } = useSWR<PostViewsApiSuccess>(
    `/api/luchy/post_views?slug=${pageProperties.slug}`,
    fetcher
  )

  const PublishedAt = pageProperties.publishedAt ? (
    <time dateTime={pageProperties.publishedAt} className="lowercase">
      {dayjs(pageProperties.publishedAt).format("MMMM D, YYYY")}
    </time>
  ) : null

  const LastEditedAt = pageProperties.editedAt ? (
    <time dateTime={pageProperties.editedAt} className="lowercase">
      {dayjs(pageProperties.editedAt).format("MMMM D, YYYY")}
    </time>
  ) : null

  return (
    <Layout title={pageProperties.title}>
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
                {tags} <Divider /> {data?.views ?? "???"} views
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
    </Layout>
  )
}

export default Post
