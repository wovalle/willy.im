import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { addOrInviteAppMember } from "../app/lib/members.server"
import { clientIdFromSignInRequest, decideSignup } from "../app/lib/signup.server"
import { createApplication, createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/** How the app context is recovered from a sign-in request. */
describe("clientIdFromSignInRequest", () => {
  it("reads the client_id out of the replayed authorization query", () => {
    const oauthQuery = new URLSearchParams({
      client_id: "client_acme",
      redirect_uri: "https://acme.test/callback",
      sig: "whatever",
    }).toString()

    expect(clientIdFromSignInRequest({ body: { email: "a@b.test", oauth_query: oauthQuery } })).toBe(
      "client_acme",
    )
  })

  it("accepts a plain client_id on the body or the query", () => {
    expect(clientIdFromSignInRequest({ body: { client_id: "client_acme" } })).toBe("client_acme")
    expect(clientIdFromSignInRequest({ query: { client_id: "client_acme" } })).toBe("client_acme")
  })

  it("falls back to the request URL", () => {
    expect(
      clientIdFromSignInRequest({ url: "https://idp.willy.im/auth/sign-in?client_id=client_acme" }),
    ).toBe("client_acme")
  })

  it("returns null when the sign-in has no app context", () => {
    expect(clientIdFromSignInRequest({ body: { email: "a@b.test" } })).toBeNull()
    expect(clientIdFromSignInRequest({})).toBeNull()
  })
})

/**
 * `allow_signup` is the gate the first consumer app depends on: an invite-only
 * app must not hand an account to any passing email address.
 */
describe("decideSignup", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  it("allows an open app to create an account for anyone", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "open", allowSignup: true })

    expect(await decideSignup(h.ctx, { clientId, email: "anyone@internet.test" })).toEqual({
      allowed: true,
      reason: "open-signup",
    })
  })

  it("rejects an unknown email on an invite-only app", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })

    expect(await decideSignup(h.ctx, { clientId, email: "anyone@internet.test" })).toEqual({
      allowed: false,
      app: "closed",
    })
  })

  it("lets an invited email through on an invite-only app", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })
    const inviter = await createUser(h.ctx, { email: "boss@closed.test" })
    await addOrInviteAppMember(h.ctx, {
      app: "closed",
      email: "guest@internet.test",
      role: "member",
      permissions: [],
      invitedByUserId: inviter.id,
      origin: "https://idp.willy.im",
    })

    expect(await decideSignup(h.ctx, { clientId, email: "guest@internet.test" })).toEqual({
      allowed: true,
      reason: "invited",
    })
  })

  it("matches the invitation regardless of email casing or padding", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })
    const inviter = await createUser(h.ctx, { email: "boss@closed.test" })
    await addOrInviteAppMember(h.ctx, {
      app: "closed",
      email: "guest@internet.test",
      role: "member",
      permissions: [],
      invitedByUserId: inviter.id,
      origin: "https://idp.willy.im",
    })

    expect(await decideSignup(h.ctx, { clientId, email: " Guest@Internet.TEST " })).toEqual({
      allowed: true,
      reason: "invited",
    })
  })

  it("does not honor an expired invitation", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })
    const inviter = await createUser(h.ctx, { email: "boss@closed.test" })
    await addOrInviteAppMember(h.ctx, {
      app: "closed",
      email: "guest@internet.test",
      role: "member",
      permissions: [],
      invitedByUserId: inviter.id,
      origin: "https://idp.willy.im",
    })
    const { applicationInvitation } = await import("../app/db/schema")
    await h.ctx.db
      .update(applicationInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })

    expect(await decideSignup(h.ctx, { clientId, email: "guest@internet.test" })).toEqual({
      allowed: false,
      app: "closed",
    })
  })

  it("does not honor an invitation issued by a different app", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })
    await createApplication(h.ctx, { app: "open", allowSignup: true })
    const inviter = await createUser(h.ctx, { email: "boss@open.test" })
    await addOrInviteAppMember(h.ctx, {
      app: "open",
      email: "guest@internet.test",
      role: "member",
      permissions: [],
      invitedByUserId: inviter.id,
      origin: "https://idp.willy.im",
    })

    expect(await decideSignup(h.ctx, { clientId, email: "guest@internet.test" })).toEqual({
      allowed: false,
      app: "closed",
    })
  })

  it("lets an existing member back in on an invite-only app", async () => {
    const { clientId } = await createApplication(h.ctx, { app: "closed", allowSignup: false })
    const member = await createUser(h.ctx, { email: "member@closed.test" })
    await createMember(h.ctx, { app: "closed", userId: member.id, role: "member" })

    expect(await decideSignup(h.ctx, { clientId, email: "member@closed.test" })).toEqual({
      allowed: true,
      reason: "existing-member",
    })
  })

  it("does not gate a sign-in with no app context (the IdP console itself)", async () => {
    await createApplication(h.ctx, { app: "closed", allowSignup: false })

    expect(await decideSignup(h.ctx, { clientId: null, email: "anyone@internet.test" })).toEqual({
      allowed: true,
      reason: "no-app-context",
    })
  })

  it("does not gate an unregistered client_id", async () => {
    expect(
      await decideSignup(h.ctx, { clientId: "client_ghost", email: "anyone@internet.test" }),
    ).toEqual({ allowed: true, reason: "no-app-context" })
  })

  it("does not gate a client with no app tag", async () => {
    // A client registered through better-auth before the app tag is applied.
    const { oauthClient } = await import("../app/db/schema")
    await h.ctx.db.insert(oauthClient).values({
      id: "oc_untagged",
      clientId: "client_untagged",
      name: "untagged",
      redirectUris: ["https://untagged.test/callback"],
      metadata: { allow_signup: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(
      await decideSignup(h.ctx, { clientId: "client_untagged", email: "anyone@internet.test" }),
    ).toEqual({ allowed: true, reason: "no-app-context" })
  })

  it("survives double-encoded metadata from the json column", async () => {
    const { oauthClient } = await import("../app/db/schema")
    await h.ctx.db.insert(oauthClient).values({
      id: "oc_encoded",
      clientId: "client_encoded",
      name: "encoded",
      redirectUris: ["https://encoded.test/callback"],
      metadata: JSON.stringify({ app: "closed", allow_signup: false, permissions: [] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(
      await decideSignup(h.ctx, { clientId: "client_encoded", email: "anyone@internet.test" }),
    ).toEqual({ allowed: false, app: "closed" })
  })
})
