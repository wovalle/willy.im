import useSWR from "swr/immutable"
import { fetcher } from "../lib/fetcher"

export const usePageViews = (slug: string) => {
  const { data } = useSWR<any>(`/api/luchy/post_views?slug=${slug}`, fetcher)

  return data?.views ?? "??"
}
