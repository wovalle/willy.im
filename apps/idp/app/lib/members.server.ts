import { and, eq } from "drizzle-orm"
import { Resend } from "resend"

import * as schema from "../db/schema"
import { APP_PERMISSIONS, type AppPermission, type AppRole } from "./permissions"
import type { BaseServiceContext } from "./services"

/** Invites stay valid for 7 days. */
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7

/** Normalize an email for storage and matching (the invite↔user join key). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Keep only catalog permissions; admins ignore this (they resolve to all). */
function sanitizePermissions(role: AppRole, permissions: string[]): AppPermission[] {
  if (role === "admin") return []
  return permissions.filter((p): p is AppPermission =>
    (APP_PERMISSIONS as readonly string[]).includes(p),
  )
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

/** Number of admins for an app — the last-admin guard reads this. */
async function countAppAdmins(ctx: BaseServiceContext, app: string): Promise<number> {
  const rows = await ctx.db
    .select({ userId: schema.applicationMember.userId })
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, app),
        eq(schema.applicationMember.role, "admin"),
      ),
    )
  return rows.length
}

export type InviteResult =
  | { kind: "added" } // existing user, joined immediately
  | { kind: "invited" } // pending invite created + emailed
  | { kind: "already-member" }

/**
 * Option A (hybrid): if the email belongs to an existing willy.im user, add them
 * to application_member immediately (silent, no email). Otherwise create a
 * pending invitation and email a branded accept link.
 */
export async function addOrInviteAppMember(
  ctx: BaseServiceContext,
  args: {
    app: string
    email: string
    role: AppRole
    permissions: string[]
    // Null for machine callers (a scoped API key / superadmin token has no user).
    invitedByUserId: string | null
    origin: string
  },
): Promise<InviteResult> {
  const email = normalizeEmail(args.email)
  const permissions = sanitizePermissions(args.role, args.permissions)

  const existing = await resolveUserByEmail(ctx, email)
  if (existing) {
    const [already] = await ctx.db
      .select({ id: schema.applicationMember.id })
      .from(schema.applicationMember)
      .where(
        and(
          eq(schema.applicationMember.applicationId, args.app),
          eq(schema.applicationMember.userId, existing.id),
        ),
      )
      .limit(1)
    if (already) return { kind: "already-member" }

    await ctx.db.insert(schema.applicationMember).values({
      applicationId: args.app,
      userId: existing.id,
      role: args.role,
      permissions,
    })
    return { kind: "added" }
  }

  // No account yet — upsert a pending invitation and (re)send the link.
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await ctx.db
    .insert(schema.applicationInvitation)
    .values({
      applicationId: args.app,
      email,
      role: args.role,
      permissions,
      token,
      invitedByUserId: args.invitedByUserId,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.applicationInvitation.applicationId,
        schema.applicationInvitation.email,
      ],
      set: { role: args.role, permissions, token, expiresAt },
    })

  await sendInviteEmail(ctx, { origin: args.origin, email, token, app: args.app, role: args.role })
  return { kind: "invited" }
}

/** Update an existing member's role + permissions. Guards the last admin. */
export async function updateAppMember(
  ctx: BaseServiceContext,
  args: { app: string; userId: string; role: AppRole; permissions: string[] },
): Promise<{ ok: true } | { error: string }> {
  const [current] = await ctx.db
    .select({ role: schema.applicationMember.role })
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, args.app),
        eq(schema.applicationMember.userId, args.userId),
      ),
    )
    .limit(1)
  if (!current) return { error: "Member not found." }

  if (current.role === "admin" && args.role !== "admin") {
    if ((await countAppAdmins(ctx, args.app)) <= 1)
      return { error: "Can't demote the last admin — promote someone else first." }
  }

  await ctx.db
    .update(schema.applicationMember)
    .set({ role: args.role, permissions: sanitizePermissions(args.role, args.permissions) })
    .where(
      and(
        eq(schema.applicationMember.applicationId, args.app),
        eq(schema.applicationMember.userId, args.userId),
      ),
    )
  return { ok: true }
}

/** Remove a member. Guards the last admin. */
export async function removeAppMember(
  ctx: BaseServiceContext,
  args: { app: string; userId: string },
): Promise<{ ok: true } | { error: string }> {
  const [current] = await ctx.db
    .select({ role: schema.applicationMember.role })
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, args.app),
        eq(schema.applicationMember.userId, args.userId),
      ),
    )
    .limit(1)
  if (!current) return { error: "Member not found." }

  if (current.role === "admin" && (await countAppAdmins(ctx, args.app)) <= 1)
    return { error: "Can't remove the last admin — promote someone else first." }

  await ctx.db
    .delete(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, args.app),
        eq(schema.applicationMember.userId, args.userId),
      ),
    )
  return { ok: true }
}

/** Pending invitations for an app, newest first. */
export async function listAppInvitations(ctx: BaseServiceContext, app: string) {
  return ctx.db
    .select({
      id: schema.applicationInvitation.id,
      email: schema.applicationInvitation.email,
      role: schema.applicationInvitation.role,
      permissions: schema.applicationInvitation.permissions,
      expiresAt: schema.applicationInvitation.expiresAt,
      createdAt: schema.applicationInvitation.createdAt,
    })
    .from(schema.applicationInvitation)
    .where(eq(schema.applicationInvitation.applicationId, app))
}

export async function revokeInvitation(
  ctx: BaseServiceContext,
  args: { app: string; invitationId: string },
) {
  await ctx.db
    .delete(schema.applicationInvitation)
    .where(
      and(
        eq(schema.applicationInvitation.applicationId, args.app),
        eq(schema.applicationInvitation.id, args.invitationId),
      ),
    )
}

/** Refresh an invite's expiry and re-send the link. */
export async function resendInvitation(
  ctx: BaseServiceContext,
  args: { app: string; invitationId: string; origin: string },
): Promise<{ ok: true } | { error: string }> {
  const [inv] = await ctx.db
    .select()
    .from(schema.applicationInvitation)
    .where(
      and(
        eq(schema.applicationInvitation.applicationId, args.app),
        eq(schema.applicationInvitation.id, args.invitationId),
      ),
    )
    .limit(1)
  if (!inv) return { error: "Invitation not found." }

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await ctx.db
    .update(schema.applicationInvitation)
    .set({ expiresAt })
    .where(eq(schema.applicationInvitation.id, inv.id))

  await sendInviteEmail(ctx, {
    origin: args.origin,
    email: inv.email,
    token: inv.token,
    app: inv.applicationId,
    role: inv.role,
  })
  return { ok: true }
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

async function sendInviteEmail(
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
