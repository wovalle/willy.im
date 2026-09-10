import {
  RESOURCE_LIST_PERMISSION,
  RESOURCE_LIST_TOKEN_TTL_S,
  ResourceInstanceSchema,
} from "@willyim/idp/schemas"

import type { AuthService } from "./auth.server"
import { APP_CLAIM, PERMISSIONS_CLAIM } from "./claims.server"
import type { ResourceTypeDecl } from "./metadata"
import type { ILogger } from "./services"

/**
 * Asking an app which instances of a resource type it holds.
 *
 * The IdP holds the grant and the app holds the resources; neither keeps a
 * copy of the other's list. So when a human picks a conversation in the
 * console, or a key is minted for one, the IdP GETs the `list` URL the app
 * declared with the type and reads `{ resources: [{ id, label, description }] }`.
 *
 * ── how the call is authenticated ───────────────────────────────────────────
 * With a JWT the IdP signs with its own OIDC key: `aud` is the list URL
 * itself, `exp` is a minute out, and the permissions claim carries
 * `idp:resources:list`. The app verifies it exactly the way it verifies an MCP
 * access token — `createResourceServer({ issuer, resource: <its list URL> })`
 * from `@willyim/idp` — so there is no shared secret to store on either side,
 * nothing to rotate, and a token minted for one list URL cannot be replayed
 * against another endpoint. The alternative, an app-supplied bearer stored
 * here in plaintext, would have put a credential to every app's listing in
 * one D1 row and a second copy in each app's env.
 *
 * ── what a listing failure means ────────────────────────────────────────────
 * A miss is data (`ResourceListError`), never a throw the caller cannot
 * classify: minting reports `resource_lookup_failed` naming the type, and the
 * console says so instead of showing an empty list that looks like "nothing to
 * pick". Claims never call this — a token mint must not depend on a
 * third-party being up — which is why membership grants are checked for
 * STRUCTURE at claim time and for EXISTENCE only when they are written.
 */

export type ResourceInstance = { id: string; label: string; description: string | null }

export type ResourceLister = (input: {
  app: string
  type: ResourceTypeDecl
}) => Promise<ResourceInstance[]>

export class ResourceListError extends Error {
  constructor(
    public readonly type: string,
    public readonly reason: "unreachable" | "rejected" | "invalid_body",
    message: string,
  ) {
    super(message)
    this.name = "ResourceListError"
  }
}

const DEFAULT_TIMEOUT_MS = 5_000

export function createResourceLister(deps: {
  auth: AuthService
  /** The OIDC issuer the app will compare `iss` against — `<origin>/auth`. */
  issuer: string
  logger: ILogger
  fetch?: typeof fetch
  timeoutMs?: number
}): ResourceLister {
  const doFetch = deps.fetch ?? globalThis.fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function mintListingToken(app: string, type: ResourceTypeDecl): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const { token } = await deps.auth.api.signJWT({
      body: {
        payload: {
          sub: "idp",
          iss: deps.issuer,
          aud: type.list,
          iat: now,
          exp: now + RESOURCE_LIST_TOKEN_TTL_S,
          [APP_CLAIM]: app,
          [PERMISSIONS_CLAIM]: [RESOURCE_LIST_PERMISSION],
        },
      },
    })
    return token
  }

  return async ({ app, type }) => {
    const token = await mintListingToken(app, type)
    let response: Response
    try {
      response = await doFetch(type.list, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.logger.warn("resources.list_unreachable", { app, type: type.type, url: type.list, error: message })
      throw new ResourceListError(type.type, "unreachable", `${type.list}: ${message}`)
    }
    if (!response.ok) {
      deps.logger.warn("resources.list_rejected", { app, type: type.type, url: type.list, status: response.status })
      throw new ResourceListError(type.type, "rejected", `${type.list} answered ${response.status}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ResourceListError(type.type, "invalid_body", `${type.list} did not answer JSON`)
    }
    const raw = (body as { resources?: unknown } | null)?.resources
    if (!Array.isArray(raw)) {
      deps.logger.warn("resources.list_invalid", { app, type: type.type, url: type.list })
      throw new ResourceListError(type.type, "invalid_body", `${type.list} did not answer { resources: [] }`)
    }
    // One bad row must not hide the rest — drop it, say so, keep going.
    const instances: ResourceInstance[] = []
    let dropped = 0
    for (const entry of raw) {
      const parsed = ResourceInstanceSchema.safeParse(entry)
      if (!parsed.success) {
        dropped++
        continue
      }
      instances.push({
        id: parsed.data.id,
        label: parsed.data.label,
        description: parsed.data.description ?? null,
      })
    }
    if (dropped) deps.logger.warn("resources.list_entries_dropped", { app, type: type.type, dropped })
    return instances
  }
}
