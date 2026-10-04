import { createApp, type ContextInput } from "@willyim/kit"

import type { AppContext } from "./context"
import { auditTrail, humanIdOf } from "./lib/audit.server"
import type { AuthService } from "./lib/auth.server"
import { principalFrom } from "./lib/caller.server"
import { appRbac } from "./lib/permissions"
import type { ResourceLister } from "./lib/resources.server"
import type { BaseServiceContext } from "./lib/services"
import { invitations, members } from "./services/members"
import { user_keys } from "./services/user-keys"
import { workspace_members, workspaces } from "./services/workspaces"

/**
 * The IdP as one @willyim/kit app: every management capability is a method,
 * and the console, the HTTP API (`/api/<service>.<method>`, and
 * `/apps/<app>/api/...` inside one app), the SDK and MCP all call the same one.
 *
 * The tenant is the app key: `app.context(principal, "acme", deps)`. IdP-level
 * work (applications, users, admin keys, identity linking) runs in the null
 * tenant, where only superadmins (`"*"`) hold anything. Better Auth (OIDC,
 * passkeys, login, consent) stays outside.
 */

/** What every surface hands `app.context` besides the principal and tenant. */
export type KitDeps = {
  base: BaseServiceContext
  auth: AuthService
  /** Asks an app which instances of a declared resource type it holds. */
  resources: ResourceLister
  request: Request
}

const context = ({ principal, tenantId }: ContextInput, deps: KitDeps) => ({
  db: deps.base.db,
  logger: deps.base.logger,
  getAppEnv: deps.base.getAppEnv,
  betterAuth: deps.auth,
  resources: deps.resources,
  /** The app key. App methods exist only inside a tenant (services/io.ts), so it is never "" there. */
  app: tenantId ?? "",
  /** The human behind the call ("user:<id>"); null for keys. */
  userId: humanIdOf(principal?.id),
  /** The management key behind the call ("adminkey:<id>" / "apikey:<id>"); null for humans. */
  keyId: principal && !principal.id.startsWith("user:") ? principal.id.split(":")[1] : null,
  /** The audit trail, bound to this caller and app once: methods only say what happened. */
  audit: auditTrail(deps.base, principal, tenantId),
  /** Impersonation needs the admin's own Better Auth session. */
  headers: deps.request.headers,
  /** Invite links point back at the host that served the request. */
  origin: new URL(deps.request.url).origin,
})

const services = { user_keys, members, invitations, workspaces, workspace_members }

export const app = createApp({
  name: "idp",
  description:
    "willy.im identity: applications, their members, workspaces and keys, linked identities and the audit trail.",
  auth: appRbac,
  context,
  services,
  discovery: {
    anonymous: "none",
    auth: {
      instructions:
        "Send `Authorization: Bearer <wim_ key>`: an IdP admin key, or a key scoped to one app minted in the console.",
    },
  },
})

declare module "@willyim/kit" {
  interface Register {
    auth: typeof appRbac
    context: typeof context
    services: typeof services
  }
}

/** The dependencies of a request's context, from what the worker set on it. */
export const depsOf = (c: AppContext, request: Request): KitDeps => ({
  base: c,
  auth: c.services.auth,
  resources: c.services.resources,
  request,
})

/** The context of one request, in `tenant` (an app key, or null for the IdP level). */
export async function requestContext(c: AppContext, request: Request, tenant: string | null) {
  return app.context(await principalFrom(request, c, c.services.auth), tenant, depsOf(c, request))
}
