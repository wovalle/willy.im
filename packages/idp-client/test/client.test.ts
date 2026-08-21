import { describe, expect, it } from "vitest"

import { createIdpClient, createPkce, IdpError } from "../src/index.js"
import { createStubIdp } from "./helpers/stub-idp.js"

/**
 * Layer 0: the wire protocol. Nothing here knows about cookies or sessions —
 * it's the OIDC relying party on its own.
 */
function clientFor(options: Parameters<typeof createStubIdp>[0] = {}) {
  const stub = createStubIdp(options)
  const client = createIdpClient({
    issuer: stub.issuer,
    clientId: stub.clientId,
    clientSecret: stub.clientSecret,
    fetch: stub.fetch,
  })
  return { stub, client }
}

describe("discovery", () => {
  it("is fetched once per instance, however many calls need it", async () => {
    const { stub, client } = clientFor()
    await Promise.all([client.discover(), client.discover()])
    await client.discover()
    expect(stub.counters.discovery).toBe(1)
  })

  it("is derived from the issuer, basepath included", async () => {
    const { stub, client } = clientFor({ issuer: "https://idp.test/auth" })
    const discovery = await client.discover()
    expect(discovery.issuer).toBe(stub.issuer)
    expect(discovery.token_endpoint).toBe("https://idp.test/auth/oauth2/token")
  })

  it("surfaces a failure as an IdpError and does not cache it", async () => {
    const stub = createStubIdp()
    const client = createIdpClient({
      issuer: "https://idp.test/nope",
      clientId: "x",
      clientSecret: "y",
      fetch: stub.fetch,
    })
    await expect(client.discover()).rejects.toBeInstanceOf(IdpError)
    await expect(client.discover()).rejects.toBeInstanceOf(IdpError)
    expect(stub.counters.discovery).toBe(0)
  })
})

describe("authorizationUrl", () => {
  it("carries client, redirect, state, scopes and an S256 challenge", async () => {
    const { stub, client } = clientFor()
    const { codeChallenge } = await createPkce()
    const url = new URL(
      await client.authorizationUrl({
        redirectUri: "https://app.test/auth/callback",
        state: "st4te",
        codeChallenge,
      }),
    )
    expect(`${url.origin}${url.pathname}`).toBe(stub.endpoints.authorization)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe(stub.clientId)
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/auth/callback")
    expect(url.searchParams.get("state")).toBe("st4te")
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access")
  })

  it("passes prompt through for silent and forced re-authentication", async () => {
    const { client } = clientFor()
    const { codeChallenge } = await createPkce()
    const url = new URL(
      await client.authorizationUrl({
        redirectUri: "https://app.test/cb",
        state: "s",
        codeChallenge,
        prompt: "none",
        scopes: ["openid"],
      }),
    )
    expect(url.searchParams.get("prompt")).toBe("none")
    expect(url.searchParams.get("scope")).toBe("openid")
  })
})

describe("exchangeCode", () => {
  it("completes the authorization-code + PKCE round trip", async () => {
    const { stub, client } = clientFor()
    const { codeVerifier, codeChallenge } = await createPkce()
    const authorizeUrl = await client.authorizationUrl({
      redirectUri: "https://app.test/cb",
      state: "s",
      codeChallenge,
    })
    const callback = new URL(stub.authorize(authorizeUrl))

    const tokens = await client.exchangeCode({
      code: callback.searchParams.get("code")!,
      redirectUri: "https://app.test/cb",
      codeVerifier,
    })

    expect(tokens.accessToken).toMatch(/^at_/)
    expect(tokens.refreshToken).toMatch(/^rt_/)
    expect(tokens.idToken).toBeTruthy()
    expect(tokens.expiresIn).toBe(3600)
    expect(stub.lastTokenRequest).toMatchObject({
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
      client_secret: stub.clientSecret,
    })
  })

  it("rejects a code presented with the wrong verifier", async () => {
    const { stub, client } = clientFor()
    const { codeChallenge } = await createPkce()
    const authorizeUrl = await client.authorizationUrl({
      redirectUri: "https://app.test/cb",
      state: "s",
      codeChallenge,
    })
    const callback = new URL(stub.authorize(authorizeUrl))

    await expect(
      client.exchangeCode({
        code: callback.searchParams.get("code")!,
        redirectUri: "https://app.test/cb",
        codeVerifier: "not-the-verifier",
      }),
    ).rejects.toBeInstanceOf(IdpError)
  })
})

