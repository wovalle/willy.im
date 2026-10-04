/**
 * The typed door to the IdP's management API.
 *
 * `call("members.invite", input, { app })`: the IdP serves every capability as
 * a semantic method (`@willyim/kit`), at `/apps/<app>/api/<service>.<method>`
 * inside one app and `/api/<service>.<method>` at the IdP level. Names, inputs
 * and outputs come from the `methods` table in `./schemas`, the one the IdP's
 * contracts are written from, so a typo is a compile error and an answer that
 * doesn't match raises an `IdpError` naming the field. Errors are the IdP's as
 * they arrive: 400 `{ error, fields }` for invalid input, `{ error }` otherwise.
 *
 * This reaches every method; see `user-keys.ts`, `app-tokens.ts` and
 * `identities.ts` for the shaped clients over the ones an app calls most.
 */

import type { z } from "zod"

import { IdpError } from "./errors.js"
import { methods, type MethodName, type Methods } from "./schemas/index.js"
import { parseWire } from "./validate.js"

/** What `call` takes: the method's input, or nothing when it takes none. */
export type CallInput<N extends MethodName> = Methods[N]["input"] extends z.ZodType
  ? z.input<Methods[N]["input"]>
  : undefined

/** What `call` answers: the method's output, parsed. */
export type CallOutput<N extends MethodName> = z.output<Methods[N]["output"]>

/** An app method needs its app; an IdP-level one takes none. */
export type CallOptions<N extends MethodName> = (Methods[N]["scope"] extends "app"
  ? { app: string }
  : { app?: undefined }) & { signal?: AbortSignal }

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
    /**
     * Calls one IdP method: `call("members.invite", { email }, { app: "acme" })`,
     * `call("applications.list", undefined)`. The answer is parsed by the
     * method's output schema; a failure throws an `IdpError` with the IdP's status and body.
     */
    async call<N extends MethodName>(
      name: N,
      input: CallInput<N>,
      ...[init]: Methods[N]["scope"] extends "app" ? [CallOptions<N>] : [CallOptions<N>?]
    ): Promise<CallOutput<N>> {
      const app = (init as { app?: string } | undefined)?.app
      const path = `${app ? `/apps/${encodeURIComponent(app)}` : ""}/api/${name}`
      const response = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        signal: init?.signal,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/json",
          ...(input === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new IdpError(`${name} failed (${response.status})`, response.status, json)
      return parseWire(methods[name].output, json, name) as CallOutput<N>
    },
  }
}

export type ManagementApi = ReturnType<typeof createManagementApi>
