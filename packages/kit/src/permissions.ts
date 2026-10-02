/**
 * Permissions are the primitive; roles are named bags of them. A `Principal`
 * holds grants, globally and per tenant; `callerFor` turns one into the caller
 * of a request in one tenant (apps go through `app.context`, which calls it).
 *
 * Grants kit understands:
 *
 *   "clients:read"   that catalog permission
 *   "clients:*"      every catalog permission, and every instance, under `clients:`
 *   "*"              everything: a superadmin
 *   "thread:abc"     one instance of a declared resource (`resources: ["thread"]`)
 *
 * `parseGrants` rejects anything else. Grants must come from a trusted source
 * (the IdP, your own key table): `"*"` makes a superadmin, so a user handing out
 * grants must `covers` them first.
 */

/** Every `"a"`, `"a:b"`… that prefixes a permission: what `"a:*"` may name. */
export type Namespace<P extends string> = P extends `${infer N}:${infer Rest}`
  ? N | `${N}:${Namespace<Rest>}`
  : never

/** `"<resource>:<id>"` for each declared resource. */
export type Instance<Res extends readonly string[]> = `${Res[number]}:${string}`

/** A grant a principal may hold: `"*"`, a permission, a `"ns:*"` wildcard or an instance. */
export type Grant<P extends string = string, Res extends string = never> =
  | "*"
  | P
  | `${Namespace<P | Res>}:*`
  | `${Res}:*`
  | `${Res}:${string}`

/**
 * Who is calling, as plain data the app builds per request from live data (a
 * session, a key, the IdP). Tenant ids are strings.
 */
export type Principal<G extends string = string> = {
  /** `"user:<id>"`, `"apikey:<id>"`, `"system:cron"`…: the app's choice, and the audit identity. */
  id: string
  /** Global: every tenant, and the null tenant. `["*"]` is a superadmin. */
  grants: readonly G[]
  /** Per tenant. The app expands roles (`auth.roles[role]`) when building them. */
  memberships: readonly { tenantId: string; grants: readonly G[] }[]
  /** Impersonation only: who is really acting. */
  actor?: { id: string }
}

export type PermissionChecker<P extends string, R extends string = never, G extends string = P> = {
  has(permission: P): boolean
  /** Throws a 403 unless the caller covers every grant (see `covers`). No grants: passes. */
  require(...grants: G[]): void
  /**
   * Does the caller hold any instance of `resource` (`"thread:abc"`), or a
   * wildcard covering them? What `permission: { resource }` checks; the method
   * body then checks the specific id with `has`.
   */
  hasAny?(resource: R): boolean
  granted: P[]
  isSuperadmin: boolean
}

/** The caller of a request: a checker over the principal's grants in one tenant. */
export type Caller<P extends string = string, Res extends string = never> = PermissionChecker<
  P | `${Res}:${string}`,
  Res,
  Grant<P, Res>
> & {
  principal: Principal<Grant<P, Res>> | null
  tenantId: string | null
  /** The grants in this tenant, as held: membership ∪ global, parsed. */
  grants: Grant<P, Res>[]
  /** No credentials at all. */
  kind?: "anonymous"
}

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
  /** Low level: a checker over raw grants. Unknown grants are dropped. */
  checkerFor(
    grants: readonly string[],
  ): PermissionChecker<P[number] | Instance<Res>, Res[number], Grant<P[number], Res[number]>>
  /**
   * Low level: the caller of `principal` in `tenantId`; apps use `app.context`.
   * Throws a 404 for a tenant the principal has neither a membership in nor global grants.
   */
  callerFor(
    principal: Principal<Grant<P[number], Res[number]>> | null,
    tenantId: string | null,
  ): Caller<P[number], Res[number]>
  /** The runtime boundary for grants from the DB, a request or the IdP. */
  parseGrants(strings: readonly string[]): {
    grants: Grant<P[number], Res[number]>[]
    rejected: string[]
  }
  /** Does `held` cover every grant in `wanted`? Wildcard-aware; nothing wanted is covered. */
  covers(held: readonly string[], wanted: readonly string[]): boolean
  permissions: P
  roles: R
  resources: Res
}

