import type { Route } from "./+types/apps.$app.identities.$provider.$externalId"
import { v1 } from "~/lib/v1.server"

/** GET — identities.resolve: always 200 with a `found` discriminator (a miss is data). */
export async function loader(args: Route.LoaderArgs) {
  const { app, provider, externalId } = args.params
  return v1(args, app, (ctx) => ctx.services.identities.resolve({ provider, externalId }))
}
