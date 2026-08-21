/**
 * End-user API keys, from the consuming app's side.
 *
 * The IdP is the key store: an app mints, lists, revokes and validates `wak_…`
 * keys through the management API, authenticated with its own scoped `wim_…`
 * key, and never persists a plaintext token or a hash of one. This module is
 * the sugar over those four calls, plus the two things every consumer would
 * otherwise write badly by hand:
 *
 *  - a validation cache. `validate` is a network round trip, and API keys
 *    arrive on the request-per-request hot path. Results are cached by digest
 *    of the token, with a short TTL, and concurrent validations of the same
 *    token share one in-flight request. The cost is revocation lag bounded by
 *    `cache.ttlMs` — pick it deliberately, and call `forget` after a revoke you
 *    performed yourself.
 *  - `authenticate`, which reads the bearer token off a `Request`, validates it
 *    and checks required scopes, returning a discriminated result rather than
 *    throwing, so the caller decides what a 401 looks like.
 *
 * Only for *secret* credentials. A public write key embedded in a page (an
 * analytics ingest token, say) identifies a site rather than a user, cannot be
 * kept secret, and must not pay a round trip per hit — keep those in the app's
 * own table.
 */

import type { paths } from "./generated/idp-api.js"
import { createManagementApi, type ManagementApiOptions } from "./api.js"
import { sha256Base64url } from "./crypto.js"

type ListOk =
  paths["/api/v1/apps/{app}/user-keys"]["get"]["responses"][200]["content"]["application/json"]
type CreateBody =
  paths["/api/v1/apps/{app}/user-keys"]["post"]["requestBody"]["content"]["application/json"]
type CreateOk =
  paths["/api/v1/apps/{app}/user-keys"]["post"]["responses"][201]["content"]["application/json"]
type ValidateOk =
  paths["/api/v1/apps/{app}/user-keys/validate"]["post"]["responses"][200]["content"]["application/json"]

/** One key as the IdP reports it. Never includes the token or its hash. */
export type UserApiKey = ListOk["keys"][number]

/** What `create` hands back. `token` is the only time the plaintext exists. */
export type MintedUserApiKey = CreateOk

/** A validation verdict. A miss is data, not an error — hence `valid: false`. */
export type UserKeyValidation = ValidateOk

/** The `valid: true` half, i.e. an authenticated key. */
export type AuthenticatedKey = Extract<UserKeyValidation, { valid: true }>

export type UserKeyCacheOptions = {
  /** How long a `valid: true` verdict is reused. Default 60s. */
  ttlMs?: number
  /** How long a `valid: false` verdict is reused. Default 10s. */
  missTtlMs?: number
  /** Entry ceiling before the oldest are dropped. Default 1000. */
  max?: number
}

export type UserKeysOptions = ManagementApiOptions & {
  /** The app key these keys belong to — `oauth_client.metadata.app`. */
  app: string
  /** `false` disables caching entirely (every validate is a round trip). */
  cache?: UserKeyCacheOptions | false
  /** Clock seam, for tests. */
  now?: () => number
}

export type ListFilter = {
  userId?: string
  workspaceId?: string
  signal?: AbortSignal
}

export type CreateUserApiKeyInput = CreateBody & { signal?: AbortSignal }

export type AuthenticateOptions = {
  /** Every scope listed must be present on the key. */
  scopes?: string[]
  signal?: AbortSignal
}

export type AuthenticateResult =
  | { ok: true; key: AuthenticatedKey }
  | {
      ok: false
      status: 401 | 403
      reason: "missing" | "not_found" | "revoked" | "expired" | "insufficient_scope"
      /** The scopes that were required but absent, when `insufficient_scope`. */
      missing?: string[]
    }

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MISS_TTL_MS = 10_000
const DEFAULT_MAX = 1000

/**
 * Reads a presented key off a request: `Authorization: Bearer …` first, then
 * `X-API-Key`. Returns null when neither is present, so "no credential" stays
 * distinguishable from "bad credential".
 */
export function readApiKey(request: { headers: Headers }): string | null {
  const authorization = request.headers.get("authorization")
  if (authorization) {
    const [scheme, ...rest] = authorization.split(" ")
    const value = rest.join(" ").trim()
    if (scheme?.toLowerCase() === "bearer" && value) return value
  }
  return request.headers.get("x-api-key")?.trim() || null
}

type CacheEntry = { verdict: UserKeyValidation; expiresAt: number }

