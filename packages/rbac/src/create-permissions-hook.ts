export type UsePermissionsReturn<P extends string> = {
  has(permission: P): boolean
  granted: P[]
}

export function createPermissionsHook<P extends string>(
  useGranted: () => P[],
): () => UsePermissionsReturn<P> {
  return function usePermissions() {
    const granted = useGranted()
    const set = new Set<P>(granted)

    return {
      has: (permission: P) => set.has(permission),
      granted,
    }
  }
}
