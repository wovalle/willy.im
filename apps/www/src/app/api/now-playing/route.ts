import { NextResponse } from "next/server"
import { getNowPlaying } from "../../../lib/spotify"

export const GET = async () => {
  const nowPlaying = await getNowPlaying()

  return NextResponse.json(nowPlaying)
}
