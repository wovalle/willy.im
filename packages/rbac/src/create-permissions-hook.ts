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
    const set = new Set<P>(granted)

    return {
      has: (permission: P) => set.has(permission),
      granted,
      isSuperadmin,
    }
  }
}
