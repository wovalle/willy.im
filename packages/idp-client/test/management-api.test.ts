import { describe, expect, expectTypeOf, it } from "vitest"

import { createManagementApi, type CallOutput } from "../src/api.js"
import { IdpError } from "../src/index.js"

/** The management API client: `call`, over the IdP's semantic methods. */
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

describe("call", () => {
  it("posts an app method to /apps/<app>/api/<service>.<method>, parsing the answer", async () => {
    const { api, seen } = apiFor(() => json({ result: "invited" }))
    const res = await api.call("members.invite", { email: "a@b.test", role: "admin" }, { app: "in voices" })

    expect(res).toEqual({ result: "invited" })
    expectTypeOf(res).toEqualTypeOf<{ result: "added" | "invited" }>()
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.url).toBe("https://idp.test/apps/in%20voices/api/members.invite")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer wim_test")
    expect(await seen[0]?.clone().json()).toEqual({ email: "a@b.test", role: "admin" })
  })

  it("posts an IdP-level method to /api/<service>.<method>, with no body when it takes no input", async () => {
    const { api, seen } = apiFor(() => json({ applications: [] }))
    expect(await api.call("applications.list", undefined)).toEqual({ applications: [] })
    expect(seen[0]?.url).toBe("https://idp.test/api/applications.list")
    expect(await seen[0]?.clone().text()).toBe("")
  })

  it("surfaces the IdP's error as it arrives: status and body", async () => {
    const body = { error: "invalid input", fields: { email: ["Invalid email address"] } }
    const { api } = apiFor(() => json(body, 400))
    const err = await api.call("members.invite", { email: "x@y.z" }, { app: "acme" }).catch((e) => e)
    expect(err).toBeInstanceOf(IdpError)
    expect(err).toMatchObject({ status: 400, body })
  })

  it("raises on an answer the method's output schema rejects", async () => {
    const { api } = apiFor(() => json({ result: "maybe" }))
    await expect(api.call("members.invite", { email: "a@b.test" }, { app: "acme" })).rejects.toThrow(
      IdpError,
    )
  })

  it("types names, inputs and the app", () => {
    const { api } = apiFor(() => json({}))
    // @ts-expect-error — an app method needs its app.
    void (() => api.call("members.list", undefined))
    // @ts-expect-error — not a method.
    void (() => api.call("members.nope", undefined, { app: "acme" }))
    // @ts-expect-error — the input is the method's.
    void (() => api.call("user_keys.revoke", { key: "k" }, { app: "acme" }))
    expect(api).toBeTruthy()
  })

  it("types each answer off the methods table", () => {
    expectTypeOf<CallOutput<"users.list">["users"][number]>().toEqualTypeOf<{
      id: string
      email: string
      name: string | null
      // Never null: the IdP fills it with a blobatar for anyone without a picture.
      image: string
      emailVerified: boolean
      createdAt: string
    }>()
    // No permissions field: an admin key holds them all.
    expectTypeOf<CallOutput<"admin_keys.list">["keys"][number]>().toEqualTypeOf<{
      id: string
      name: string
      prefix: string
      status: "active" | "expired" | "revoked"
      createdAt: string
      lastUsedAt: string | null
      expiresAt: string | null
      revokedAt: string | null
    }>()
    expectTypeOf<CallOutput<"admin_keys.mint">>().toEqualTypeOf<{
      id: string
      token: string
      prefix: string
    }>()
    expectTypeOf<CallOutput<"applications.register">>().toEqualTypeOf<{
      clientId: string
      clientSecret: string
      app: string
    }>()
  })
})
