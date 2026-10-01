type Filter = Record<string, unknown>
// Inferring from a union of functions' parameters gives their intersection.
type CallerOf<P> = P[keyof P] extends (caller: infer C) => any ? C : never

/**
 * Which rows of each resource a caller may see, as plain `field: value` data:
 *
 *   const policies = definePolicies({ client: (caller: Caller) => ({ workspaceId: caller.workspaceId }) });
 *   ctx.scope.client({ id }) // → { workspaceId: "w1", id: "c9" }
 *
 * Annotate `caller`: policies are defined before the context that types it.
 */
export function definePolicies<P extends Record<string, (caller: any) => Filter>>(policies: P) {
  return (caller: CallerOf<P>) =>
    Object.fromEntries(
      Object.entries(policies).map(([resource, policy]) => [
        resource,
        (extra?: Filter) => ({ ...policy(caller), ...extra }),
      ]),
    ) as { [K in keyof P]: <E extends Filter = {}>(extra?: E) => ReturnType<P[K]> & E }
}
