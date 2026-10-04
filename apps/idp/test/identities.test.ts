import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { linkVerifiedIdentity } from "../app/lib/identities.server"
import { principalFrom, type IdpPrincipal } from "../app/lib/caller.server"
import type { AuthService } from "../app/lib/auth.server"
import {
  bearerRequest,
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  mintApiKey,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Linked identities: a user's ids on other systems, pinned by a superadmin and
 * resolved by an app. The thing worth pinning hardest is that the answer an
 * app gets carries the SAME permissions a browser session would — that is the
 * whole reason the mapping lives here and not in the app.
 */
describe("linked identities", () => {
  let h: TestHarness
  let root: IdpPrincipal
  let willy: { id: string; email: string }
  let gf: { id: string; email: string }

  const CATALOG = ["kirby:read", "kirby:write", "chat:respond", "tool:publish_artifact"]

  const sessionless = { api: { getSession: async () => null } } as unknown as AuthService

  /** A scoped `wim_` key for the bender app, resolved through the real resolver. */
  async function appKey(permissions: string[]) {
    const minted = await mintApiKey(h.ctx, { app: "bender", name: "bender-app", permissions }, root)
    const principal = await principalFrom(bearerRequest(minted.token), h.ctx, sessionless)
    if (!principal) throw new Error("resolve failed")
    return principal
  }

  /** The IdP-level identity methods, as `principal` (the admin key unless given). */
  const ids = async (principal: IdpPrincipal = root) =>
    (await kitContext(h.ctx, principal, null)).services.identities
  const linkIdentity = async (_: unknown, principal: IdpPrincipal, input: { userId: string; provider: string; externalId: string; label?: string }) =>
    (await ids(principal)).link(input)
  const listLinkedIdentities = async (_: unknown, principal: IdpPrincipal, input: { userId: string }) =>
    (await (await ids(principal)).list(input)).identities
  const unlinkIdentity = async (_: unknown, principal: IdpPrincipal, input: { userId: string; id: string }) =>
    (await ids(principal)).unlink(input)
  /** `identities.resolve` in `app`, as `principal`. */
  const resolveIdentity = async (
    _: unknown,
    principal: IdpPrincipal,
    { app, ...input }: { app: string; provider: string; externalId: string },
  ) => (await kitContext(h.ctx, principal, app)).services.identities.resolve(input)

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "bender", permissions: CATALOG })
    willy = await createUser(h.ctx, { email: "hey@willy.im", name: "Willy" })
    gf = await createUser(h.ctx, { email: "gf@example.com", name: "GF" })
    await createMember(h.ctx, { app: "bender", userId: willy.id, role: "admin" })
    await createMember(h.ctx, {
      app: "bender",
      userId: gf.id,
      role: "member",
      productPermissions: ["chat:respond", "tool:publish_artifact"],
    })
  })
  afterEach(() => h.close())

  describe("linking", () => {
    it("pins an external id to a user, normalising the provider", async () => {
      const res = await linkIdentity(h.ctx, root, {
        userId: willy.id,
        provider: " Slack ",
        externalId: "U0AAE7LAATD",
        label: "willy on the house workspace",
      })
      expect(res).toMatchObject({ created: true })

      const [linked] = await listLinkedIdentities(h.ctx, root, { userId: willy.id })
      expect(linked.provider).toBe("slack")
      expect(linked.externalId).toBe("U0AAE7LAATD")
      expect(linked.label).toBe("willy on the house workspace")
    })

    it("is idempotent for the same user", async () => {
      const a = await linkIdentity(h.ctx, root, { userId: willy.id, provider: "slack", externalId: "U1" })
      const b = await linkIdentity(h.ctx, root, { userId: willy.id, provider: "slack", externalId: "U1" })
      expect(a).toMatchObject({ created: true })
      expect(b).toMatchObject({ created: false, id: (a as { id: string }).id })
    })

    it("refuses to re-point an id that belongs to someone else", async () => {
      // Silently moving an identity is how one person starts receiving
      // another's grants. It has to be an explicit unlink first.
      await linkIdentity(h.ctx, root, { userId: willy.id, provider: "slack", externalId: "U1" })
      const res = linkIdentity(h.ctx, root, { userId: gf.id, provider: "slack", externalId: "U1" })
      expect(await failureOf(res)).toEqual({ status: 409, error: "slack:U1 is already linked to another user." })
    })

    it("refuses an unknown user", async () => {
      expect(
        await failureOf(linkIdentity(h.ctx, root, { userId: "nobody", provider: "slack", externalId: "U1" })),
      ).toEqual({ status: 404, error: "No user nobody." })
    })

    it("is superadmin-only — a member cannot link, even an admin of the app", async () => {
      const adminMember = memberPrincipal(willy.id, "bender", ["member:manage", "app:update"])
      const res = linkIdentity(h.ctx, adminMember, { userId: willy.id, provider: "slack", externalId: "U1" })
      expect((await failureOf(res)).status).toBe(403)
    })

    it("is superadmin-only — an app key cannot link either, whatever it holds", async () => {
      const key = await appKey(["identity:resolve", "member:manage", "app:update"])
      const res = linkIdentity(h.ctx, key, { userId: willy.id, provider: "slack", externalId: "U1" })
      expect((await failureOf(res)).status).toBe(403)
    })

    it("takes a user-proved link with no caller at all — the OAuth path", async () => {
      // linkVerifiedIdentity is what the account.create hook calls after a
      // Discord round trip. There is no superadmin in that request, and there
      // must not need to be: the provider already proved the claim.
      const res = await linkVerifiedIdentity(h.ctx, {
        userId: willy.id,
        provider: "discord",
        externalId: "582285987049373702",
        label: "discord (self-linked)",
      })
      expect(res).toMatchObject({ created: true })

      const [linked] = await listLinkedIdentities(h.ctx, root, { userId: willy.id })
      expect(linked.provider).toBe("discord")
      expect(linked.externalId).toBe("582285987049373702")
    })

    it("a proved link still cannot steal an id that is already someone else's", async () => {
      // The whole point of the exception is "the provider vouched for you", not
      // "you may take this from whoever holds it". Proving control of a Discord
      // account that an admin already pinned to another user is exactly the
      // case where moving it silently would hand over their grants.
      await linkIdentity(h.ctx, root, { userId: willy.id, provider: "discord", externalId: "D1" })
      const res = await linkVerifiedIdentity(h.ctx, {
        userId: gf.id,
        provider: "discord",
        externalId: "D1",
      })
      expect(res).toEqual({ error: "already_linked", toUserId: willy.id })
    })

    it("a proved link is idempotent — re-running the OAuth flow changes nothing", async () => {
      const a = await linkVerifiedIdentity(h.ctx, { userId: willy.id, provider: "discord", externalId: "D1" })
      const b = await linkVerifiedIdentity(h.ctx, { userId: willy.id, provider: "discord", externalId: "D1" })
      expect(a).toMatchObject({ created: true })
      expect(b).toMatchObject({ created: false, id: (a as { id: string }).id })
      expect(await listLinkedIdentities(h.ctx, root, { userId: willy.id })).toHaveLength(1)
    })

    it("a proved link for an unknown user is refused, not an orphan row", async () => {
      expect(
        await linkVerifiedIdentity(h.ctx, { userId: "nobody", provider: "discord", externalId: "D1" }),
      ).toEqual({ error: "unknown_user" })
    })

    it("unlinks idempotently, scoped to the user", async () => {
      const res = await linkIdentity(h.ctx, root, { userId: willy.id, provider: "slack", externalId: "U1" })
      const id = (res as { id: string }).id
      // The wrong user cannot unlink it by id alone.
      await unlinkIdentity(h.ctx, root, { userId: gf.id, id })
      expect(await listLinkedIdentities(h.ctx, root, { userId: willy.id })).toHaveLength(1)
      await unlinkIdentity(h.ctx, root, { userId: willy.id, id })
      expect(await listLinkedIdentities(h.ctx, root, { userId: willy.id })).toHaveLength(0)
      await unlinkIdentity(h.ctx, root, { userId: willy.id, id })
    })
  })

  describe("resolving", () => {
    beforeEach(async () => {
      await linkIdentity(h.ctx, root, { userId: willy.id, provider: "slack", externalId: "U_WILLY" })
      await linkIdentity(h.ctx, root, { userId: gf.id, provider: "slack", externalId: "U_GF" })
    })

    it("an admin member resolves with the whole catalog — same as their session would", async () => {
      const key = await appKey(["identity:resolve"])
      const res = await resolveIdentity(h.ctx, key, { app: "bender", provider: "slack", externalId: "U_WILLY" })
      expect(res).toEqual({
        found: true,
        userId: willy.id,
        email: "hey@willy.im",
        name: "Willy",
        permissions: CATALOG,
      })
    })

    it("a plain member resolves with exactly their product grants", async () => {
      const key = await appKey(["identity:resolve"])
      const res = await resolveIdentity(h.ctx, key, { app: "bender", provider: "slack", externalId: "U_GF" })
      expect(res).toMatchObject({ found: true, userId: gf.id, permissions: ["chat:respond", "tool:publish_artifact"] })
    })

    it("a linked user with no membership in the asking app is found with NO permissions", async () => {
      // They exist; this app just never granted them anything. That is the
      // "store the message, do not answer it" signal, not a miss.
      await createApplication(h.ctx, { app: "other", permissions: ["x:read"] })
      const other = await mintApiKey(h.ctx, { app: "other", name: "k", permissions: ["identity:resolve"] }, root)
      const caller = (await principalFrom(bearerRequest(other.token), h.ctx, sessionless))!
      const res = await resolveIdentity(h.ctx, caller, { app: "other", provider: "slack", externalId: "U_WILLY" })
      expect(res).toMatchObject({ found: true, userId: willy.id, permissions: [] })
    })

    it("an unknown id is a miss, not an error", async () => {
      const key = await appKey(["identity:resolve"])
      expect(
        await resolveIdentity(h.ctx, key, { app: "bender", provider: "slack", externalId: "U_NOBODY" }),
      ).toEqual({ found: false })
    })

    it("the provider is case-insensitive and the id is exact", async () => {
      const key = await appKey(["identity:resolve"])
      expect(
        (await resolveIdentity(h.ctx, key, { app: "bender", provider: "SLACK", externalId: "U_WILLY" })).found,
      ).toBe(true)
      expect(
        (await resolveIdentity(h.ctx, key, { app: "bender", provider: "slack", externalId: "u_willy" })).found,
      ).toBe(false)
    })

    it("needs identity:resolve — a key without it is refused, so ids cannot be probed", async () => {
      const key = await appKey(["userkey:validate", "member:read"])
      const res = resolveIdentity(h.ctx, key, { app: "bender", provider: "slack", externalId: "U_WILLY" })
      expect((await failureOf(res)).status).toBe(403)
    })

    it("a key for one app cannot resolve against another", async () => {
      await createApplication(h.ctx, { app: "other", permissions: [] })
      const key = await appKey(["identity:resolve"]) // bound to bender
      // Another app is a tenant this key holds nothing in: a 404, so apps don't leak.
      const res = resolveIdentity(h.ctx, key, { app: "other", provider: "slack", externalId: "U_WILLY" })
      expect((await failureOf(res)).status).toBe(404)
    })
  })
})
