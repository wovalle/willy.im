import { describe, expect, it } from "vitest"

import { createUserKeys, readApiKey } from "../src/user-keys.js"
import { IdpError } from "../src/index.js"

/**
 * The consumer-side client for end-user API keys. The interesting behaviour is
 * not the four HTTP calls — those are `createManagementApi` — but the cache in
 * front of `validate`, which is what keeps a per-request credential check off
 * the wire.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function keysFor(handler: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = []
  let clock = 1_000
  const keys = createUserKeys({
    baseUrl: "https://idp.test",
    token: "wim_luchy",
    app: "luchy",
    now: () => clock,
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init)
      seen.push(request)
      return handler(request)
    },
  })
  return { keys, seen, advance: (ms: number) => (clock += ms) }
}

const validKey = {
  valid: true,
  keyId: "k_1",
  userId: "u_1",
  workspaceId: "w_1",
  scopes: ["analytics:read"],
  name: "cli",
}

describe("readApiKey", () => {
  it("prefers a bearer token and falls back to x-api-key", () => {
    const bearer = new Request("https://luchy.test", {
      headers: { authorization: "Bearer wak_abc", "x-api-key": "wak_ignored" },
    })
    expect(readApiKey(bearer)).toBe("wak_abc")

    const header = new Request("https://luchy.test", { headers: { "x-api-key": "wak_xyz" } })
    expect(readApiKey(header)).toBe("wak_xyz")
  })

  it("is null when there is no credential, or the scheme is not bearer", () => {
    expect(readApiKey(new Request("https://luchy.test"))).toBeNull()
    expect(
      readApiKey(new Request("https://luchy.test", { headers: { authorization: "Basic abc" } })),
    ).toBeNull()
    expect(
      readApiKey(new Request("https://luchy.test", { headers: { authorization: "Bearer " } })),
    ).toBeNull()
  })
})

describe("createUserKeys", () => {
  it("scopes every call to its own app and bearer key", async () => {
    const { keys, seen } = keysFor(() => json({ keys: [] }))
    await keys.list({ userId: "u_1" })

    const url = new URL(seen[0]!.url)
    expect(url.pathname).toBe("/api/v1/apps/luchy/user-keys")
    expect(url.searchParams.get("userId")).toBe("u_1")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer wim_luchy")
  })

  it("mints a key and returns the plaintext once", async () => {
    const { keys, seen } = keysFor(() => json({ id: "k_1", token: "wak_secret", prefix: "wak_secr" }, 201))
    const minted = await keys.create({
      userId: "u_1",
      name: "cli",
      scopes: ["analytics:read"],
      workspaceId: "w_1",
    })

    expect(minted.token).toBe("wak_secret")
    expect(seen[0]?.method).toBe("POST")
    // `signal` is transport, not payload — it must not reach the body.
    expect(await seen[0]?.clone().json()).toEqual({
      userId: "u_1",
      name: "cli",
      scopes: ["analytics:read"],
      workspaceId: "w_1",
    })
  })

  it("revokes by id under its own app", async () => {
    const { keys, seen } = keysFor(() => json({ ok: true }))
    await keys.revoke("k_1")

    expect(seen[0]?.method).toBe("DELETE")
    expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/apps/luchy/user-keys/k_1")
  })

  it("serves a repeat validation from cache, then refetches once the TTL lapses", async () => {
    const { keys, seen, advance } = keysFor(() => json(validKey))

    expect(await keys.validate("wak_secret")).toMatchObject({ valid: true, userId: "u_1" })
    expect(await keys.validate("wak_secret")).toMatchObject({ valid: true, userId: "u_1" })
    expect(seen).toHaveLength(1)

    advance(60_001)
    await keys.validate("wak_secret")
    expect(seen).toHaveLength(2)
  })

  it("caches a miss on its own shorter TTL", async () => {
    const { keys, seen, advance } = keysFor(() => json({ valid: false, reason: "revoked" }))

    expect(await keys.validate("wak_gone")).toEqual({ valid: false, reason: "revoked" })
    await keys.validate("wak_gone")
    expect(seen).toHaveLength(1)

    advance(10_001)
    await keys.validate("wak_gone")
    expect(seen).toHaveLength(2)
  })

  it("collapses concurrent validations of the same token into one round trip", async () => {
    let release: (value: Response) => void = () => {}
    const held = new Promise<Response>((resolve) => (release = resolve))
    const { keys, seen } = keysFor(() => held)

    const pending = Promise.all([keys.validate("wak_secret"), keys.validate("wak_secret")])
    release(json(validKey))

    const [a, b] = await pending
    expect(a).toEqual(b)
    expect(seen).toHaveLength(1)
  })

  it("does not cache a failed round trip", async () => {
    let fail = true
    const { keys, seen } = keysFor(() => (fail ? json({ error: "boom" }, 500) : json(validKey)))

    await expect(keys.validate("wak_secret")).rejects.toBeInstanceOf(IdpError)
    fail = false
    expect(await keys.validate("wak_secret")).toMatchObject({ valid: true })
    expect(seen).toHaveLength(2)
  })

  it("bypasses and reseeds the cache on `fresh`, and forgets on demand", async () => {
    const { keys, seen } = keysFor(() => json(validKey))

    await keys.validate("wak_secret")
    await keys.validate("wak_secret", { fresh: true })
    expect(seen).toHaveLength(2)

    await keys.validate("wak_secret")
    expect(seen).toHaveLength(2)

    await keys.forget("wak_secret")
    await keys.validate("wak_secret")
    expect(seen).toHaveLength(3)
  })

  it("never round-trips an empty token", async () => {
    const { keys, seen } = keysFor(() => json(validKey))
    expect(await keys.validate("")).toEqual({ valid: false, reason: "not_found" })
    expect(seen).toHaveLength(0)
  })

  it("authenticates a request and enforces required scopes", async () => {
    const { keys } = keysFor(() => json(validKey))
    const request = new Request("https://api.luchy.test/v1/q", {
      headers: { authorization: "Bearer wak_secret" },
    })

    await expect(keys.authenticate(request, { scopes: ["analytics:read"] })).resolves.toEqual({
      ok: true,
      key: validKey,
    })

    await expect(keys.authenticate(request, { scopes: ["analytics:write"] })).resolves.toEqual({
      ok: false,
      status: 403,
      reason: "insufficient_scope",
      missing: ["analytics:write"],
    })
  })

  it("separates a missing credential from a rejected one", async () => {
    const { keys } = keysFor(() => json({ valid: false, reason: "expired" }))

    await expect(keys.authenticate(new Request("https://api.luchy.test"))).resolves.toEqual({
      ok: false,
      status: 401,
      reason: "missing",
    })

    const presented = new Request("https://api.luchy.test", {
      headers: { "x-api-key": "wak_old" },
    })
    await expect(keys.authenticate(presented)).resolves.toEqual({
      ok: false,
      status: 401,
      reason: "expired",
    })
  })

  it("skips the cache entirely when it is disabled", async () => {
    const seen: Request[] = []
    const keys = createUserKeys({
      baseUrl: "https://idp.test",
      token: "wim_luchy",
      app: "luchy",
      cache: false,
      fetch: async (input, init) => {
        seen.push(new Request(input as RequestInfo, init))
        return json(validKey)
      },
    })

    await keys.validate("wak_secret")
    await keys.validate("wak_secret")
    expect(seen).toHaveLength(2)
  })

  it("evicts the oldest entry once the cache is full", async () => {
    let calls = 0
    const bounded = createUserKeys({
      baseUrl: "https://idp.test",
      token: "wim_luchy",
      app: "luchy",
      cache: { max: 2 },
      fetch: async () => {
        calls++
        return json(validKey)
      },
    })

    await bounded.validate("wak_a")
    await bounded.validate("wak_b")
    await bounded.validate("wak_c") // pushes wak_a out
    expect(calls).toBe(3)

    await bounded.validate("wak_c") // still resident
    expect(calls).toBe(3)

    await bounded.validate("wak_a") // evicted, so back to the wire
    expect(calls).toBe(4)
  })
})
