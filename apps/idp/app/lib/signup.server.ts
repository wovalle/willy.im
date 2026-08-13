import { and, eq, gt } from "drizzle-orm"

import * as schema from "../db/schema"
import { parseAppMetadata } from "./metadata"
import { normalizeEmail } from "./members.server"
import type { BaseServiceContext } from "./services"

/**
 * `allow_signup` enforcement.
 *
 * SEMANTICS (worth reading before changing anything here):
 *
 * The IdP has ONE global user store, but `allow_signup` is per-application. So
 * the gate is: *may this sign-in create a new willy.im account, given the app it
 * is happening in?* Concretely —
 *
 *   - The gate only fires when the sign-in carries app context, i.e. it is part
 *     of an OIDC authorization for a registered client. Signing in directly at
 *     the IdP's own console has no app context and is not gated; a console-only
 *     account grants nothing on its own (access is membership-derived).
 *   - It only fires for a NEW account. An existing willy.im user signing in to an
 *     invite-only app is NOT rejected: `allow_signup` gates account creation, not
 *     app access. Whether they can *do* anything in that app is decided by
 *     application_member (and the product-permission claims) — an outsider gets a
 *     session with no workspaces and no permissions.
 *   - `allow_signup: false` still lets an invited email through: a pending
 *     application_invitation for (app, email) is an explicit grant of entry, and
 *     it converts to membership on that first session anyway. An existing
 *     application_member row counts too, for the case where a member's user row
 *     was deleted and they are signing back in.
 *
 * A rejected sign-in throws before the user row is written, so no orphan account
 * is left behind.
 */

/** Why a sign-up was allowed or refused. `reason` is for logs, not for users. */
export type SignupDecision =
  | { allowed: true; reason: "no-app-context" | "open-signup" | "invited" | "existing-member" }
  | { allowed: false; app: string }

/** The message an unknown email sees on an invite-only app. */
export const SIGNUP_NOT_ALLOWED_MESSAGE =
  "This app is invite-only. Ask an administrator to invite your email address, then try again."

/**
 * The `client_id` a sign-in request belongs to, or null when it has none.
 *
 * The oauth-provider client plugin replays the signed authorization query on the
 * sign-in request as an `oauth_query` body field; that is the authoritative
 * source. We also accept a plain `client_id` on the body or the request URL so
 * the gate holds for non-browser callers.
 */
export function clientIdFromSignInRequest(input: {
  body?: unknown
  query?: unknown
  url?: string | null
}): string | null {
  const body = (input.body ?? {}) as Record<string, unknown>

  const oauthQuery = body.oauth_query
  if (typeof oauthQuery === "string") {
    const clientId = new URLSearchParams(oauthQuery).get("client_id")
    if (clientId) return clientId
  }

  if (typeof body.client_id === "string" && body.client_id) return body.client_id

  const query = (input.query ?? {}) as Record<string, unknown>
  if (typeof query.client_id === "string" && query.client_id) return query.client_id

  if (input.url) {
    const clientId = new URL(input.url).searchParams.get("client_id")
    if (clientId) return clientId
  }

  return null
}

/** Is there a live invitation for this email on this app? */
async function hasPendingInvitation(ctx: BaseServiceContext, app: string, email: string) {
  const [invitation] = await ctx.db
    .select({ id: schema.applicationInvitation.id })
    .from(schema.applicationInvitation)
    .where(
      and(
        eq(schema.applicationInvitation.applicationId, app),
        eq(schema.applicationInvitation.email, email),
        gt(schema.applicationInvitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return !!invitation
}

/** Is this email already a member of this app (via a still-existing user row)? */
async function hasExistingMembership(ctx: BaseServiceContext, app: string, email: string) {
  const [member] = await ctx.db
    .select({ id: schema.applicationMember.id })
    .from(schema.applicationMember)
    .innerJoin(schema.user, eq(schema.applicationMember.userId, schema.user.id))
    .where(and(eq(schema.applicationMember.applicationId, app), eq(schema.user.email, email)))
    .limit(1)
  return !!member
}

/**
 * May `email` get a brand-new willy.im account while signing in to the app that
 * owns `clientId`? See the semantics note at the top of this file.
 */
export async function decideSignup(
  ctx: BaseServiceContext,
  input: { clientId: string | null; email: string },
): Promise<SignupDecision> {
  if (!input.clientId) return { allowed: true, reason: "no-app-context" }

  const [client] = await ctx.db
    .select({ metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, input.clientId))
    .limit(1)
  // An unrecognized client_id never reaches a real authorization, so there is no
  // app to gate on.
  if (!client) return { allowed: true, reason: "no-app-context" }

  const meta = parseAppMetadata(client.metadata)
  if (!meta.app) return { allowed: true, reason: "no-app-context" }
  if (meta.allow_signup) return { allowed: true, reason: "open-signup" }

  const email = normalizeEmail(input.email)
  if (await hasPendingInvitation(ctx, meta.app, email)) return { allowed: true, reason: "invited" }
  if (await hasExistingMembership(ctx, meta.app, email))
    return { allowed: true, reason: "existing-member" }

  return { allowed: false, app: meta.app }
}
