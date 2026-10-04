import { declareService, fail, method } from "@willyim/kit"
import { lt } from "drizzle-orm"

import * as schema from "../db/schema"
import { catalogOf, getApplicationByApp } from "../lib/admin.server"
import { generateToken, hashToken } from "../lib/api-keys.server"
import { APP_TOKEN_PREFIX } from "../lib/app-tokens.server"
import { requireScopes } from "../lib/scopes.server"
import { io } from "./io"

/**
 * App tokens — GitHub-App-style installation tokens. An IdP admin key is the
 * private key and never goes to an app: a superadmin exchanges their authority
 * here for a `wat_` token bound to one app, living an hour at most. The app
 * validates it like an end-user key (`user_keys.validate` answers
 * `kind: "app"`) and treats it as the issuer acting in the app.
 */

const DISPLAY_PREFIX_LEN = APP_TOKEN_PREFIX.length + 8
const isWildcard = (scope: string) => scope.trim() === "*"

export const app_tokens = declareService((ctx) => ({
  mint: method(
    {
      summary: "Mint a short-lived token for the app's own API, acting as you (returned once)",
      description:
        "Superadmin only: the token carries the caller's own authority inside the app, so no permission an app could hand out may mint one. `scopes` default to `[\"*\"]`; given ones resolve like end-user key scopes (422 names a miss, 502 when the app's list could not be read). `expiresIn` is seconds, 60 to 3600 (the default). The token stops validating once its issuer loses superadmin.",
      permission: "*",
      ...io("app_tokens.mint"),
    },
    async (input) => {
      const application = await getApplicationByApp(ctx, ctx.app)
      if (!application) fail(404, `No application ${ctx.app}.`)

      const requested = input.scopes ?? ["*"]
      const resolved = await requireScopes(
        requested.filter((s) => !isWildcard(s)),
        ctx.app,
        catalogOf(application),
        ctx.resources,
      )
      const scopes = requested.some(isWildcard) ? ["*", ...resolved] : resolved

      const token = generateToken(APP_TOKEN_PREFIX)
      const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
      const id = crypto.randomUUID()
      const workspaceId = input.workspaceId ?? null
      const expiresAt = new Date(Date.now() + input.expiresIn * 1000)
      await ctx.db.insert(schema.appToken).values({
        id,
        applicationId: ctx.app,
        prefix,
        keyHash: await hashToken(token),
        scopes,
        workspaceId,
        // A superadmin is an admin key or an allowlisted human: exactly one is set.
        issuedByKeyId: ctx.keyId,
        issuedByUserId: ctx.userId,
        expiresAt,
      })

      // Housekeeping: a token a day past its expiry can't matter to anyone (the
      // audit row of its issue stays). Best effort; minting never fails on it.
      await ctx.db
        .delete(schema.appToken)
        .where(lt(schema.appToken.expiresAt, new Date(Date.now() - 86_400_000)))
        .catch((err) =>
          ctx.logger.warn("apptoken.prune_failed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      await ctx.audit.record({
        table: "app_token",
        operation: "issue",
        rowId: id,
        after: { scopes, workspaceId, expiresAt: expiresAt.toISOString() },
      })
      return { id, token, prefix, scopes, workspaceId, expiresAt: expiresAt.toISOString() }
    },
  ),
}))
