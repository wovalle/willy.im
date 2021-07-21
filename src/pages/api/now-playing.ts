import { NextApiRequest, NextApiResponse } from "next"
import { getNowPlaying, SimpleNowPlaying } from "../../lib/spotify"

export default async (_: NextApiRequest, res: NextApiResponse<SimpleNowPlaying>) => {
  const nowPlaying = await getNowPlaying()

  res.json(nowPlaying)
}
