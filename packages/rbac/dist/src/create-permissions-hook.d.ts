export type UsePermissionsReturn<P extends string> = {
    has(permission: P): boolean;
    granted: P[];
};
export declare function createPermissionsHook<P extends string>(useGranted: () => P[]): () => UsePermissionsReturn<P>;
//# sourceMappingURL=create-permissions-hook.d.ts.map