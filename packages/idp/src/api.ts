/**
 * The typed door to the IdP's `/api/v1/*` management surface.
 *
 * Nothing in v1 goes through it — the management key, the directory API and
 * end-user API keys were all cut — but it exists now so that the *first*
 * management call can't be hand-written. Paths, methods, path parameters,
 * request bodies and success shapes all come from `src/generated/idp-api.d.ts`,
 * which `npm run openapi` regenerates from apps/idp's OpenAPI document. A typo
 * in a path is a compile error, not a 404 in production.
 *
 * Deliberately not exported from any entrypoint: it is internal until the
 * management surface is back in scope. Types only at runtime, so core stays
 * dependency-free.
 */

import { IdpError } from "./client.js"
import type { paths } from "./generated/idp-api.js"

export type ApiPaths = paths
export type Method = "get" | "put" | "post" | "delete" | "patch"

/** The paths that actually declare `M` — `paths` types the rest as `never`. */
export type PathsFor<M extends Method> = {
  [P in keyof paths]: paths[P] extends { [K in M]: object } ? P : never
}[keyof paths]

export type Operation<P extends keyof paths, M extends Method> = M extends keyof paths[P]
  ? paths[P][M]
  : never

type PathParams<O> = O extends { parameters: { path: infer T } }
  ? T extends object
    ? T
    : never
  : never

type RequestBody<O> = O extends { requestBody: { content: { "application/json": infer B } } }
  ? B
  : never

/** The 200 or 201 JSON body, whichever this operation declares. */
type SuccessBody<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { "application/json": infer T } } }
    ? T
    : R extends { 201: { content: { "application/json": infer T } } }
      ? T
      : never
  : never

export type RequestOptions<O> = ([PathParams<O>] extends [never]
  ? { params?: undefined }
  : { params: PathParams<O> }) &
  ([RequestBody<O>] extends [never] ? { body?: undefined } : { body: RequestBody<O> }) & {
    query?: Record<string, string | number | boolean | undefined>
    signal?: AbortSignal
  }

export type ManagementApiOptions = {
  /** IdP origin — the API lives at the root, not under the `/auth` basepath. */
  baseUrl: string
  /** Superadmin `ADMIN_API_TOKEN` or a scoped `wim_…` key. */
  token: string
  fetch?: typeof fetch
}

export function createManagementApi(options: ManagementApiOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "")
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    async request<M extends Method, P extends PathsFor<M>>(
      method: M,
      path: P,
      init: RequestOptions<Operation<P, M>> = {} as RequestOptions<Operation<P, M>>,
    ): Promise<SuccessBody<Operation<P, M>>> {
      const params = (init.params ?? {}) as Record<string, string>
      const rendered = String(path).replace(/\{([^}]+)\}/g, (_, name: string) => {
        const value = params[name]
        if (value === undefined) throw new Error(`missing path parameter "${name}" for ${path}`)
        return encodeURIComponent(value)
      })
      const url = new URL(`${baseUrl}${rendered}`)
      for (const [key, value] of Object.entries(init.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value))
      }

      const response = await doFetch(url.toString(), {
        method: method.toUpperCase(),
        signal: init.signal,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new IdpError(
          `${method.toUpperCase()} ${rendered} failed (${response.status})`,
          response.status,
          json,
        )
      }
      return json as SuccessBody<Operation<P, M>>
    },
  }
}

export type ManagementApi = ReturnType<typeof createManagementApi>
