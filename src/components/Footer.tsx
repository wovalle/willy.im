import { IconBrandSpotify } from "@tabler/icons"
import clsx from "clsx"
import Link from "next/link"
import React from "react"
import { useNowPlaying } from "../hooks"
import { footerLinks, playlist, socialMedia } from "../lib/static"

const NowPlaying: React.FC = () => {
  const nowPlaying = useNowPlaying()

  const title = nowPlaying.isPlaying ? nowPlaying.songName ?? "" : "not playing anything"
  const subtitle = nowPlaying.isPlaying ? nowPlaying.artistName ?? "" : "for cool playlist click ^"
  const url = nowPlaying.isPlaying ? nowPlaying.url ?? "" : playlist

  const spotifyIconClass = clsx(
    "absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75",
    { "animate-ping-2s": nowPlaying.isPlaying },
    { hidden: !nowPlaying.isPlaying }
  )

  return (
    <article
      title={nowPlaying.isPlaying ? "Now Playing" : "Click link for a cool spotify playlist"}
      className="flex flex-row items-center justify-between md:flex-row-reverse md:justify-center md:px-0"
    >
      <div className="flex flex-col text-base">
        <Link href={url} className="text-title">
          {title}
        </Link>
        <p className="text-subsubtitle text-sm">{subtitle}</p>
      </div>
      <div className="relative h-8 md:mr-4">
        <span className={spotifyIconClass}></span>
        <IconBrandSpotify size="2em" />
      </div>
    </article>
  )
}

const Footer = (
  { withFooterDivider }: { withFooterDivider?: boolean } = { withFooterDivider: true }
) => {
  const links = footerLinks.map(({ name, url }) => (
    <Link key={name} href={url} className="border-transparent">
      {name}
    </Link>
  ))

  const socialMediaIcons = socialMedia.map(({ name, tooltip, link, icon: Icon }) => (
    <li key={name}>
      <a data-tooltip={tooltip} href={link}>
        <Icon size="1.5em" />
      </a>
    </li>
  ))

  return (
    <footer className="grid gap-6 p-6">
      {withFooterDivider && (
        <hr className="border-1 mx-auto w-4/5 border-gray-200 dark:border-gray-800" />
      )}
      <NowPlaying />

      <ul className="flex flex-row justify-center gap-4">{links}</ul>

      <div className="flex list-none justify-center gap-6">{socialMediaIcons}</div>
    </footer>
  )
}

export default Footer
