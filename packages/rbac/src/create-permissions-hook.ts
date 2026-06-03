export type UsePermissionsReturn<P extends string> = {
  has(permission: P): boolean
  granted: P[]
  isSuperadmin: boolean
}

export function createPermissionsHook<P extends string>(
  useGranted: () => P[],
  allPermissions?: P[],
): () => UsePermissionsReturn<P> {
  return function usePermissions() {
    const granted = useGranted()
    const set = new Set<P>(granted)
    const isSuperadmin = allPermissions != null && allPermissions.every((p) => set.has(p))

    return {
      has: (permission: P) => set.has(permission),
      granted,
      isSuperadmin,
    }
  }
}
