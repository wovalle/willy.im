import { BlockWithChildren } from "@jitl/notion-api"
import dayjs from "dayjs"
import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next"
import { FC } from "react"
import Layout from "../../components/layouts/Default"
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

type PostProps = InferGetStaticPropsType<typeof getStaticProps>

export const Post: FC<PostProps> = ({ blocks, pageProperties }) => {
  const tags = pageProperties.categories.join(", ")
  const BlockComponents = blocks.map((b) => notionBlockToDOM(b))

  const PublishedAt = pageProperties.publishedAt ? (
    <time dateTime={pageProperties.publishedAt} className="lowercase">
      {dayjs(pageProperties.publishedAt).format("MMMM D, YYYY")} {" · "}
    </time>
  ) : null

  const LastEditedAt =
    pageProperties.showEdited && pageProperties.editedAt ? (
      <time dateTime={pageProperties.editedAt} className="lowercase">
        {dayjs(pageProperties.editedAt).format("MMMM D, YYYY")}
      </time>
    ) : null

  return (
    <Layout title="blog">
      <main>
        <article className="flex flex-col gap-10 p-6  text-xl leading-relaxed">
          <header className="flex flex-col gap-2">
            <h1 className="text-title break-normal text-4xl font-bold tracking-tight">
              {pageProperties.title}
            </h1>
            <div className="gap-1">
              <p className="text-subtitle flex text-sm md:text-base">
                {PublishedAt} {tags} · 8,775 views
              </p>
              {pageProperties.showEdited ? (
                <p className="text-subtitle flex text-sm md:text-base">
                  <i className="font-extralight">(last updated {LastEditedAt})</i>
                </p>
              ) : null}
            </div>
          </header>

          <section className="notion flex flex-col gap-4">{BlockComponents}</section>
        </article>
      </main>
    </Layout>
  )
}

export default Post