// Marked like kit's own errors (Symbol.for("kit.public-error")): a denial is meant for the caller.
const forbidden = () =>
  Object.assign(new Response("Forbidden", { status: 403 }), {
    [Symbol.for("kit.public-error")]: true,
  })

const notFound = () =>
  Object.assign(Response.json({ error: "not found" }, { status: 404 }), {
    [Symbol.for("kit.public-error")]: true,
  })

function checker<P extends string, R extends string, G extends string>(
  has: (p: string) => boolean,
  hasAny: (resource: string) => boolean,
  held: readonly string[],
  granted: string[],
  isSuperadmin: boolean,
): PermissionChecker<P, R, G> {
  return {
    has,
    require: (...grants) => {
      if (!covers(held, grants)) throw forbidden()
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

/**
 * Does `held` cover every grant in `wanted`? `"*"` covers all, `"x:*"` covers
 * `"x:<anything>"` (`"x:*"` included), anything else only itself. Holding every
 * permission under `x:` doesn't cover `"x:*"`.
 */
export const covers = (held: readonly string[], wanted: readonly string[]) =>
  wanted.every((w) => matches(held, w))

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
  for (const r of resources) {
    if (!/^[^*\s]+$/.test(r) || r.startsWith(":") || r.endsWith(":"))
      throw new Error(`kit: "${r}" is not a resource name`)
    const nested = resources.find((other) => other.startsWith(`${r}:`))
    if (nested) throw new Error(`kit: resource "${r}" prefixes the resource "${nested}"; keep one`)
  }
  for (const r of resources)
    for (const p of config.permissions)
      if (p.startsWith(`${r}:`))
        throw new Error(`kit: resource "${r}" overlaps the permission "${p}"; rename one of them`)
  type Resource = Res[number]

  /** `"thread:abc"` for a declared `thread`: the id is one segment, as the IdP issues them (no `:`, `*` or whitespace). */
  const isInstanceOf = (r: string, p: string) =>
    p.startsWith(`${r}:`) && /^[^:*\s]+$/.test(p.slice(r.length + 1))
  const isInstance = (p: string) => resources.some((r) => isInstanceOf(r, p))

  type G = Grant<P[number], Resource>

  /** `"x:*"` names something: a catalog permission or a resource under `x:`, or the resource `x`. */
  const isWildcard = (g: string) => {
    const prefix = wildcardPrefix(g)
    return (
      prefix !== null &&
      (resources.includes(prefix.slice(0, -1)) ||
        [...config.permissions, ...resources].some((p) => p.startsWith(prefix)))
    )
  }

  function parseGrants(strings: readonly string[]) {
    const grants = new Set<string>()
    const rejected = new Set<string>()
    for (const g of strings)
      (g === "*" || catalog.has(g) || isWildcard(g) || isInstance(g) ? grants : rejected).add(g)
    return { grants: [...grants] as G[], rejected: [...rejected] }
  }

  function checkerFor(grants: readonly string[]) {
    const held = parseGrants(grants).grants
    if (grants.includes("*"))
      return checker<Permission, Resource, G>(
        () => true,
        () => true,
        held,
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

    return checker<Permission, Resource, G>(
      (p) => exact.has(p) || (isInstance(p) && covered(p)),
      (r) =>
        resources.includes(r) && (instances.some((i) => isInstanceOf(r, i)) || covered(`${r}:`)),
      held,
      [...permissions, ...instances, ...instanceWildcards],
      false,
    )
  }

  // In a tenant: membership ∪ global grants; with no tenant: global only. A tenant
  // the principal has nothing in is a 404, so tenants don't leak.
  function callerFor(principal: Principal<G> | null, tenantId: string | null) {
    if (principal === null)
      return { ...checkerFor([]), principal, tenantId, grants: [], kind: "anonymous" as const }
    const global = parseGrants(principal.grants).grants
    const memberships = principal.memberships.filter((m) => m.tenantId === tenantId)
    if (tenantId !== null && memberships.length === 0 && global.length === 0) throw notFound()
    const grants = parseGrants([...memberships.flatMap((m) => m.grants), ...global]).grants
    return { ...checkerFor(grants), principal, tenantId, grants }
  }

  return {
    checkerFor,
    callerFor,
    parseGrants,
    covers,
    permissions: config.permissions,
    roles: config.roles,
    resources: (config.resources ?? []) as Res,
  }
}
