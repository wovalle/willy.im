export type PermissionChecker<P extends string> = {
  has(permission: P): boolean
  require(permission: P): void
  granted: P[]
}

export type DefinePermissionsConfig<
  P extends readonly string[],
  R extends Record<string, readonly NoInfer<P[number]>[]>,
> = { permissions: P; roles: R }

export type PermissionsResult<
  P extends readonly string[],
  R extends Record<string, readonly P[number][]>,
> = {
  createChecker(role: keyof R & string): PermissionChecker<P[number]>
  permissions: P
  roles: R
}

export function definePermissions<
  const P extends readonly string[],
  const R extends Record<string, readonly NoInfer<P[number]>[]>,
>(config: DefinePermissionsConfig<P, R>): PermissionsResult<P, R> {
  type Permission = P[number]
  type Role = keyof R & string

  function createChecker(role: Role): PermissionChecker<Permission> {
    const rolePerms = config.roles[role] as readonly string[]
    const grantedSet = new Set(rolePerms)

    return {
      has: (p) => grantedSet.has(p),
      require: (p) => {
        if (!grantedSet.has(p)) {
          throw new Response("Forbidden", { status: 403 })
        }
      },
      granted: [...rolePerms] as Permission[],
    }
  }

  return {
    createChecker,
    permissions: config.permissions,
    roles: config.roles,
  } as PermissionsResult<P, R>
}
