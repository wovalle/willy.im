export function createPermissionsHook(useGranted) {
    return function usePermissions() {
        const granted = useGranted();
        const set = new Set(granted);
        return {
            has: (permission) => set.has(permission),
            granted,
        };
    };
}
