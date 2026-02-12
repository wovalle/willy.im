import { IconBrandSpotify } from "@tabler/icons-react"
import { useState } from "react"
import { Link } from "react-router"
import { InlineSelect } from "~/components/inline-select"
import { PageSection } from "~/components/layout/page-section"
import { usePagination } from "~/hooks/use-pagination"
import {
  type GetTopArtistsResult,
  type GetTopTracksResult,
  type SpotifyTimeRange,
  SpotifyTimeRanges,
} from "~/modules/spotify/spotify.types"
import { AboutItemOverlay } from "./about-item-overlay"
import { AboutListElement } from "./about-list-element"
import { ExternalLinkOverlay } from "./external-link-overlay"
import { PaginationRow } from "./pagination-row"

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
  const [timeRange, setTimeRange] = useState(timeRangeOptions[0].value)
  const setTimeRangeAndTrack = (timeRange: SpotifyTimeRange) => {
    setTimeRange(timeRange)
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
        <ExternalLinkOverlay diameter={70} isHovered={isHovered} url={t.url}>
          <img
            src={t.thumbnailUrl ?? "/public/android-chrome-512x512.png"}
            alt={t.songName}
            className="max-h-[70px] min-h-[70px] min-w-[70px] max-w-[70px] rounded-xl"
            loading="lazy"
          />
        </ExternalLinkOverlay>
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
          <Link to={t.url} target="_blank" rel="noopener noreferrer">
            <img
              src={t.thumbnailUrl ?? "/public/android-chrome-512x512.png"}
              alt={t.name}
              className="rounded-xl"
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
      bleed={true}
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
