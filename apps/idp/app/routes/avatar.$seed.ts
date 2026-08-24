import type { Route } from "./+types/avatar.$seed"
import { renderAvatar } from "~/lib/avatar.server"

/**
 * `GET /avatar/:seed` — a deterministic blobatar as SVG.
 *
 * Deliberately unauthenticated. The response is a pure function of the seed, so
 * there is nothing here a caller couldn't compute themselves, and an avatar has
 * to render in the places a session can't reach: an email, a Slack unfurl, an
 * `<img>` on a consumer app's page.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return renderAvatar(params.seed, request)
}
