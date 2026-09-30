export type PermissionChecker<P extends string> = {
  has(permission: P): boolean
  require(permission: P): void
  granted: P[]
  isSuperadmin: boolean
}

export type CheckerOptions = {
  superadmin?: boolean
}

export type DefinePermissionsConfig<
  P extends readonly string[],
  R extends Record<string, readonly NoInfer<P[number]>[]>,
> = { permissions: P; roles: R }

export type PermissionsResult<
  P extends readonly string[],
  R extends Record<string, readonly P[number][]>,
> = {
  createChecker(role: keyof R & string, opts?: CheckerOptions): PermissionChecker<P[number]>
  checkerFor(grants: readonly string[]): PermissionChecker<P[number]>
  permissions: P
  roles: R
}

export function definePermissions<
  const P extends readonly string[],
  const R extends Record<string, readonly NoInfer<P[number]>[]>,
>(config: DefinePermissionsConfig<P, R>): PermissionsResult<P, R> {
  type Permission = P[number]
  type Role = keyof R & string

  function createChecker(role: Role, opts?: CheckerOptions): PermissionChecker<Permission> {
    const superadmin = opts?.superadmin ?? false
    const rolePerms = config.roles[role] as readonly string[]
    const grantedSet = new Set(rolePerms)

    return {
      has: (p) => superadmin || grantedSet.has(p),
      require: (p) => {
        if (!superadmin && !grantedSet.has(p)) {
          throw new Response("Forbidden", { status: 403 })
        }
      },
      granted: superadmin ? ([...config.permissions] as Permission[]) : ([...rolePerms] as Permission[]),
      isSuperadmin: superadmin,
    }
  }

  function checkerFor(grants: readonly string[]): PermissionChecker<Permission> {
    const exact = new Set(grants)
    const prefixes = grants.filter((g) => g.endsWith(":*")).map((g) => g.slice(0, -1))
    const grantedSet = new Set<string>(
      config.permissions.filter((p) => exact.has(p) || prefixes.some((prefix) => p.startsWith(prefix))),
    )

    return {
      has: (p) => grantedSet.has(p),
      require: (p) => {
        if (!grantedSet.has(p)) {
          throw new Response("Forbidden", { status: 403 })
        }
      },
      granted: [...grantedSet] as Permission[],
      isSuperadmin: false,
    }
  }

  return {
    createChecker,
    checkerFor,
    permissions: config.permissions,
    roles: config.roles,
  } as PermissionsResult<P, R>
}
