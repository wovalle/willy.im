import useSWR from "swr"
import { fetcher } from "../lib/fetcher"
import { SimpleNowPlaying } from "../lib/spotify"

export const useNowPlaying = () => {
  const { data } = useSWR<SimpleNowPlaying>("/api/now-playing", fetcher, {
    refreshInterval: 3 * 60 * 1000, // refresh each 3 mins
  })

  return data ?? { isPlaying: false }
}
