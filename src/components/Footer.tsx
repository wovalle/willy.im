import clsx from "clsx"
import Link from "next/link"
import React from "react"
import { FaSpotify } from "react-icons/fa"

import { useNowPlaying } from "../hooks/useNowPlaying"
import { github, linkedin, twitter, ama } from "../lib/static"

const NowPlaying: React.FC = () => {
  const nowPlaying = useNowPlaying()

  const title = nowPlaying.isPlaying ? nowPlaying.songName ?? "" : "not playing"
  const subtitle = nowPlaying.isPlaying ? nowPlaying.artistName ?? "" : "anything"
  const spotifyIconClass = clsx(
    "absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75",
    { "animate-ping-2s": nowPlaying.isPlaying },
    { hidden: !nowPlaying.isPlaying }
  )

  return (
    <>
      <div className="flex mx-4">
        <div className="relative h-8">
          <span className={spotifyIconClass}></span>
          <FaSpotify size="2em" />
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex">
          <a href={nowPlaying.url || ""} className="font-semibold text-title">
            {title}
          </a>
        </div>
        <p className="text-subsubtitle">{subtitle}</p>
      </div>
    </>
  )
}

const Footer = () => {
  const links = [
    ["about", "/about"],
    ["twitter", twitter],
    ["github", github],
    ["linkedIn", linkedin],
    ["ama", ama],
  ].map(([title, link]) => (
    <Link key={title} href={link}>
      {title}
    </Link>
  ))

  return (
    <>
      <hr className="w-4/5 mx-auto border-gray-200 border-1 dark:border-gray-800" />
      <footer className="flex flex-col px-8 py-4 space-y-4 sm sm:flex-col">
        <div className="flex flex-row-reverse items-center justify-between px-8 sm:px-0 sm:justify-center sm:flex-row">
          <NowPlaying />
        </div>
        <div className="flex justify-center">
          <ul className="flex flex-col items-center space-y-4 sm:space-x-4 sm:space-y-0 sm:flex-row">
            {links}
          </ul>
        </div>
        <div className="flex justify-center text-subtitle">
          © Willy Ovalle {new Date().getFullYear()}
        </div>
      </footer>
    </>
  )
}

export default Footer
