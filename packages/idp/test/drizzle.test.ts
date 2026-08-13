import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleSessions, idpSession } from "../src/drizzle/index.js"
import { createIdp, type SessionRecord, type SessionStore } from "../src/index.js"
import { createCookieJar } from "./helpers/cookie-jar.js"
import { createStubIdp } from "./helpers/stub-idp.js"

/**
 * The drizzle adapter against a real SQLite database — D1 is SQLite, so this is
 * the production dialect. The schema is created once per process and each test
 * restores that image, the same trick apps/idp's harness uses.
 */
const DDL = `
  CREATE TABLE idp_session (
    id text PRIMARY KEY NOT NULL,
    sub text NOT NULL,
    email text NOT NULL,
    name text,
    image text,
    permissions text NOT NULL,
    workspaces text NOT NULL,
    actor text,
    access_token text NOT NULL,
    refresh_token text,
    id_token text,
    access_token_expires_at integer,
    synced_at integer NOT NULL,
    expires_at integer NOT NULL,
    created_at integer NOT NULL
  );
`

let snapshot: Buffer | null = null
function schemaSnapshot(): Buffer {
  if (snapshot) return snapshot
  const template = new Database(":memory:")
  template.exec(DDL)
  snapshot = template.serialize()
  template.close()
  return snapshot
}

const NOW = new Date("2026-06-01T00:00:00.000Z")

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "sess_1",
    sub: "user_1",
    email: "willy@willy.im",
    name: "Willy",
    image: null,
    permissions: ["admin"],
    workspaces: [{ id: "ws_1", slug: "acme", name: "Acme", domain: null, role: "owner" }],
    actor: null,
    accessToken: "at_1",
    refreshToken: "rt_1",
    idToken: "idtok_1",
    accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
    syncedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 604_800_000),
    createdAt: NOW,
    ...overrides,
  }
}

describe("drizzleSessions", () => {
  let store: SessionStore

  beforeEach(() => {
    const db = drizzle(new Database(schemaSnapshot()))
    store = drizzleSessions(db, idpSession)
  })

  it("round-trips a record through SQLite with its JSON and dates intact", async () => {
    await store.create(record())
    const row = await store.get("sess_1")

    expect(row).toMatchObject({
      id: "sess_1",
      sub: "user_1",
      email: "willy@willy.im",
      name: "Willy",
      image: null,
      permissions: ["admin"],
      accessToken: "at_1",
      actor: null,
    })
    expect(row?.workspaces[0]?.slug).toBe("acme")
    expect(row?.syncedAt).toBeInstanceOf(Date)
    expect(row?.syncedAt.toISOString()).toBe(NOW.toISOString())
    expect(row?.accessTokenExpiresAt?.getTime()).toBe(NOW.getTime() + 3_600_000)
  })

  it("returns null for an id that isn't there", async () => {
    expect(await store.get("nope")).toBeNull()
  })

  it("patches the claim projection without disturbing the tokens", async () => {
    await store.create(record())
    const synced = new Date(NOW.getTime() + 600_000)
    const updated = await store.update("sess_1", {
      permissions: ["invoices:read"],
      actor: { sub: "admin_1", email: "admin@willy.im" },
      syncedAt: synced,
    })

    expect(updated?.permissions).toEqual(["invoices:read"])
    expect(updated?.actor).toEqual({ sub: "admin_1", email: "admin@willy.im" })
    expect(updated?.syncedAt.toISOString()).toBe(synced.toISOString())
    expect(updated?.accessToken).toBe("at_1")
  })

  it("returns null when updating a row that's gone", async () => {
    expect(await store.update("nope", { permissions: [] })).toBeNull()
  })

  it("deletes one session", async () => {
    await store.create(record())
    await store.create(record({ id: "sess_2" }))
    await store.delete("sess_1")

    expect(await store.get("sess_1")).toBeNull()
    expect(await store.get("sess_2")).not.toBeNull()
  })

  it("deletes every session a subject holds, and only theirs", async () => {
    await store.create(record())
    await store.create(record({ id: "sess_2" }))
    await store.create(record({ id: "sess_3", sub: "user_2" }))

    await store.deleteBySub("user_1")

    expect(await store.get("sess_1")).toBeNull()
    expect(await store.get("sess_2")).toBeNull()
    expect(await store.get("sess_3")).not.toBeNull()
  })
})

describe("createIdp over drizzle", () => {
  it("logs in and reads the session back out of SQLite", async () => {
    const db = drizzle(new Database(schemaSnapshot()))
    const stub = createStubIdp()
    const jar = createCookieJar()
    const idp = createIdp({
      issuer: stub.issuer,
      clientId: stub.clientId,
      clientSecret: stub.clientSecret,
      fetch: stub.fetch,
      sessions: drizzleSessions(db, idpSession),
      session: { secret: "test-session-secret", secure: false },
    })

    const redirectUri = "https://app.test/auth/callback"
    const started = await idp.startLogin({ redirectUri })
    jar.absorb(started.headers)
    const done = await idp.completeLogin(jar.request(stub.authorize(started.url)), { redirectUri })
    jar.absorb(done.headers)

    const session = await idp.getSession(jar.request("https://app.test/"))
    expect(session?.sub).toBe("user_1")
    expect(session?.can("admin")).toBe(true)

    jar.absorb(await idp.destroySession(jar.request("https://app.test/")))
    expect(await idp.getSession(jar.request("https://app.test/"))).toBeNull()
  })
})
