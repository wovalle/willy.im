import clsx from "clsx"
import Link from "next/link"
import React from "react"
import { FaSpotify } from "react-icons/fa"

import { useNowPlaying } from "../hooks/useNowPlaying"
import { footerLinks, playlist } from "../lib/static"

const NowPlaying: React.FC = () => {
  const nowPlaying = useNowPlaying()

  const title = nowPlaying.isPlaying ? nowPlaying.songName ?? "" : "not playing"
  const subtitle = nowPlaying.isPlaying ? nowPlaying.artistName ?? "" : "anything"
  const url = nowPlaying.isPlaying ? nowPlaying.url ?? "" : playlist

  const spotifyIconClass = clsx(
    "absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75",
    { "animate-ping-2s": nowPlaying.isPlaying },
    { hidden: !nowPlaying.isPlaying }
  )

  return (
    <>
      <div className="flex flex-col">
        <div className="flex">
          <a href={url} className="text-title">
            {title}
          </a>
        </div>
        <p className="text-subsubtitle">{subtitle}</p>
      </div>
      <div className="relative h-8 md:mr-4">
        <span className={spotifyIconClass}></span>
        <FaSpotify size="2em" />
      </div>
    </>
  )
}

const Footer = (
  { withFooterDivider }: { withFooterDivider?: boolean } = { withFooterDivider: true }
) => {
  const links = footerLinks.map(({ name, url }) => (
    <Link key={name} href={url}>
      {name}
    </Link>
  ))

  return (
    <>
      {withFooterDivider && (
        <hr className="w-4/5 mx-auto border-gray-200 border-1 dark:border-gray-800" />
      )}
      <footer className="flex flex-col px-8 py-6 space-y-4 md md:flex-col">
        <div className="flex flex-row items-center justify-between md:px-0 md:justify-center md:flex-row-reverse">
          <NowPlaying />
        </div>
        <div className="flex justify-center">
          <ul className="grid w-full grid-cols-2 gap-2 md:justify-center md:flex md:space-y-0 md:flex-row">
            {links}
          </ul>
        </div>
      </footer>
    </>
  )
}

export default Footer
