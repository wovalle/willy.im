import { eq } from "drizzle-orm"
import { Resend } from "resend"

import * as schema from "../db/schema"
import type { BaseServiceContext } from "./services"

/** Normalize an email for storage and matching (the invite↔user join key). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Look up a user by (normalized) email, or null. */
export async function resolveUserByEmail(ctx: BaseServiceContext, email: string) {
  const [u] = await ctx.db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.email, normalizeEmail(email)))
    .limit(1)
  return u ?? null
}

/** Look up an invitation by its accept-link token (for the branded landing). */
export async function getInvitationByToken(ctx: BaseServiceContext, token: string) {
  const [inv] = await ctx.db
    .select()
    .from(schema.applicationInvitation)
    .where(eq(schema.applicationInvitation.token, token))
    .limit(1)
  return inv ?? null
}

/**
 * The canonical INVITED → MEMBER conversion. Called on every new session: any
 * pending invitation whose email matches the (verified) signed-in user becomes
 * an application_member, and the invitation row is deleted. Idempotent.
 */
export async function claimInvitationsForUser(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
): Promise<void> {
  const email = normalizeEmail(user.email)
  const invites = await ctx.db
    .select()
    .from(schema.applicationInvitation)
    .where(eq(schema.applicationInvitation.email, email))
  if (invites.length === 0) return

  const now = Date.now()
  for (const inv of invites) {
    // Expired invites are dropped, not honored.
    if (inv.expiresAt.getTime() < now) {
      await ctx.db
        .delete(schema.applicationInvitation)
        .where(eq(schema.applicationInvitation.id, inv.id))
      continue
    }
    await ctx.db
      .insert(schema.applicationMember)
      .values({
        applicationId: inv.applicationId,
        userId: user.id,
        role: inv.role,
        permissions: inv.permissions ?? [],
        productPermissions: inv.productPermissions ?? [],
      })
      .onConflictDoNothing()
    await ctx.db
      .delete(schema.applicationInvitation)
      .where(eq(schema.applicationInvitation.id, inv.id))
  }
  ctx.logger.info("invites.claimed", { userId: user.id, count: invites.length })
}

function renderInviteEmail(baseUrl: string, app: string, role: string, token: string) {
  const link = `${baseUrl}/invite/accept?token=${encodeURIComponent(token)}`
  return {
    subject: `You've been invited to ${app} on willy.im`,
    html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:0 auto;padding:1.5rem;color:#0a0a0a;">
      <p>You've been invited to <strong>${app}</strong> as <strong>${role}</strong>.</p>
      <p>Click to accept and sign in to willy.im:</p>
      <p><a href="${link}" style="display:inline-block;background:#0a0a0a;color:#fafafa;padding:12px 24px;text-decoration:none;border-radius:8px;margin:8px 0;">Accept invitation</a></p>
      <p style="color:#666;font-size:14px;">This invitation expires in 7 days. If you weren't expecting it, ignore this email.</p>
    </body></html>`,
  }
}

export async function sendInviteEmail(
  ctx: BaseServiceContext,
  args: { origin: string; email: string; token: string; app: string; role: string },
) {
  const env = ctx.getAppEnv()
  const { subject, html } = renderInviteEmail(args.origin, args.app, args.role, args.token)
  const link = `${args.origin}/invite/accept?token=${encodeURIComponent(args.token)}`

  if (env.APP_ENV !== "production" || !env.RESEND_TOKEN) {
    ctx.logger.info(`[invite] accept link for ${args.email}: ${link}`)
    return
  }

  const resend = new Resend(env.RESEND_TOKEN)
  await resend.emails.send({ from: env.EMAIL_FROM, to: args.email, subject, html })
}
