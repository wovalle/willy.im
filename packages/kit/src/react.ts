/**
 * `@willyim/kit/react`: permissions in components. Feed it what the server's
 * checker granted (from a loader) and it answers `has` the same way the server
 * does: exact grants, `"x:*"` wildcards and superadmin.
 *
 *   export const usePermissions = createPermissionsHook(() => useRouteLoaderData("root").permissions)
 */
import { matches } from "./permissions.js"

export type UsePermissionsReturn<P extends string> = {
  has(permission: P): boolean
  granted: P[]
  isSuperadmin: boolean
}

export type PermissionsData<P extends string> = {
  granted: P[]
  isSuperadmin?: boolean
}

export function createPermissionsHook<P extends string>(
  useData: () => PermissionsData<P>,
): () => UsePermissionsReturn<P> {
  return function usePermissions() {
    const { granted, isSuperadmin = false } = useData()
    return {
      has: (permission: P) => isSuperadmin || matches(granted, permission),
      granted,
      isSuperadmin,
    }
  }
}
