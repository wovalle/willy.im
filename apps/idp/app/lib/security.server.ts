import { and, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { isAdminEmail } from "./admin.server"
import type { AuthService, User } from "./auth.server"
import { APP_PERMISSIONS, resolvePermissions, type AppPermission, type AppRole } from "./permissions"
import type { BaseServiceContext } from "./services"

/**
 * What the current principal may do to a given application. Superadmins
 * (IdP-level) and app admins get every permission; members get their grants.
 */
export type AppAccess = {
  user: User
  isSuperadmin: boolean
  role: AppRole | null
  permissions: AppPermission[]
  can: (permission: AppPermission) => boolean
}

/**
 * Resolves access for `app` from the request's session. Returns null if not
 * signed in. role=null + empty permissions means "signed in but no access".
 */
export async function getAppAccess(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
  app: string,
): Promise<AppAccess | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const user = session.user as User

  if (isAdminEmail(ctx, user.email)) {
    return { user, isSuperadmin: true, role: "admin", permissions: [...APP_PERMISSIONS], can: () => true }
  }

  const [member] = await ctx.db
    .select({ role: schema.applicationMember.role, permissions: schema.applicationMember.permissions })
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, app),
        eq(schema.applicationMember.userId, user.id),
      ),
    )
    .limit(1)

  if (!member) {
    return { user, isSuperadmin: false, role: null, permissions: [], can: () => false }
  }

  const permissions = resolvePermissions(member.role, member.permissions ?? [])
  return {
    user,
    isSuperadmin: false,
    role: member.role,
    permissions,
    can: (p) => permissions.includes(p),
  }
}
