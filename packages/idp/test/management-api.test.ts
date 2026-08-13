import { describe, expect, expectTypeOf, it } from "vitest"

import { createManagementApi } from "../src/api.js"
import { IdpError } from "../src/index.js"

/**
 * The `/api/v1/*` helper. Nothing in v1 calls it — the management surface is
 * cut — but the pipeline is wired now so the first management call can't be
 * hand-written: paths, path params, bodies and response shapes all come from
 * `src/generated/idp-api.d.ts`, which `npm run openapi` regenerates from
 * apps/idp's OpenAPI document.
 */
function apiFor(handler: (request: Request) => Response) {
  const seen: Request[] = []
  const api = createManagementApi({
    baseUrl: "https://idp.test",
    token: "wim_test",
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init)
      seen.push(request)
      return handler(request)
    },
  })
  return { api, seen }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("createManagementApi", () => {
  it("fills path parameters and authenticates with the bearer token", async () => {
    const { api, seen } = apiFor(() => json({ members: [] }))
    await api.request("get", "/api/v1/apps/{app}/members", { params: { app: "in voices" } })

    expect(seen[0]?.url).toBe("https://idp.test/api/v1/apps/in%20voices/members")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer wim_test")
  })

  it("sends a JSON body and returns the typed success shape", async () => {
    const { api, seen } = apiFor(() => json({ result: "invited" }, 201))
    const created = await api.request("post", "/api/v1/apps/{app}/members", {
      params: { app: "invoices" },
      body: { email: "new@willy.im", role: "member", permissions: ["invoices:read"] },
    })

    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.headers.get("content-type")).toBe("application/json")
    expect(await seen[0]?.clone().json()).toEqual({
      email: "new@willy.im",
      role: "member",
      permissions: ["invoices:read"],
    })
    // The generated type, not a hand-written one — and the document says the
    // 201 body is `{ result }` and nothing else.
    expectTypeOf(created).toEqualTypeOf<{ result: "added" | "invited" }>()
    expect(created.result).toBe("invited")
  })

  it("appends query parameters", async () => {
    const { api, seen } = apiFor(() => json({ keys: [] }))
    await api.request("get", "/api/v1/apps/{app}/user-keys", {
      params: { app: "invoices" },
      query: { userId: "u_1", workspaceId: undefined },
    })

    const url = new URL(seen[0]!.url)
    expect(url.searchParams.get("userId")).toBe("u_1")
    expect(url.searchParams.has("workspaceId")).toBe(false)
  })

  it("turns a non-2xx into an IdpError carrying the body", async () => {
    const { api } = apiFor(() => json({ error: "forbidden" }, 403))
    const failure = await api
      .request("get", "/api/v1/applications")
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(IdpError)
    expect(failure).toMatchObject({ status: 403, body: { error: "forbidden" } })
  })

  it("types the cross-app list endpoints from the spec", async () => {
    const { api } = apiFor(() => json({ users: [] }))
    const users = await api.request("get", "/api/v1/users")

    expectTypeOf(users.users).toEqualTypeOf<
      {
        id: string
        email: string
        name: string | null
        emailVerified: boolean
        createdAt: string
      }[]
    >()
    expect(users.users).toEqual([])
  })

  it("rejects a path the spec doesn't declare for that method", () => {
    const { api } = apiFor(() => json({}))
    // @ts-expect-error — /api/v1/applications is GET-only in the OpenAPI document.
    void (() => api.request("post", "/api/v1/applications"))
    // @ts-expect-error — not a path in the document at all.
    void (() => api.request("get", "/api/v1/nope"))
    expect(api).toBeTruthy()
  })
})
