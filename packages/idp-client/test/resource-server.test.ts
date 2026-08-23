import { describe, expect, it } from "vitest"

import { createResourceServer, PERMISSIONS_CLAIM, APP_CLAIM } from "../src/resource-server.js"

/**
 * The resource-server half: verifying a real Ed25519 JWT against a JWKS, the
 * checks that must reject (issuer, audience, expiry, signature), and the
 * permission gate. Keys are minted with WebCrypto so this exercises the actual
 * verify path, not a stub.
 */

const ISSUER = "https://idp.test/auth"
const RESOURCE = "https://bender.romo.fyi/mcp"

function b64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey
  jwk.kid = "k1"
  jwk.alg = "EdDSA"
  const jwks = { keys: [jwk] }

  async function mint(claims: Record<string, unknown>, opts: { kid?: string } = {}): Promise<string> {
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", kid: opts.kid ?? "k1", typ: "JWT" })))
    const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
    const input = `${header}.${payload}`
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(input)))
    return `${input}.${b64url(sig)}`
  }

  let jwksHits = 0
  const fetchImpl = (async () => {
    jwksHits++
    return Response.json(jwks)
  }) as unknown as typeof fetch

  const rs = createResourceServer({ issuer: ISSUER, resource: RESOURCE, fetch: fetchImpl, now: () => 1_000_000_000_000 })
  return { rs, mint, jwksHits: () => jwksHits }
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: RESOURCE,
  sub: "user_willy",
  exp: 1_000_000_000 + 3600, // now is 1e12 ms = 1e9 s; +1h
  [APP_CLAIM]: "bender",
  [PERMISSIONS_CLAIM]: ["chat:respond", "kirby:chats:read"],
  scope: "openid profile",
  ...over,
})

const req = (token?: string) => ({ headers: { get: (n: string) => (n.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) } })

describe("createResourceServer.verify", () => {
  it("accepts a well-formed token and surfaces sub, app, permissions, scopes", async () => {
    const { rs, mint } = await setup()
    const r = await rs.verify(await mint(goodClaims()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.token).toMatchObject({
      sub: "user_willy",
      app: "bender",
      permissions: ["chat:respond", "kirby:chats:read"],
      scopes: ["openid", "profile"],
    })
  })

  it("rejects a wrong audience — a token for another resource", async () => {
    const { rs, mint } = await setup()
    const r = await rs.verify(await mint(goodClaims({ aud: "https://other.example/mcp" })))
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it("rejects a wrong issuer", async () => {
    const { rs, mint } = await setup()
    const r = await rs.verify(await mint(goodClaims({ iss: "https://evil.example/auth" })))
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it("rejects an expired token", async () => {
    const { rs, mint } = await setup()
    const r = await rs.verify(await mint(goodClaims({ exp: 1 })))
    expect(r).toMatchObject({ ok: false, status: 401, description: "Token expired." })
  })

  it("rejects a tampered payload — signature no longer matches", async () => {
    const { rs, mint } = await setup()
    const token = await mint(goodClaims())
    const [h, , s] = token.split(".")
    const forged = b64url(new TextEncoder().encode(JSON.stringify(goodClaims({ [PERMISSIONS_CLAIM]: ["*"] }))))
    const r = await rs.verify(`${h}.${forged}.${s}`)
    expect(r).toMatchObject({ ok: false, status: 401, description: "Bad signature." })
  })

  it("rejects garbage", async () => {
    const { rs } = await setup()
    expect(await rs.verify("not-a-jwt")).toMatchObject({ ok: false, status: 401 })
  })
})

describe("createResourceServer.authenticate", () => {
  it("401 with no bearer", async () => {
    const { rs } = await setup()
    expect(await rs.authenticate(req())).toMatchObject({ ok: false, status: 401 })
  })

  it("passes when the required permission is held (wildcard-aware)", async () => {
    const { rs, mint } = await setup()
    const token = await mint(goodClaims({ [PERMISSIONS_CLAIM]: ["kirby:*"] }))
    const r = await rs.authenticate(req(token), { permissions: ["kirby:chats:read"] })
    expect(r.ok).toBe(true)
  })

  it("403 insufficient_scope when it is not", async () => {
    const { rs, mint } = await setup()
    const token = await mint(goodClaims({ [PERMISSIONS_CLAIM]: ["chat:respond"] }))
    const r = await rs.authenticate(req(token), { permissions: ["dexter:write"] })
    expect(r).toMatchObject({ ok: false, status: 403, error: "insufficient_scope" })
  })
})

describe("jwks caching + rotation", () => {
  it("caches the JWKS across verifies", async () => {
    const { rs, mint, jwksHits } = await setup()
    await rs.verify(await mint(goodClaims()))
    await rs.verify(await mint(goodClaims()))
    expect(jwksHits()).toBe(1)
  })

  it("refetches once on an unknown kid", async () => {
    const { rs, mint, jwksHits } = await setup()
    await rs.verify(await mint(goodClaims())) // primes cache: 1 hit
    await rs.verify(await mint(goodClaims(), { kid: "rotated" })) // miss → 1 more
    expect(jwksHits()).toBe(2)
  })
})

describe("discovery documents", () => {
  it("the WWW-Authenticate challenge points at the PRM url", async () => {
    const { rs } = await setup()
    expect(rs.challenge()).toContain(`resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`)
  })

  it("the metadata names this resource and the IdP", async () => {
    const { rs } = await setup()
    expect(rs.metadata()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] })
  })
})
