/**
 * App tokens, from the side that holds an IdP admin key.
 *
 * Like a GitHub App: the admin key (`wim_…`) is the private key and never goes
 * to an app; the IdP exchanges it for a short-lived installation token (`wat_…`).
 *
 * A token is bound to one app and carries `["*"]`, everything the admin may do
 * there, unless narrowed to `scopes` or one workspace at mint. The app checks
 * it like an end-user key (`createUserKeys().authenticate`) and gets
 * `kind: "app"` back, with the issuer in `issuedBy`.
 *
 * Tokens live an hour at most, so `get` keeps one per (app, scopes, workspace)
 * until a minute before it expires. Concurrent callers share one in-flight
 * mint, and a failed mint is never cached.
 */

import type { z } from "zod"

import { createManagementApi, type ManagementApiOptions } from "./api.js"
import type { AppTokenCreatedSchema } from "./schemas/index.js"

/** `token` must be an IdP-level admin key: the IdP mints for no one else. */
export type AppTokensOptions = ManagementApiOptions & {
  /** Clock seam, for tests. */
  now?: () => number
}

export type GetAppTokenOptions = {
  /** Narrow the token. Omit for `["*"]`. */
  scopes?: string[]
  /** Bind the token to one workspace. Omit for any. */
  workspaceId?: string
  signal?: AbortSignal
}

/** The bearer to present to the app, and when the IdP stops accepting it (ISO 8601). */
export type AppToken = Pick<z.output<typeof AppTokenCreatedSchema>, "token" | "expiresAt">

/** How long before its expiry a cached token is replaced, so none dies mid-request. */
const REFRESH_MARGIN_MS = 60_000

type CacheEntry = { token: AppToken; refreshAt: number }

export function createAppTokens(options: AppTokensOptions) {
  const api = createManagementApi(options)
  const now = options.now ?? (() => Date.now())

  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<AppToken>>()

  // Scopes are a set, and omitting them asks for `["*"]`: `get(app)` and
  // `get(app, { scopes: ["*"] })` are the same token.
  const keyOf = (app: string, init: GetAppTokenOptions) =>
    JSON.stringify([app, [...new Set(init.scopes ?? ["*"])].sort(), init.workspaceId ?? null])

  return {
    /**
     * A token for `app`: the cached one while it has more than a minute left,
     * otherwise a fresh mint.
     */
    async get(app: string, init: GetAppTokenOptions = {}): Promise<AppToken> {
      const key = keyOf(app, init)
      const hit = cache.get(key)
      if (hit && hit.refreshAt > now()) return hit.token
      const pending = inFlight.get(key)
      if (pending) return pending

      const request = api
        .request("post", "/api/v1/apps/{app}/tokens", {
          params: { app },
          body: { scopes: init.scopes, workspaceId: init.workspaceId },
          signal: init.signal,
        })
        .then(({ token, expiresAt }) => {
          const minted = { token, expiresAt }
          cache.set(key, { token: minted, refreshAt: Date.parse(expiresAt) - REFRESH_MARGIN_MS })
          return minted
        })
        .finally(() => {
          inFlight.delete(key)
        })

      inFlight.set(key, request)
      return request
    },
  }
}

export type AppTokens = ReturnType<typeof createAppTokens>