export function createUserKeys(options: UserKeysOptions) {
  const api = createManagementApi(options)
  const app = options.app
  const now = options.now ?? (() => Date.now())

  const caching = options.cache !== false
  const ttlMs = (options.cache || {}).ttlMs ?? DEFAULT_TTL_MS
  const missTtlMs = (options.cache || {}).missTtlMs ?? DEFAULT_MISS_TTL_MS
  const max = (options.cache || {}).max ?? DEFAULT_MAX

  // Keyed by digest, never by the token itself: a heap dump or a logged Map
  // then leaks nothing usable. Insertion-ordered, so the oldest entry is the
  // first key — good enough eviction for a cache this size.
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<UserKeyValidation>>()

  const digest = (token: string) => sha256Base64url(`user-key:${app}:${token}`)

  function remember(key: string, verdict: UserKeyValidation) {
    if (!caching) return
    if (cache.size >= max) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(key, { verdict, expiresAt: now() + (verdict.valid ? ttlMs : missTtlMs) })
  }

  async function fetchVerdict(token: string, signal?: AbortSignal) {
    return api.request("post", "/api/v1/apps/{app}/user-keys/validate", {
      params: { app },
      body: { token },
      signal,
    })
  }

  /**
   * Validates a presented token. Served from cache when fresh; concurrent
   * callers presenting the same token share one round trip. `fresh: true`
   * bypasses the cache for that call and reseeds it.
   */
  async function validate(
    token: string,
    init: { signal?: AbortSignal; fresh?: boolean } = {},
  ): Promise<UserKeyValidation> {
    if (!token) return { valid: false, reason: "not_found" }
    const key = await digest(token)

    if (!init.fresh && caching) {
      const hit = cache.get(key)
      if (hit && hit.expiresAt > now()) return hit.verdict
      if (hit) cache.delete(key)
      const pending = inFlight.get(key)
      if (pending) return pending
    }

    const request = fetchVerdict(token, init.signal)
      .then((verdict) => {
        remember(key, verdict)
        return verdict
      })
      .finally(() => {
        inFlight.delete(key)
      })

    // A failed round trip must not be cached — an IdP blip would otherwise
    // lock every caller out for the whole TTL.
    if (caching) inFlight.set(key, request)
    return request
  }

  return {
    validate,

    /** The keys this app has minted, newest first. Optionally filtered. */
    async list(filter: ListFilter = {}): Promise<UserApiKey[]> {
      const { keys } = await api.request("get", "/api/v1/apps/{app}/user-keys", {
        params: { app },
        query: { userId: filter.userId, workspaceId: filter.workspaceId },
        signal: filter.signal,
      })
      return keys
    },

    /**
     * Mints a key for one of the app's users. The returned `token` is the only
     * copy — show it once and forget it. Scopes must come from the app's
     * declared product permission catalog; unknown ones are a 422, not a
     * silent drop.
     */
    async create(input: CreateUserApiKeyInput): Promise<MintedUserApiKey> {
      const { signal, ...body } = input
      return api.request("post", "/api/v1/apps/{app}/user-keys", {
        params: { app },
        body,
        signal,
      })
    },

    /**
     * Revokes a key by id (idempotent). Cached verdicts for *other* tokens are
     * untouched; this app never saw the revoked plaintext, so the entry for it
     * can only expire on its own TTL. Call `forget(token)` instead when the
     * plaintext is in hand.
     */
    async revoke(id: string, init: { signal?: AbortSignal } = {}): Promise<{ ok: true }> {
      return api.request("delete", "/api/v1/apps/{app}/user-keys/{id}", {
        params: { app, id },
        signal: init.signal,
      })
    },

    /**
     * The whole check in one call: read the credential off the request,
     * validate it, and confirm every required scope. Returns a result rather
     * than throwing, so the caller owns the response shape.
     */
    async authenticate(
      request: { headers: Headers },
      init: AuthenticateOptions = {},
    ): Promise<AuthenticateResult> {
      const token = readApiKey(request)
      if (!token) return { ok: false, status: 401, reason: "missing" }

      const verdict = await validate(token, { signal: init.signal })
      if (!verdict.valid) return { ok: false, status: 401, reason: verdict.reason }

      const required = init.scopes ?? []
      const missing = required.filter((scope) => !verdict.scopes.includes(scope))
      if (missing.length) {
        return { ok: false, status: 403, reason: "insufficient_scope", missing }
      }
      return { ok: true, key: verdict }
    },

    /** Drops one token's cached verdict, or the whole cache when called bare. */
    async forget(token?: string): Promise<void> {
      if (token === undefined) {
        cache.clear()
        return
      }
      cache.delete(await digest(token))
    },
  }
}

export type UserKeys = ReturnType<typeof createUserKeys>
