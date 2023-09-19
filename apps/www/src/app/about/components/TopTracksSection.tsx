"use client"

import { getTracker } from "@luchyio/next"
import { IconBrandSpotify } from "@tabler/icons-react"
import { useState } from "react"
import { GetTopTracksResult, SpotifyTimeRange, SpotifyTimeRanges } from "../../../lib/spotify"
import { InlineSelect } from "../../components/InlineSelect"
import { PageSection } from "../../components/PageSection"
import { usePagination } from "../../hooks/usePagination"

import { AboutListElement } from "./AboutListElement"
import { PaginationRow } from "./PaginationRow"
import { PlayButtonOverlay } from "./PlayButtonOverlay"

const timeRangeOptions = SpotifyTimeRanges.map((t) => ({ value: t, label: t }))

export const TopTracksSection = ({ topTracks }: { topTracks: GetTopTracksResult }) => {
  const [timeRange, setTimeRange] = useState(timeRangeOptions[0].value)
  const tracker = getTracker()
  const setTimeRangeAndTrack = (timeRange: SpotifyTimeRange) => {
    setTimeRange(timeRange)
    tracker.collectEvent("top_tracks_time_range", timeRange)
  }

  const pagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: topTracks[timeRange],
  })

  const topTracksList = pagination.items.map((t) => (
    <AboutListElement
      key={t.url}
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      leftPanel={(isHovered) => (
        <PlayButtonOverlay diameter={70} isHovered={isHovered} url={t.previewUrl}>
          <img
            src={t.thumbnailUrl ?? "/public/android-chrome-512x512.png"}
            alt={t.songName}
            className="h-full w-full rounded-xl"
            loading="lazy"
          />
        </PlayButtonOverlay>
      )}
    />
  ))

  return (
    <PageSection
      id="songs"
      title="what i've been jamming to"
      bleed
      subtitle={
        <>
          songs in the last few{" "}
          <InlineSelect
            options={timeRangeOptions}
            onChange={(v) => setTimeRangeAndTrack(v)}
            selected={timeRange}
          />
        </>
      }
      icon={<IconBrandSpotify size="3em" color="#1ED760" />}
    >
      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{topTracksList}</ul>
      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