describe("userinfo", () => {
  it("unwraps the https://willy.im/* namespace into flat claims", async () => {
    const { stub, client } = clientFor({
      claims: {
        permissions: ["invoices:read"],
        workspaces: [
          { id: "ws_1", slug: "acme", name: "Acme", domain: "acme.test", role: "owner" },
        ],
        act: { sub: "admin_1", email: "admin@willy.im" },
      },
    })
    const { codeVerifier, codeChallenge } = await createPkce()
    const authorizeUrl = await client.authorizationUrl({
      redirectUri: "https://app.test/cb",
      state: "s",
      codeChallenge,
    })
    const code = new URL(stub.authorize(authorizeUrl)).searchParams.get("code")!
    const tokens = await client.exchangeCode({
      code,
      redirectUri: "https://app.test/cb",
      codeVerifier,
    })

    const claims = await client.userinfo(tokens.accessToken)
    expect(claims).toMatchObject({
      sub: "user_1",
      email: "willy@willy.im",
      emailVerified: true,
      name: "Willy",
      image: null,
      permissions: ["invoices:read"],
      actor: { sub: "admin_1", email: "admin@willy.im" },
    })
    expect(claims.workspaces[0]).toEqual({
      id: "ws_1",
      slug: "acme",
      name: "Acme",
      domain: "acme.test",
      role: "owner",
    })
    expect(Object.keys(claims)).not.toContain("https://willy.im/permissions")
  })

  it("throws a 401 IdpError for an unknown access token", async () => {
    const { client } = clientFor()
    await expect(client.userinfo("garbage")).rejects.toMatchObject({ status: 401 })
  })
})

describe("refresh", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const { stub, client } = clientFor()
    const { codeVerifier, codeChallenge } = await createPkce()
    const authorizeUrl = await client.authorizationUrl({
      redirectUri: "https://app.test/cb",
      state: "s",
      codeChallenge,
    })
    const code = new URL(stub.authorize(authorizeUrl)).searchParams.get("code")!
    const first = await client.exchangeCode({
      code,
      redirectUri: "https://app.test/cb",
      codeVerifier,
    })

    const second = await client.refresh(first.refreshToken!)
    expect(second.accessToken).not.toBe(first.accessToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
  })

  it("throws once the grant is gone", async () => {
    const { client } = clientFor()
    await expect(client.refresh("rt_revoked")).rejects.toBeInstanceOf(IdpError)
  })
})

describe("logoutUrl", () => {
  it("builds RP-initiated logout from the discovered end_session_endpoint", async () => {
    const { stub, client } = clientFor()
    const url = new URL(
      (await client.logoutUrl({ idToken: "idtok.x", redirectTo: "https://app.test/" }))!,
    )
    expect(`${url.origin}${url.pathname}`).toBe(stub.endpoints.endSession)
    expect(url.searchParams.get("id_token_hint")).toBe("idtok.x")
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://app.test/")
    expect(url.searchParams.get("client_id")).toBe(stub.clientId)
  })

  it("is null without an id_token to hint with — this IdP requires one", async () => {
    const { client } = clientFor()
    expect(await client.logoutUrl({ redirectTo: "https://app.test/" })).toBeNull()
  })

  it("is null when the IdP advertises no end_session_endpoint", async () => {
    const { client } = clientFor({ endSession: false })
    expect(await client.logoutUrl({ idToken: "idtok.x" })).toBeNull()
  })
})
