import { describe, expect, it } from "vitest"

import { createIdpClient, createManagementApi, IdpError, normalizeClaims } from "../src/index.js"

/**
 * What happens when the IdP answers something we didn't expect. Before these
 * schemas existed each of these was a cast: a discovery document without a
 * `token_endpoint` produced `fetch(undefined)`, a 200 with no `access_token`
 * produced `accessToken: ""` and got written to a session row, and a null in
 * the workspaces claim crashed the request with a TypeError about `id`.
 *
 * Every one of them should now be an `IdpError` that names the field.
 */

const DISCOVERY = {
  issuer: "https://idp.test/auth",
  authorization_endpoint: "https://idp.test/auth/oauth2/authorize",
  token_endpoint: "https://idp.test/auth/oauth2/token",
  userinfo_endpoint: "https://idp.test/auth/oauth2/userinfo",
}

/** A fetch that answers discovery normally and everything else with `body`. */
function stubFetch(body: unknown, options: { discovery?: unknown } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(".well-known")) {
      return Response.json(options.discovery ?? DISCOVERY)
    }
    return Response.json(body)
  }) as typeof fetch
}

function clientWith(body: unknown, options: { discovery?: unknown } = {}) {
  return createIdpClient({
    issuer: "https://idp.test/auth",
    clientId: "client",
    clientSecret: "secret",
    fetch: stubFetch(body, options),
  })
}

describe("discovery", () => {
  it("rejects a document missing an endpoint we depend on", async () => {
    const { token_endpoint: _dropped, ...rest } = DISCOVERY
    const client = clientWith({}, { discovery: rest })
    await expect(client.discover()).rejects.toThrow(/token_endpoint/)
  })

  it("keeps unknown fields rather than stripping them", async () => {
    const client = clientWith({}, { discovery: { ...DISCOVERY, future_thing: "kept" } })
    expect(await client.discover()).toMatchObject({ future_thing: "kept" })
  })

  it("accepts the optional extensions when present", async () => {
    const client = clientWith({}, { discovery: { ...DISCOVERY, session_max_age: 3600 } })
    expect((await client.discover()).session_max_age).toBe(3600)
  })
})

describe("token endpoint", () => {
  it("refuses a 200 with no access token instead of inventing an empty one", async () => {
    const client = clientWith({ token_type: "Bearer", expires_in: 3600 })
    await expect(
      client.exchangeCode({ code: "c", redirectUri: "https://app.test/cb", codeVerifier: "v" }),
    ).rejects.toThrow(/access_token/)
  })

  it("refuses an access token of the wrong type", async () => {
    const client = clientWith({ access_token: 12345 })
    await expect(client.refresh("refresh")).rejects.toBeInstanceOf(IdpError)
  })

  it("defaults the token type and nulls the absent optionals", async () => {
    const client = clientWith({ access_token: "at" })
    expect(await client.refresh("refresh")).toEqual({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: null,
      refreshToken: null,
      idToken: null,
      scope: null,
    })
  })
})

describe("claims", () => {
  it("drops a malformed workspace instead of throwing", () => {
    const claims = normalizeClaims({
      sub: "user_1",
      "https://willy.im/workspaces": [null, { id: "ws_1", slug: "acme", name: "Acme" }],
    })
    expect(claims.workspaces).toEqual([
      { id: "ws_1", slug: "acme", name: "Acme", domain: null, role: "member" },
    ])
  })

  it("degrades every optional claim, since a bare user is not an error", () => {
    expect(normalizeClaims({ sub: "user_1" })).toEqual({
      sub: "user_1",
      email: "",
      emailVerified: false,
      name: null,
      image: null,
      permissions: [],
      workspaces: [],
      actor: null,
    })
  })

  it("survives a permissions claim that is not an array", () => {
    const claims = normalizeClaims({ sub: "user_1", "https://willy.im/permissions": "admin" })
    expect(claims.permissions).toEqual([])
  })

  it("insists on a sub — without one there is no identity to seat", () => {
    expect(() => normalizeClaims({ email: "who@willy.im" })).toThrow(/sub/)
  })
})

describe("management api", () => {
  const api = (body: unknown) =>
    createManagementApi({
      baseUrl: "https://idp.test",
      token: "wim_test",
      fetch: (async () => Response.json(body)) as typeof fetch,
    })

  it("rejects a response that doesn't match the operation's schema", async () => {
    await expect(api({ members: [{ userId: "u_1" }] }).request("get", "/api/v1/apps/{app}/members", {
      params: { app: "acme" },
    })).rejects.toThrow(/members\.0/)
  })

  it("names the operation in the error", async () => {
    await expect(
      api({ wrong: true }).request("get", "/api/v1/users"),
    ).rejects.toThrow(/GET \/api\/v1\/users/)
  })

  it("passes a well-formed response straight through", async () => {
    const body = { members: [{ userId: "u_1", email: "a@b.c", name: null, role: "admin", permissions: [] }] }
    expect(
      await api(body).request("get", "/api/v1/apps/{app}/members", { params: { app: "acme" } }),
    ).toEqual(body)
  })
})
