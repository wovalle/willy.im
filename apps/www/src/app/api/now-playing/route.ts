import { unstable_noStore as noStore } from "next/cache"
import { NextResponse } from "next/server"
import { getNowPlaying } from "../../../lib/spotify"

export const GET = async () => {
  noStore()
  const nowPlaying = await getNowPlaying()

  return NextResponse.json(nowPlaying)
}
