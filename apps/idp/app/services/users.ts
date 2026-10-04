import { declareService, fail, method } from "@willyim/kit"
import { desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { avatarUrl } from "../lib/avatar"
import { io } from "./io"

/**
 * People: every willy.im user (IdP level, superadmin), and impersonating one
 * of an app's members from the console.
 */

const userColumns = {
  id: schema.user.id,
  email: schema.user.email,
  name: schema.user.name,
  image: schema.user.image,
  emailVerified: schema.user.emailVerified,
  createdAt: schema.user.createdAt,
}

export const users = declareService((ctx) => {
  /**
   * A user on the wire. `image` is filled in the way the `picture` claim does,
   * absolute because the reader is on another origin: a consumer gets an avatar
   * it can render without knowing this IdP has an avatar route at all.
   */
  const toUser = (u: { id: string; email: string; name: string | null; image: string | null; emailVerified: boolean; createdAt: Date }) => ({
    ...u,
    image: u.image || avatarUrl(ctx.origin, u.id),
    createdAt: u.createdAt.toISOString(),
  })

  return {
    list: method(
      {
        summary: "List every willy.im user, newest first",
        permission: "*",
        hints: { readOnly: true },
        ...io("users.list"),
      },
      async () => {
        const rows = await ctx.db.select(userColumns).from(schema.user).orderBy(desc(schema.user.createdAt))
        return { users: rows.map(toUser) }
      },
    ),

    find: method(
      {
        summary: "Find one user by id or by email (null when there is none)",
        permission: "*",
        hints: { readOnly: true },
        ...io("users.find"),
      },
      async ({ id, email }) => {
        const [row] = await ctx.db
          .select(userColumns)
          .from(schema.user)
          .where(id ? eq(schema.user.id, id) : eq(schema.user.email, email!.toLowerCase()))
          .limit(1)
        return { user: row ? toUser(row) : null }
      },
    ),

    impersonate: method(
      {
        summary: "Sign in as one of the app's members, from your own console session",
        description:
          "Superadmin only (`user:impersonate` alone is not enough: Better Auth's admin role is superadmin-only), and only a signed-in human can: it needs the admin's own Better Auth session. The target must be a member of this app, which is what makes the act app-bound. Answers the impersonation session's cookies for the admin's browser.",
        permission: "*",
        // A key has no browser session to impersonate from.
        when: (c) => c.tenantId !== null && c.userId !== null,
        input: io("users.impersonate").input,
        output: io("users.impersonate").output,
      },
      async ({ userId }) => {
        const { members } = await ctx.services.members.list()
        const target = members.find((m) => m.userId === userId)
        if (!target) fail(404, "That user isn't a member of this app.")
        const res = await ctx.betterAuth.api.impersonateUser({
          body: { userId },
          headers: ctx.headers,
          asResponse: true,
        })
        await ctx.audit.record({
          table: "user",
          operation: "impersonate",
          rowId: userId,
          after: { email: target.email },
        })
        return { setCookies: res.headers.getSetCookie() }
      },
    ),
  }
})
