import { createLuchyClient } from "luchy/api"
import { createRequestTracker, type RequestTrackerOptions } from "luchy/react-router"

import { LUCHY_API_KEY } from "./luchy"
import { resolveCaller } from "./caller.server"
import type { AuthService } from "./auth.server"
import type { BaseServiceContext } from "./services"

/**
 * Server-side Luchy. The Worker derives an event from every mutating request
 * (`luchy/react-router` owns the mechanics — see `workers/app.ts`); this module
 * holds the IdP's knobs and the one hand-written event.
 *
 * Deviations from the package defaults, on purpose: auth *is* this product, so
 * failures are kept (`status` rides in the payload) and intent-less API
 * mutations get a method suffix so PATCH and DELETE on one route stay distinct.
 */
export const LUCHY_TRACKER_OPTIONS = {
  apiKey: LUCHY_API_KEY,
  trackFailures: true,
  methodSuffix: true,
  // Consumer apps validate end-user API keys on (potentially) every request
  // they serve. That is key plumbing, not product usage — it already bumps
  // `lastUsedAt` on the key row, and here it would drown everything else.
  ignoreRouteSuffixes: ["/user-keys/validate"],
} satisfies Partial<RequestTrackerOptions>

/**
 * The per-request tracker. Constructed in the Worker's fetch handler because
 * the payload enrichment needs that request's service context.
 */
export function createIdpRequestTracker(ctx: BaseServiceContext, auth: AuthService) {
  return createRequestTracker({
    ...LUCHY_TRACKER_OPTIONS,
    enabled: ctx.getAppEnv("APP_ENV") === "production",
    payload: async (request) => {
      const payload: Record<string, string | number | boolean> = {}
      if (request.headers.get("authorization")) {
        // Agentic traffic: name the key so machine usage is segmentable, not
        // just countable.
        const caller = await resolveCaller(request, ctx, auth).catch(() => null)
        if (caller) {
          payload.actor = caller.actor.label
          payload.kind = caller.kind
          if (caller.applicationId) payload.app = caller.applicationId
        }
      } else if (request.headers.get("cookie")) {
        // Anonymous traffic carries neither header; it must not pay for a
        // lookup that can only miss.
        const session = await auth.api.getSession({ headers: request.headers }).catch(() => null)
        if (session) {
          payload.user = session.user.id
          if (session.user.role === "admin") payload.admin = true
          if (session.session.impersonatedBy) payload.impersonated = true
        }
      }
      return payload
    },
  })
}

const client = createLuchyClient({ apiKey: LUCHY_API_KEY })

/** Fire-and-forget server event, for the rare mutation the sniffer can't see. */
export async function trackServerEvent(event: {
  name: string
  pathname: string
  userAgent?: string
  payload?: Record<string, string | number | boolean>
}): Promise<void> {
  await client.trackEvent({
    name: event.name,
    type: "server",
    pathname: event.pathname,
    payload: event.payload,
    userAgent: event.userAgent,
  })
}
