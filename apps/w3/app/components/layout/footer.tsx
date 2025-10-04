import { IconBrandSpotify } from "@tabler/icons-react"
import * as React from "react"
import { Await, Link } from "react-router"

import { cn } from "~/lib/cn"
import type { SimpleNowPlaying } from "~/modules/spotify/spotify.server"
import { navLinks, socialMedia, spotifyPlaylistUrl } from "~/static"

const NowPlayingContent = ({
  nowPlaying,
  loading,
}: {
  nowPlaying: SimpleNowPlaying | null
  loading?: boolean
}) => {
  const spotifyIconClass = cn(
    "absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75",
    { "animate-ping-2s": nowPlaying?.isPlaying },
    { hidden: !nowPlaying?.isPlaying },
  )

  const displayText = loading
    ? "Loading..."
    : nowPlaying?.isPlaying
      ? nowPlaying.songName
      : "not playing anything"

  const subtitleText = loading
    ? ""
    : nowPlaying?.isPlaying
      ? nowPlaying.artistName
      : "for a cool playlist click ^"

  const linkUrl = loading ? spotifyPlaylistUrl : (nowPlaying?.url ?? spotifyPlaylistUrl)

  return (
    <article
      title={
        loading
          ? "Loading..."
          : nowPlaying?.isPlaying
            ? "Now Playing"
            : "Click link for a cool spotify playlist"
      }
      className="flex flex-row items-center justify-between md:flex-row-reverse md:justify-center md:px-0"
    >
      <div className="flex flex-col text-base">
        <Link to={linkUrl} className="text-gray-800 dark:text-gray-50">
          {displayText}
        </Link>
        {subtitleText && <p className="text-gray-400 dark:text-gray-500 text-sm">{subtitleText}</p>}
      </div>
      <div className="relative h-8 md:mr-4">
        <span className={spotifyIconClass} />
        <IconBrandSpotify size="2em" />
      </div>
    </article>
  )
}

const NowPlaying = ({ nowPlaying }: { nowPlaying?: Promise<SimpleNowPlaying | null> }) => {
  if (!nowPlaying) {
    // Fallback when no promise is available
    return <NowPlayingContent nowPlaying={null} loading={false} />
  }

  return (
    <React.Suspense fallback={<NowPlayingContent nowPlaying={null} loading={true} />}>
      <Await resolve={nowPlaying}>
        {(nowPlaying) => <NowPlayingContent nowPlaying={nowPlaying} loading={false} />}
      </Await>
    </React.Suspense>
  )
}

export const Footer = (opts: {
  divider?: boolean
  nowPlaying?: Promise<SimpleNowPlaying | null>
}) => {
  const links = navLinks
    .filter((link) => link.in.includes("footer"))
    .map(({ name, url }) => (
      <Link key={name} to={url} className="border-transparent">
        {name}
      </Link>
    ))

  const socialMediaIcons = socialMedia.map(({ name, tooltip, link, icon: Icon }) => (
    <li key={name}>
      <a
        data-tooltip={tooltip}
        href={link}
        className="text-gray-600 dark:text-gray-400 hover:text-prim-700 dark:hover:text-prim-300 transition-colors"
      >
        <Icon size="1.5em" />
      </a>
    </li>
  ))

  return (
    <footer className="grid gap-6 p-6">
      {opts.divider && (
        <hr className="border-1 mx-auto w-4/5 border-gray-200 dark:border-gray-800" />
      )}

      <NowPlaying nowPlaying={opts.nowPlaying} />

      <ul className="flex flex-row justify-center gap-4">{links}</ul>

      <div className="flex list-none justify-center gap-6">{socialMediaIcons}</div>
    </footer>
  )
}
