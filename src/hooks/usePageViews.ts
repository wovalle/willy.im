import useSWR from "swr/immutable"
import { fetcher } from "../lib/fetcher"
import { PostViewsApiSuccess } from "../pages/api/luchy/post_views"

export const usePageViews = (slug: string) => {
  const { data } = useSWR<PostViewsApiSuccess>(`/api/luchy/post_views?slug=${slug}`, fetcher)

  return data?.views ?? "??"
}
