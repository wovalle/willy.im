/**
 * Permissions are the primitive; roles are named bags of them. A caller is a
 * `PermissionChecker`, built from a role (`createChecker`) or from raw grants
 * such as an API key's scopes (`checkerFor`).
 *
 * Grants `checkerFor` understands:
 *
 *   "clients:read"   that catalog permission
 *   "clients:*"      every catalog permission, and every instance, under `clients:`
 *   "*"              everything: a superadmin
 *   "thread:abc"     one instance of a declared resource (`resources: ["thread"]`)
 *
 * Anything else is dropped. Grants must come from a trusted source (the IdP,
 * your own key table): `"*"` makes a superadmin, so never let a user choose
 * their own scopes without rejecting it.
 */

export type PermissionChecker<P extends string, R extends string = never> = {
  has(permission: P): boolean
  require(permission: P): void
  /**
   * Does the caller hold any instance of `resource` (`"thread:abc"`), or a
   * wildcard covering them? What `permission: { resource }` checks; the method
   * body then checks the specific id with `has`.
   */
  hasAny?(resource: R): boolean
  granted: P[]
  isSuperadmin: boolean
}

export type CheckerOptions = {
  /** Grants every permission, whatever the role. Your app decides who is one. */
  superadmin?: boolean
}

/** `"<resource>:<id>"` for each declared resource. */
export type Instance<Res extends readonly string[]> = `${Res[number]}:${string}`

export type DefinePermissionsConfig<
  P extends readonly string[],
  R extends Record<string, readonly NoInfer<P[number]>[]>,
  Res extends readonly string[],
> = {
  permissions: P
  roles: R
  /** Resource types whose instances can be granted one by one: `"thread:abc"`. */
  resources?: Res
}

export type PermissionsResult<
  P extends readonly string[],
  R extends Record<string, readonly P[number][]>,
  Res extends readonly string[],
> = {
  createChecker(
    role: keyof R & string,
    opts?: CheckerOptions,
  ): PermissionChecker<P[number] | Instance<Res>, Res[number]>
  checkerFor(grants: readonly string[]): PermissionChecker<P[number] | Instance<Res>, Res[number]>
  permissions: P
  roles: R
  resources: Res
}

const forbidden = () => new Response("Forbidden", { status: 403 })

function checker<P extends string, R extends string>(
  has: (p: string) => boolean,
  hasAny: (resource: string) => boolean,
  granted: string[],
  isSuperadmin: boolean,
): PermissionChecker<P, R> {
  return {
    has,
    require: (p) => {
      if (!has(p)) throw forbidden()
    },
    hasAny,
    granted: granted as P[],
    isSuperadmin,
  }
}

/** The `"x:"` prefix of a `"x:*"` wildcard, or null for anything else. */
const wildcardPrefix = (grant: string) =>
  grant.length > 2 && grant.endsWith(":*") ? grant.slice(0, -1) : null

/**
 * Does `granted` (a checker's `granted`) cover `permission`? Exact match, `"*"`,
 * or a `"x:*"` prefix. What `@willyim/kit/react` uses on the client.
 */
export function matches(granted: readonly string[], permission: string): boolean {
  for (const g of granted) {
    if (g === permission || g === "*") return true
    const prefix = wildcardPrefix(g)
    if (prefix && permission.startsWith(prefix)) return true
  }
  return false
}

export function definePermissions<
  const P extends readonly string[],
  const R extends Record<string, readonly NoInfer<P[number]>[]>,
  const Res extends readonly string[] = readonly [],
>(config: DefinePermissionsConfig<P, R, Res>): PermissionsResult<P, R, Res> {
  type Permission = P[number] | Instance<Res>
  const catalog = new Set<string>(config.permissions)
  const resources: readonly string[] = config.resources ?? []
  // A resource must not prefix a catalog permission: "thread:read" can't be both
  // a permission and the thread whose id is "read".
  for (const r of resources)
    for (const p of config.permissions)
      if (p.startsWith(`${r}:`))
        throw new Error(`kit: resource "${r}" overlaps the permission "${p}"; rename one of them`)
  type Resource = Res[number]

  /** `"thread:abc"` for a declared `thread`: the id is one segment, as the IdP issues them (no `:`, `*` or whitespace). */
  const isInstance = (p: string) =>
    resources.some((r) => {
      if (!p.startsWith(`${r}:`)) return false
      return /^[^:*\s]+$/.test(p.slice(r.length + 1))
    })

  function createChecker(role: keyof R & string, opts?: CheckerOptions) {
    const superadmin = opts?.superadmin ?? false
    const rolePerms = config.roles[role] as readonly string[]
    const set = new Set(rolePerms)
    return checker<Permission, Resource>(
      (p) => superadmin || set.has(p),
      () => superadmin,
      superadmin ? [...config.permissions] : [...rolePerms],
      superadmin,
    )
  }

  function checkerFor(grants: readonly string[]) {
    if (grants.includes("*"))
      return checker<Permission, Resource>(
        () => true,
        () => true,
        [...config.permissions],
        true,
      )

    const prefixes = grants.flatMap((g) => wildcardPrefix(g) ?? [])
    const covered = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    const permissions = config.permissions.filter((p) => grants.includes(p) || covered(p))
    const instances = [...new Set(grants.filter((g) => !catalog.has(g) && isInstance(g)))]
    // Wildcards that reach instances stay in `granted`, so a client-side check matches them too.
    const instanceWildcards = [
      ...new Set(
        grants.filter((g) => {
          const prefix = wildcardPrefix(g)
          return prefix !== null && resources.some((r) => `${r}:`.startsWith(prefix))
        }),
      ),
    ]
    const exact = new Set<string>([...permissions, ...instances])

    return checker<Permission, Resource>(
      (p) => exact.has(p) || (isInstance(p) && covered(p)),
      (r) =>
        resources.includes(r) &&
        (instances.some((i) => i.startsWith(`${r}:`) && isInstance(i)) || covered(`${r}:`)),
      [...permissions, ...instances, ...instanceWildcards],
      false,
    )
  }

  return {
    createChecker,
    checkerFor,
    permissions: config.permissions,
    roles: config.roles,
    resources: (config.resources ?? []) as Res,
  }
}
