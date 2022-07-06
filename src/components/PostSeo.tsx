import { ArticleJsonLd, NextSeo } from "next-seo"
import { FC } from "react"
import { siteConfig } from "../lib/static"

interface SeoProps {
  imageUrl?: string
  description?: string
  path: string
  title?: string
  date?: string
  updated?: string
  author?: string
}

export const PostSeo: FC<SeoProps> = ({
  title = siteConfig.title,
  description = siteConfig.description,
  imageUrl = siteConfig.imageUrl,
  path,
  date,
  updated,
  author = siteConfig.author,
}) => {
  const formattedDate = date ? new Date(date).toISOString() : ""
  const formattedUpdatedDate = updated ? new Date(updated).toISOString() : ""

  const url = path.startsWith("/")
    ? `${siteConfig.url}${path.slice(1)}`
    : `${siteConfig.url}${path}`

  return (
    <>
      <NextSeo
        title={title}
        description={description}
        canonical={url}
        openGraph={{
          type: "article",
          article: {
            publishedTime: formattedDate,
            modifiedTime: formattedUpdatedDate,
          },
          url,
          title: title,
          description: description,
          images: [
            {
              url: imageUrl,
              alt: title,
            },
          ],
        }}
        twitter={{
          handle: siteConfig.twitter,
          site: siteConfig.twitter,
          cardType: "summary_large_image",
        }}
      />
      <ArticleJsonLd
        authorName={author}
        dateModified={formattedDate}
        datePublished={formattedDate}
        description={description}
        images={[imageUrl]}
        publisherLogo="/public/android-chrome-192x192.png"
        publisherName={author}
        title={title}
        url={url}
      />
    </>
  )
}
