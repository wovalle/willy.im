export type PermissionChecker<P extends string> = {
    has(permission: P): boolean;
    require(permission: P): void;
    granted: P[];
};
export type DefinePermissionsConfig<P extends readonly string[], R extends Record<string, readonly NoInfer<P[number]>[]>> = {
    permissions: P;
    roles: R;
};
export type PermissionsResult<P extends readonly string[], R extends Record<string, readonly P[number][]>> = {
    createChecker(role: keyof R & string): PermissionChecker<P[number]>;
    permissions: P;
    roles: R;
};
export declare function definePermissions<const P extends readonly string[], const R extends Record<string, readonly NoInfer<P[number]>[]>>(config: DefinePermissionsConfig<P, R>): PermissionsResult<P, R>;
//# sourceMappingURL=define-permissions.d.ts.map