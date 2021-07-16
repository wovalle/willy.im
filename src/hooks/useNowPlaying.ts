import useSWR from "swr"
import { SimpleNowPlaying } from "../lib/spotify"

const fetcher = async function (input: RequestInfo) {
  const res = await fetch(input)
  return res.json()
}

export const useNowPlaying = () => {
  const { data } = useSWR<SimpleNowPlaying>("/api/now-playing", fetcher)

  return data || { isPlaying: false }
}
