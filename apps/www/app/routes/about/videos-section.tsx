import { IconBrandYoutube } from "@tabler/icons-react"
import { PageSection } from "~/components/layout/page-section"
import { usePagination } from "~/hooks/use-pagination"
import type { YoutubeVideo } from "~/modules/youtube/youtube.schemas"
import { AboutListElement } from "./about-list-element"
import { ExternalLinkOverlay } from "./external-link-overlay"
import { PaginationRow } from "./pagination-row"

const getYouTubeVideoUrl = (video: YoutubeVideo) =>
  `https://www.youtube.com/watch?v=${video.resourceId.videoId}`

export const VideosSection = ({ videos }: { videos: YoutubeVideo[] }) => {
  const pagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: videos,
  })

  const videoList = pagination.items.map((v) => {
    const videoUrl = getYouTubeVideoUrl(v)
    return (
      <AboutListElement
        key={v.resourceId.videoId}
        title={v.title}
        subtitle={v.channelTitle}
        url={videoUrl}
        leftPanel={(isHovered) => (
          <ExternalLinkOverlay diameter={70} isHovered={isHovered} url={videoUrl}>
            <img
              src={v.thumbnails.default?.url ?? "/public/android-chrome-512x512.png"}
              alt={v.title}
              className="max-h-[70px] min-h-[70px] min-w-[70px] max-w-[70px] rounded-xl object-cover"
              loading="lazy"
            />
          </ExternalLinkOverlay>
        )}
      />
    )
  })

  return (
    <PageSection
      id="youtube"
      title="what i've been watching"
      bleed={true}
      subtitle="videos i've liked lately"
      icon={<IconBrandYoutube size="3em" color="#b2071d" />}
    >
      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{videoList}</ul>
      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
