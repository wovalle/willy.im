/**
 * The typed door to the IdP's `/api/v1/*` management surface.
 *
 * Paths, methods, request bodies and success shapes all come from the
 * operations table in `./schemas/operations.ts` — the same table that builds
 * the OpenAPI document and that `apps/idp` validates requests with. A typo in
 * a path is a compile error, not a 404 in production, and a response that
 * doesn't match its schema raises an `IdpError` naming the field rather than
 * surfacing as `undefined` somewhere downstream.
 *
 * Path parameters are read off the path template itself, so `{app}` in the
 * string is what makes `params.app` required.
 *
 * This is the escape hatch for any endpoint without sugar of its own; see
 * `user-keys.ts` for the shaped client over the end-user key endpoints.
 */

import type { z } from "zod"

import { IdpError } from "./errors.js"
import {
  lookup,
  type HttpMethod,
  type OperationDef,
  type OperationFor,
  type PathParamNames,
  type PathsFor,
} from "./schemas/operations.js"
import { parseWire } from "./validate.js"

export type Method = HttpMethod
export type { PathsFor }

/** What the caller must supply: `{app}` in the path becomes `params.app`. */
type PathParams<P extends string> = [PathParamNames<P>] extends [never]
  ? { params?: undefined }
  : { params: Record<PathParamNames<P>, string> }

type RequestBody<O> = O extends { input: infer S extends z.ZodType }
  ? { body: z.input<S> }
  : { body?: undefined }

/** The 200 or 201 JSON body, whichever this operation declares. */
export type SuccessBody<O> = O extends { success: infer S extends z.ZodType }
  ? z.output<S>
  : never

export type RequestOptions<P extends string, O> = PathParams<P> &
  RequestBody<O> & {
    query?: Record<string, string | number | boolean | undefined>
    signal?: AbortSignal
  }

export type ManagementApiOptions = {
  /** IdP origin — the API lives at the root, not under the `/auth` basepath. */
  baseUrl: string
  /** An IdP-level admin key or a per-app scoped `wim_…` key. */
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
      init: RequestOptions<P, OperationFor<M, P>> = {} as RequestOptions<P, OperationFor<M, P>>,
    ): Promise<SuccessBody<OperationFor<M, P>>> {
      const operation = lookup(method, path) as OperationDef
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
      return parseWire(
        operation.success,
        json,
        `${method.toUpperCase()} ${rendered}`,
      ) as SuccessBody<OperationFor<M, P>>
    },
  }
}

export type ManagementApi = ReturnType<typeof createManagementApi>
