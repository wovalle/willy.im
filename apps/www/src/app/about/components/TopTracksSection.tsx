"use client"

import { getTracker } from "@luchyio/next"
import { IconBrandSpotify } from "@tabler/icons-react"
import { useState } from "react"
import {
  GetTopArtistsResult,
  GetTopTracksResult,
  SpotifyTimeRange,
  SpotifyTimeRanges,
} from "../../../lib/spotify"
import { InlineSelect } from "../../components/InlineSelect"
import { PageSection } from "../../components/PageSection"
import { usePagination } from "../../hooks/usePagination"

import Link from "next/link"
import { useAudioPlayer } from "../hooks/useAudioPlayer"
import { AboutItemOverlay } from "./AboutItemOverlay"
import { AboutListElement } from "./AboutListElement"
import { PaginationRow } from "./PaginationRow"
import { PlayButtonOverlay } from "./PlayButtonOverlay"

export const revalidate = 60 * 60 * 24 // 1 day

const timeRangeOptions = SpotifyTimeRanges.map((t) => ({ value: t, label: t }))

const topSections = [
  { value: "topTracks", label: "songs" },
  { value: "topArtists", label: "artists" },
] as const

export const TopTracksAndArtistsSection = ({
  topTracks,
  topArtists,
}: {
  topTracks: GetTopTracksResult
  topArtists: GetTopArtistsResult
}) => {
  const player = useAudioPlayer()

  const [timeRange, setTimeRange] = useState(timeRangeOptions[0].value)
  const tracker = getTracker()
  const setTimeRangeAndTrack = (timeRange: SpotifyTimeRange) => {
    setTimeRange(timeRange)
    tracker.collectEvent("top_tracks_time_range", timeRange)
  }

  const [musicSection, setMusicSection] =
    useState<(typeof topSections)[number]["value"]>("topTracks")

  const tracksPagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: topTracks[timeRange],
  })

  const artistsPagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: topArtists[timeRange],
  })

  const topTracksList = tracksPagination.items.map((t) => (
    <AboutListElement
      key={t.url}
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      leftPanel={(isHovered) => (
        <PlayButtonOverlay diameter={70} isHovered={isHovered} url={t.previewUrl} player={player}>
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

  const topArtistsList = artistsPagination.items.map((t) => (
    <AboutListElement
      key={t.url}
      title={t.name}
      subtitle={t.genres}
      url={t.url}
      leftPanel={(isHovered) => (
        <AboutItemOverlay diameter={70} isHovered={isHovered}>
          <Link href={t.url} target="_blank">
            <img
              src={t.thumbnailUrl ?? "/public/android-chrome-512x512.png"}
              alt={t.name}
              className="h-full w-full rounded-xl"
              loading="lazy"
            />
          </Link>
        </AboutItemOverlay>
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
          <InlineSelect
            options={topSections.map(({ value, label }) => ({ value, label }))}
            onChange={(v) => setMusicSection(v)}
            selected={musicSection}
          />{" "}
          in the last few{" "}
          <InlineSelect
            options={timeRangeOptions}
            onChange={(v) => setTimeRangeAndTrack(v)}
            selected={timeRange}
          />
        </>
      }
      icon={<IconBrandSpotify size="3em" color="#1ED760" />}
    >
      {musicSection === "topTracks" ? (
        <>
          <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{topTracksList}</ul>
          <PaginationRow pagination={tracksPagination} />
        </>
      ) : (
        <>
          <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-2">{topArtistsList}</ul>
          <PaginationRow pagination={artistsPagination} />
        </>
      )}
    </PageSection>
  )
}
