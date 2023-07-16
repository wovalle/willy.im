import { IconBrandYoutube } from "@tabler/icons-react"
import { usePagination } from "../../hooks"
import { YoutubeVideo, getYouTubeVideoUrlFromVideo } from "../../lib/youtube"
import { PageSection } from "../PageSection"
import { AboutListElement } from "./AboutListElement"
import { PaginationRow } from "./PaginationRow"

export const VideosSection = ({ videos }: { videos: YoutubeVideo[] }) => {
  const pagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: videos,
  })

  const videoList = pagination.items.map((v) => (
    <AboutListElement
      key={v.title}
      title={v.title}
      subtitle={v.videoOwnerChannelTitle}
      url={getYouTubeVideoUrlFromVideo(v)}
      leftPanel={() => (
        <a
          href={getYouTubeVideoUrlFromVideo(v)}
          data-luchy-event="video-click"
          data-luchy-event-data={v.resourceId.videoId}
          target="_blank"
          rel="noopener noreferrer"
          className="h-[70px]"
        >
          <img
            src={v.thumbnails.default.url}
            alt={v.description}
            className="h-full w-full rounded-xl object-contain"
            loading="lazy"
          />
        </a>
      )}
    />
  ))

  return (
    <PageSection
      id="youtube"
      title="what i've been watching"
      bleed
      subtitle="videos I've liked lately"
    >
      <div className="absolute right-6 md:right-20 md:top-14">
        <IconBrandYoutube size="3em" color="#b2071d" />
      </div>

      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{videoList}</ul>

      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
