"use client"

import { IconBrandYoutube } from "@tabler/icons-react"
import { getYouTubeVideoUrlFromVideo, YoutubeVideo } from "../../../lib/youtube"
import { PageSection } from "../../components/PageSection"
import { usePagination } from "../../hooks/usePagination"
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
            src={v.thumbnails.default?.url ?? "/android-chrome-192x192.png"}
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
      icon={<IconBrandYoutube size="3em" color="#b2071d" />}
    >
      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{videoList}</ul>

      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
